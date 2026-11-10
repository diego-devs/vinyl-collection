import { z } from "zod";
import { GeminiVisionProvider } from "@/vision/gemini";
import { MockVisionProvider } from "@/vision/mock";
import type { VisionProvider } from "@/vision/provider";

/** Default candidate verified on 2026-11-10 as free-tier eligible; see docs/costs.md. */
export const DEFAULT_VISION_MODEL = "gemini-3.5-flash-lite";

const envSchema = z.object({
  VISION_PROVIDER: z.enum(["disabled", "mock", "gemini"]).default("disabled"),
  VISION_MODEL: z.string().trim().min(1).default(DEFAULT_VISION_MODEL),
  GEMINI_API_KEY: z.string().trim().optional(),
  VISION_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
  VISION_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  VISION_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(5),
  VISION_MAX_UPLOAD_BYTES: z.coerce.number().int().min(100_000).max(4_000_000).default(3_500_000),
  APP_PASSWORD_HASH: z.string().trim().optional(),
  SESSION_SECRET: z.string().trim().optional(),
});
export type ServerEnv = z.infer<typeof envSchema>;

export function readServerEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Fall back to safe defaults rather than crashing inventory pages.
    return envSchema.parse({});
  }
  return parsed.data;
}

export interface VisionStatus {
  provider: ServerEnv["VISION_PROVIDER"];
  model: string | null;
  isMock: boolean;
  available: boolean;
  /** Real providers require owner auth before being exposed over HTTP (Phase 2). */
  authConfigured: boolean;
  message: string;
}

export function isAuthConfigured(env: ServerEnv): boolean {
  return !!env.APP_PASSWORD_HASH && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
}

export function getVisionStatus(env: ServerEnv = readServerEnv()): VisionStatus {
  const authConfigured = isAuthConfigured(env);
  switch (env.VISION_PROVIDER) {
    case "disabled":
      return {
        provider: "disabled",
        model: null,
        isMock: false,
        available: false,
        authConfigured,
        message: "Reconocimiento desactivado. Puedes registrar discos manualmente.",
      };
    case "mock":
      return {
        provider: "mock",
        model: "mock-v1",
        isMock: true,
        available: true,
        authConfigured,
        message: "Modo simulado: los resultados NO son reconocimiento real.",
      };
    case "gemini":
      if (!env.GEMINI_API_KEY)
        return {
          provider: "gemini",
          model: env.VISION_MODEL,
          isMock: false,
          available: false,
          authConfigured,
          message: "Falta GEMINI_API_KEY en el servidor. El inventario manual sigue disponible.",
        };
      if (!authConfigured)
        return {
          provider: "gemini",
          model: env.VISION_MODEL,
          isMock: false,
          available: false,
          authConfigured,
          message: "Gemini configurado, pero falta la autenticación del propietario (pendiente, Fase 2).",
        };
      return {
        provider: "gemini",
        model: env.VISION_MODEL,
        isMock: false,
        available: true,
        authConfigured,
        message: `Gemini (${env.VISION_MODEL}) disponible.`,
      };
  }
}

/** Builds a provider for trusted server-side callers (routes after auth, CLI probe). */
export function createVisionProvider(env: ServerEnv = readServerEnv()): VisionProvider | null {
  if (env.VISION_PROVIDER === "mock") return new MockVisionProvider();
  if (env.VISION_PROVIDER === "gemini" && env.GEMINI_API_KEY) {
    return new GeminiVisionProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.VISION_MODEL,
      timeoutMs: env.VISION_TIMEOUT_MS,
    });
  }
  return null;
}
