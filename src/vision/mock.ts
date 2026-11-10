import type { DetectionResult, IdentificationResult } from "./contract";
import { DETECT_PROMPT_VERSION, IDENTIFY_PROMPT_VERSION, normalizeDetections } from "./contract";
import type { VisionImageInput, VisionProvider } from "./provider";

/** FNV-1a over a sample of bytes; deterministic, not cryptographic. */
function fingerprint(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic SIMULATED provider for development and CI.
 * Its output is clearly marked and never represents real recognition.
 */
export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";
  readonly model = "mock-v1";
  readonly isMock = true;

  async detectCovers(image: VisionImageInput) {
    const fp = fingerprint(image.bytes);
    const count = (fp % 4) + 1;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const covers = Array.from({ length: count }, (_, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const cell = 1000 / Math.max(cols, rows);
      return {
        box_2d: [r * cell + 20, c * cell + 20, (r + 1) * cell - 20, (c + 1) * cell - 20].map(Math.round),
        label: `[SIMULADO] Portada ${i + 1}`,
      };
    });
    const result: DetectionResult = normalizeDetections({ covers }, { width: image.width, height: image.height });
    return {
      result,
      info: { provider: this.name, model: this.model, promptVersion: DETECT_PROMPT_VERSION, latencyMs: 0 },
    };
  }

  async identifyRecord(image: VisionImageInput) {
    const fp = fingerprint(image.bytes);
    const unknown = fp % 3 === 0;
    const result: IdentificationResult = unknown
      ? {
          observedText: "[SIMULADO] [ilegible]",
          candidates: [],
          suggestedMetadata: { originalYear: null, genres: [], languages: [] },
          needsAdditionalPhoto: true,
          reason: "[SIMULADO] título ilegible: fotografía la contraportada",
          warnings: ["Resultado simulado: no es un reconocimiento real."],
        }
      : {
          observedText: `[SIMULADO] Texto de portada ${fp.toString(16)}`,
          candidates: [
            {
              artists: [{ name: `Artista simulado ${fp % 97}`, role: "artist" }],
              title: `Álbum simulado ${fp % 89}`,
              evidence: "[SIMULADO] nombre y título impresos en la portada",
            },
          ],
          suggestedMetadata: { originalYear: null, genres: [], languages: [] },
          needsAdditionalPhoto: false,
          reason: null,
          warnings: ["Resultado simulado: no es un reconocimiento real."],
        };
    return {
      result,
      info: { provider: this.name, model: this.model, promptVersion: IDENTIFY_PROMPT_VERSION, latencyMs: 0 },
    };
  }
}
