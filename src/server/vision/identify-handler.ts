import { detectImageFormat } from "@/imaging/format";
import { readImageSize, stripJpegMetadata } from "@/imaging/jpeg";
import { RETRYABLE, VisionError, type VisionErrorCode } from "@/vision/contract";
import type { VisionProvider } from "@/vision/provider";
import { getVisionStatus, isAuthConfigured, type ServerEnv } from "../config";

const MAX_DIMENSION = 4096;

/**
 * Per-instance sliding window. On serverless hosts this is NOT a global limit
 * (each instance has its own memory); it only smooths bursts. See docs/architecture.md.
 */
export class LocalRateLimiter {
  private hits: number[] = [];
  constructor(private readonly perMinute: number) {}
  tryAcquire(nowMs = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
    this.hits = this.hits.filter((t) => nowMs - t < 60_000);
    if (this.hits.length >= this.perMinute) {
      return { ok: false, retryAfterSeconds: Math.ceil((60_000 - (nowMs - this.hits[0])) / 1000) };
    }
    this.hits.push(nowMs);
    return { ok: true };
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(code: VisionErrorCode | "authRequired" | "badOrigin" | "badRequest", message: string, retryAfter?: number | null) {
  const status: Record<string, number> = {
    authRequired: 401,
    badOrigin: 403,
    badRequest: 400,
    notConfigured: 503,
    unauthorized: 502,
    quotaExceeded: 429,
    rateLimited: 429,
    timeout: 504,
    invalidResponse: 502,
    rejectedInput: 422,
    unavailable: 503,
  };
  const retryable = code in RETRYABLE ? RETRYABLE[code as VisionErrorCode] : false;
  return json(
    status[code] ?? 500,
    { error: { code, message, retryable, retryAfterSeconds: retryAfter ?? null } },
    retryAfter ? { "retry-after": String(retryAfter) } : {},
  );
}

/** Same-origin check for state-changing requests (CSRF defense in depth). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export interface IdentifyDeps {
  env: ServerEnv;
  provider: VisionProvider | null;
  limiter: LocalRateLimiter;
  /** Phase 2: verifies the signed owner session cookie. */
  isOwnerAuthenticated: (request: Request) => boolean;
}

export async function handleIdentify(request: Request, deps: IdentifyDeps): Promise<Response> {
  if (!isSameOrigin(request)) return errorResponse("badOrigin", "Origen no permitido.");
  const status = getVisionStatus(deps.env);
  if (!deps.provider || !status.available) return errorResponse("notConfigured", status.message);
  // Real providers are never exposed without owner auth.
  if (!deps.provider.isMock && !(isAuthConfigured(deps.env) && deps.isOwnerAuthenticated(request))) {
    return errorResponse("authRequired", "Inicia sesión como propietario para usar el reconocimiento.");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > deps.env.VISION_MAX_UPLOAD_BYTES) return errorResponse("rejectedInput", "La imagen es demasiado grande.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("badRequest", "Solicitud inválida.");
  }
  const file = form.get("image");
  if (!(file instanceof Blob)) return errorResponse("badRequest", "Falta la imagen.");
  if (file.size === 0 || file.size > deps.env.VISION_MAX_UPLOAD_BYTES) {
    return errorResponse("rejectedInput", "Tamaño de imagen no permitido.");
  }
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const format = detectImageFormat(bytes.subarray(0, 32));
  if (format !== "jpeg" && format !== "png") return errorResponse("rejectedInput", "Solo se aceptan JPEG o PNG.");
  const size = readImageSize(bytes);
  if (!size || size.width < 32 || size.height < 32 || size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    return errorResponse("rejectedInput", "Dimensiones de imagen no permitidas.");
  }
  if (format === "jpeg") {
    const stripped = stripJpegMetadata(bytes);
    if (!stripped) return errorResponse("rejectedInput", "JPEG mal formado.");
    bytes = stripped;
  }
  const slot = deps.limiter.tryAcquire();
  if (!slot.ok) return errorResponse("rateLimited", "Demasiadas solicitudes; espera un momento.", slot.retryAfterSeconds);

  try {
    const { result, info } = await deps.provider.identifyRecord({
      bytes,
      mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      ...size,
    });
    return json(200, { result, info, isMock: deps.provider.isMock });
  } catch (err) {
    const e = err instanceof VisionError ? err : new VisionError("unavailable", "Error inesperado del proveedor.");
    return errorResponse(e.code, e.message, e.retryAfterSeconds);
  }
}
