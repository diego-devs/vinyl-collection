import { describe, expect, it } from "vitest";
import { toCsv, csvCell } from "@/domain/csv";
import { clampRect, iou, rectFromRotatedToSource, rectFromSourceToRotated, rotatedSize, scaledSize, toPixelRect } from "@/domain/geometry";
import { findPossibleDuplicates, matchesQuery, normalizeForMatch, parseList, parseYear } from "@/domain/normalize";
import type { Album, Copy, NormalizedRect, Rotation } from "@/domain/types";

const close = (a: NormalizedRect, b: NormalizedRect) => {
  for (const k of ["x", "y", "width", "height"] as const) expect(a[k]).toBeCloseTo(b[k], 10);
};

describe("geometry", () => {
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.5 };

  it.each([0, 90, 180, 270] as Rotation[])("round-trips a rect through rotation %i", (r) => {
    close(rectFromSourceToRotated(rectFromRotatedToSource(rect, r), r), rect);
  });

  it("maps a 90° clockwise view back to the source", () => {
    // Top-left corner of the rotated view corresponds to the bottom-left of the source.
    close(rectFromRotatedToSource({ x: 0, y: 0, width: 0.25, height: 0.5 }, 90), { x: 0, y: 0.75, width: 0.5, height: 0.25 });
  });

  it("swaps dimensions for quarter turns", () => {
    expect(rotatedSize({ width: 4000, height: 3000 }, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize({ width: 4000, height: 3000 }, 180)).toEqual({ width: 4000, height: 3000 });
  });

  it("clamps out-of-range rects and rejects degenerate ones", () => {
    expect(clampRect({ x: -0.2, y: 0.5, width: 0.5, height: 0.9 })).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
    expect(clampRect({ x: 0.5, y: 0.5, width: 0, height: 0.2 })).toBeNull();
    expect(clampRect({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it("produces integer pixel rects within the image", () => {
    expect(toPixelRect({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, { width: 101, height: 99 })).toEqual({ x: 51, y: 50, width: 50, height: 49 });
  });

  it("never upscales", () => {
    expect(scaledSize({ width: 800, height: 600 }, 2048)).toEqual({ width: 800, height: 600 });
    expect(scaledSize({ width: 4032, height: 3024 }, 2048)).toEqual({ width: 2048, height: 1536 });
  });

  it("computes IoU", () => {
    expect(iou(rect, rect)).toBeCloseTo(1);
    expect(iou(rect, { x: 0.6, y: 0.6, width: 0.1, height: 0.1 })).toBe(0);
  });
});

describe("normalize", () => {
  it("ignores accents, case and punctuation for matching", () => {
    expect(normalizeForMatch("  José José — ¡Él!  ")).toBe("jose jose el");
    expect(matchesQuery(normalizeForMatch("Canción de cuna Mía"), "cancion MIA")).toBe(true);
    expect(matchesQuery(normalizeForMatch("Canción"), "bolero")).toBe(false);
  });

  it("parses lists without duplicates", () => {
    expect(parseList("Rock, bolero; Rock\nJazz,, ")).toEqual(["Rock", "bolero", "Jazz"]);
  });

  it("keeps unknown years as null instead of inventing them", () => {
    expect(parseYear("1975")).toBe(1975);
    expect(parseYear("")).toBeNull();
    expect(parseYear("75")).toBeNull();
    expect(parseYear("3000")).toBeNull();
  });

  const t = "2026-01-01T00:00:00.000Z";
  const makeCopy = (id: string, extra: Partial<Copy> = {}): Copy => ({
    id,
    collectionId: id,
    albumId: null,
    provisionalTitle: "",
    coverPhotoId: null,
    photoIds: [],
    pressingYear: null,
    label: null,
    catalogNumber: null,
    country: null,
    discCount: null,
    notes: "",
    investigateValue: false,
    reviewStatus: "confirmed",
    captureBatchId: null,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    ...extra,
  });
  const makeAlbum = (title: string, artist: string): Album => ({
    id: title,
    title,
    credits: [{ name: artist, role: "artist" }],
    originalYear: null,
    genres: [],
    languages: [],
    externalIds: {},
    fieldSources: {},
    createdAt: t,
    updatedAt: t,
  });

  it("flags possible duplicates as signals, ignoring itself and deleted copies", () => {
    const others = [
      { copy: makeCopy("a"), album: makeAlbum("Él", "Juan Gabriel") },
      { copy: makeCopy("b", { catalogNumber: "LP-123" }), album: null },
      { copy: makeCopy("c", { deletedAt: t }), album: makeAlbum("El", "Juan Gabriel") },
      { copy: makeCopy("d"), album: makeAlbum("El", "Otra persona") },
    ];
    const signals = findPossibleDuplicates(
      { copyId: "x", title: "el", artists: ["juan gabriel"], catalogNumber: "lp 123" },
      others,
    );
    expect(signals).toEqual([
      { copyId: "a", reason: "sameTitleAndArtist" },
      { copyId: "b", reason: "sameCatalogNumber" },
    ]);
  });
});

describe("csv", () => {
  it("escapes quotes, separators and formula injection", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(null)).toBe("");
  });

  it("starts with a BOM and uses CRLF", () => {
    const out = toCsv(["a", "b"], [["1", "2"]]);
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out).toContain("a,b\r\n1,2");
  });
});
