import type { DetectionResult, IdentificationResult } from "./contract";

export interface VisionImageInput {
  /** Metadata-free JPEG/PNG bytes (EXIF already stripped by the client pipeline). */
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}

export interface VisionCallInfo {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock: boolean;
  detectCovers(image: VisionImageInput, signal?: AbortSignal): Promise<{ result: DetectionResult; info: VisionCallInfo }>;
  identifyRecord(
    image: VisionImageInput,
    signal?: AbortSignal,
  ): Promise<{ result: IdentificationResult; info: VisionCallInfo }>;
}
