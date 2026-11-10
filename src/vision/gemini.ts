import { ApiError, GoogleGenAI } from "@google/genai";
import {
  DETECT_PROMPT,
  DETECT_PROMPT_VERSION,
  detectionJsonSchema,
  IDENTIFY_PROMPT,
  IDENTIFY_PROMPT_VERSION,
  identificationJsonSchema,
  identificationResultSchema,
  normalizeDetections,
  parseProviderJson,
  rawDetectionSchema,
  VisionError,
} from "./contract";
import type { VisionImageInput, VisionProvider } from "./provider";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Maps SDK/network errors to stable codes. Never includes request payloads in messages. */
export function mapGeminiError(err: unknown): VisionError {
  if (err instanceof VisionError) return err;
  if (err instanceof ApiError) {
    const msg = err.message ?? "";
    if (err.status === 401 || err.status === 403)
      return new VisionError("unauthorized", "Credencial de Gemini inválida o sin permisos.");
    if (err.status === 429) {
      const daily = /per ?day|PerDay|daily/i.test(msg);
      const retry = /retry in ([\d.]+)s/i.exec(msg);
      return daily
        ? new VisionError("quotaExceeded", "Se agotó la cuota diaria gratuita. El reconocimiento queda en pausa.")
        : new VisionError(
            "rateLimited",
            "Límite de solicitudes por minuto alcanzado.",
            retry ? Math.ceil(Number(retry[1])) : null,
          );
    }
    if (err.status === 400) return new VisionError("rejectedInput", "El proveedor rechazó la imagen o la solicitud.");
    if (err.status === 404) return new VisionError("notConfigured", "El modelo configurado no existe o no está disponible.");
    if (err.status >= 500) return new VisionError("unavailable", "El proveedor no está disponible temporalmente.");
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /timeout|timed out/i.test(err.message))) {
    return new VisionError("timeout", "El proveedor tardó demasiado en responder.");
  }
  return new VisionError("unavailable", "No se pudo contactar con el proveedor.");
}

/** Real adapter for the Gemini Developer API (server-side only). */
export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini";
  readonly isMock = false;
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(opts: GeminiOptions) {
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs;
    this.client = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { timeout: opts.timeoutMs } });
  }

  private async call(image: VisionImageInput, prompt: string, schema: object, signal?: AbortSignal) {
    const started = Date.now();
    try {
      const res = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: image.mimeType, data: toBase64(image.bytes) } }, { text: prompt }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature: 0.1,
          abortSignal: signal ?? AbortSignal.timeout(this.timeoutMs),
        },
      });
      return { text: res.text, latencyMs: Date.now() - started };
    } catch (err) {
      throw mapGeminiError(err);
    }
  }

  async identifyRecord(image: VisionImageInput, signal?: AbortSignal) {
    const { text, latencyMs } = await this.call(image, IDENTIFY_PROMPT, identificationJsonSchema, signal);
    const result = parseProviderJson(text, identificationResultSchema);
    return {
      result,
      info: { provider: this.name, model: this.model, promptVersion: IDENTIFY_PROMPT_VERSION, latencyMs },
    };
  }

  async detectCovers(image: VisionImageInput, signal?: AbortSignal) {
    const { text, latencyMs } = await this.call(image, DETECT_PROMPT, detectionJsonSchema, signal);
    const raw = parseProviderJson(text, rawDetectionSchema);
    return {
      result: normalizeDetections(raw, { width: image.width, height: image.height }),
      info: { provider: this.name, model: this.model, promptVersion: DETECT_PROMPT_VERSION, latencyMs },
    };
  }
}
