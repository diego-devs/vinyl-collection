import { readFileSync } from "node:fs";
import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { detectImageFormat } from "@/imaging/format";
import { readImageSize, stripJpegMetadata } from "@/imaging/jpeg";
import { readServerEnv } from "@/server/config";
import { handleIdentify, LocalRateLimiter } from "@/server/vision/identify-handler";
import { identificationResultSchema, normalizeDetections, parseProviderJson, VisionError } from "@/vision/contract";
import { mapGeminiError } from "@/vision/gemini";
import { MockVisionProvider } from "@/vision/mock";
import type { VisionProvider } from "@/vision/provider";

/** Minimal JPEG: SOI, APP1(Exif with fake GPS), COM, SOF0 (w×h), SOS + data, EOI. */
function fakeJpeg(width: number, height: number): Uint8Array {
  const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
  const exif = [...Buffer.from("Exif\0\0GPS-SECRET-LOCATION")];
  const sof = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0];
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, [...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, exif),
    ...seg(0xfe, [...Buffer.from("comentario")]),
    ...seg(0xc0, sof),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12, 0x34, 0x56,
    0xff, 0xd9,
  ]);
}

describe("image bytes", () => {
  it("detects formats by magic bytes, not by extension", () => {
    expect(detectImageFormat(fakeJpeg(10, 10))).toBe("jpeg");
    expect(detectImageFormat(readFileSync("tests/fixtures/cover-a.png"))).toBe("png");
    expect(detectImageFormat(readFileSync("tests/fixtures/not-an-image.png"))).toBe("unknown");
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic")]);
    expect(detectImageFormat(heic)).toBe("heic");
  });

  it("reads PNG and JPEG dimensions", () => {
    expect(readImageSize(readFileSync("tests/fixtures/cover-a.png"))).toEqual({ width: 800, height: 600 });
    expect(readImageSize(fakeJpeg(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("strips EXIF/GPS and comments but keeps image data", () => {
    const original = fakeJpeg(64, 48);
    const stripped = stripJpegMetadata(original)!;
    const text = Buffer.from(stripped).toString("latin1");
    expect(text).not.toContain("GPS-SECRET");
    expect(text).not.toContain("comentario");
    expect(text).toContain("JFIF");
    expect(readImageSize(stripped)).toEqual({ width: 64, height: 48 });
    expect([...stripped.slice(-5)]).toEqual([0x12, 0x34, 0x56, 0xff, 0xd9]);
  });

  it("rejects malformed JPEG streams", () => {
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01]))).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull();
  });
});

describe("vision contract", () => {
  it("converts box_2d [ymin,xmin,ymax,xmax] 0–1000 into normalized rects", () => {
    const r = normalizeDetections({ covers: [{ box_2d: [100, 200, 600, 700], label: " A " }] }, { width: 1000, height: 800 });
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0].rect.x).toBeCloseTo(0.2);
    expect(r.regions[0].rect.y).toBeCloseTo(0.1);
    expect(r.regions[0].rect.width).toBeCloseTo(0.5);
    expect(r.regions[0].rect.height).toBeCloseTo(0.5);
    expect(r.regions[0].label).toBe("A");
  });

  it("clamps, rejects empty/out-of-bounds and near-identical boxes, keeps distinct overlaps", () => {
    const r = normalizeDetections(
      {
        covers: [
          { box_2d: [0, 0, 500, 500], label: null },
          { box_2d: [5, 5, 500, 500], label: "dup" },
          { box_2d: [250, 250, 750, 750], label: "overlap" },
          { box_2d: [900, -100, 1100, 50], label: "edge" },
          { box_2d: [300, 300, 300, 600], label: "empty" },
          { box_2d: [1200, 1200, 1500, 1500], label: "outside" },
        ],
      },
      { width: 100, height: 100 },
    );
    expect(r.regions.map((x) => x.label)).toEqual([null, "overlap", "edge"]);
    expect(r.regions[2].rect).toEqual({ x: 0, y: 0.9, width: expect.closeTo(0.05, 10), height: expect.closeTo(0.1, 10) });
    expect(r.rejected).toEqual([
      { reason: "duplicate", label: "dup" },
      { reason: "empty", label: "empty" },
      { reason: "outOfBounds", label: "outside" },
    ]);
  });

  it("treats invalid JSON or schema mismatches as invalidResponse", () => {
    expect(() => parseProviderJson("{not json", identificationResultSchema)).toThrow(VisionError);
    try {
      parseProviderJson('{"candidates": "nope"}', identificationResultSchema);
    } catch (e) {
      expect((e as VisionError).code).toBe("invalidResponse");
    }
    expect(() => parseProviderJson(undefined, identificationResultSchema)).toThrow(/vacía/);
  });

  it("maps provider errors to stable codes", () => {
    expect(mapGeminiError(new ApiError({ message: "bad key", status: 401 })).code).toBe("unauthorized");
    const perMinute = mapGeminiError(new ApiError({ message: "Quota exceeded per minute. Please retry in 12.3s", status: 429 }));
    expect(perMinute.code).toBe("rateLimited");
    expect(perMinute.retryAfterSeconds).toBe(13);
    expect(mapGeminiError(new ApiError({ message: "GenerateRequestsPerDayPerProjectPerModel exceeded", status: 429 })).code).toBe("quotaExceeded");
    expect(mapGeminiError(new ApiError({ message: "x", status: 503 })).code).toBe("unavailable");
    expect(mapGeminiError(new ApiError({ message: "x", status: 404 })).code).toBe("notConfigured");
    expect(mapGeminiError(Object.assign(new Error("aborted"), { name: "AbortError" })).code).toBe("timeout");
  });

  it("mock output is deterministic and clearly labeled as simulated", async () => {
    const mock = new MockVisionProvider();
    const img = { bytes: fakeJpeg(100, 100), mimeType: "image/jpeg" as const, width: 100, height: 100 };
    const a = await mock.identifyRecord(img);
    const b = await mock.identifyRecord(img);
    expect(a).toEqual(b);
    expect(identificationResultSchema.parse(a.result)).toBeTruthy();
    expect(a.result.observedText).toContain("[SIMULADO]");
  });
});

describe("POST /api/vision/identify handler", () => {
  const origin = "http://localhost:3000";
  function request(body: Blob | null, headers: Record<string, string> = { origin, host: "localhost:3000" }) {
    const form = new FormData();
    if (body) form.set("image", body, "x.jpg");
    return new Request(`${origin}/api/vision/identify`, { method: "POST", body: form, headers });
  }
  const jpegBlob = new Blob([fakeJpeg(200, 200).slice().buffer as ArrayBuffer], { type: "image/jpeg" });
  const deps = (over: Partial<Parameters<typeof handleIdentify>[1]> = {}) => ({
    env: readServerEnv({ VISION_PROVIDER: "mock" }),
    provider: new MockVisionProvider() as VisionProvider,
    limiter: new LocalRateLimiter(5),
    isOwnerAuthenticated: () => false,
    ...over,
  });

  it("rejects cross-origin requests", async () => {
    const res = await handleIdentify(request(jpegBlob, { origin: "https://evil.example", host: "localhost:3000" }), deps());
    expect(res.status).toBe(403);
  });

  it("returns 503 when recognition is disabled", async () => {
    const res = await handleIdentify(request(jpegBlob), deps({ env: readServerEnv({}), provider: null }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("notConfigured");
  });

  it("never exposes a real provider without owner authentication", async () => {
    const real: VisionProvider = { name: "gemini", model: "m", isMock: false, detectCovers: vi.fn(), identifyRecord: vi.fn() };
    const env = readServerEnv({ VISION_PROVIDER: "gemini", GEMINI_API_KEY: "k", APP_PASSWORD_HASH: "h", SESSION_SECRET: "s".repeat(40) });
    const res = await handleIdentify(request(jpegBlob), deps({ env, provider: real }));
    expect(res.status).toBe(401);
    expect(real.identifyRecord).not.toHaveBeenCalled();
  });

  it("rejects non-images by content", async () => {
    const fake = new Blob([readFileSync("tests/fixtures/not-an-image.png")], { type: "image/png" });
    const res = await handleIdentify(request(fake), deps());
    expect(res.status).toBe(422);
  });

  it("strips metadata before calling the provider and returns the mock result", async () => {
    const provider = new MockVisionProvider();
    const spy = vi.spyOn(provider, "identifyRecord");
    const res = await handleIdentify(request(jpegBlob), deps({ provider }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isMock).toBe(true);
    const sent = spy.mock.calls[0][0].bytes;
    expect(Buffer.from(sent).toString("latin1")).not.toContain("GPS-SECRET");
  });

  it("rate limits per instance with Retry-After", async () => {
    const limiter = new LocalRateLimiter(1);
    expect((await handleIdentify(request(jpegBlob), deps({ limiter }))).status).toBe(200);
    const res = await handleIdentify(request(jpegBlob), deps({ limiter }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("maps provider failures without leaking details", async () => {
    const failing: VisionProvider = {
      name: "mock",
      model: "m",
      isMock: true,
      detectCovers: vi.fn(),
      identifyRecord: vi.fn().mockRejectedValue(new VisionError("quotaExceeded", "Cuota agotada")),
    };
    const res = await handleIdentify(request(jpegBlob), deps({ provider: failing }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "quotaExceeded", retryable: false });
  });
});
