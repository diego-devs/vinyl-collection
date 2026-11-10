import type { NormalizedRect, Rotation } from "./types";

export interface Size {
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Size of an image after rotating it by a multiple of 90° clockwise. */
export function rotatedSize(size: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { ...size };
}

/**
 * Clamps a rect into [0,1] and enforces a minimum size.
 * Returns null for empty/degenerate regions instead of inventing one.
 */
export function clampRect(rect: NormalizedRect, minSize = 0.02): NormalizedRect | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  const x1 = clamp01(rect.x);
  const y1 = clamp01(rect.y);
  const x2 = clamp01(rect.x + rect.width);
  const y2 = clamp01(rect.y + rect.height);
  if (x2 - x1 < minSize || y2 - y1 < minSize) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Maps a normalized rect defined on the *rotated* view back to normalized coordinates
 * on the un-rotated source image. Rotation is clockwise.
 */
export function rectFromRotatedToSource(rect: NormalizedRect, rotation: Rotation): NormalizedRect {
  const { x, y, width: w, height: h } = rect;
  switch (rotation) {
    case 0:
      return { ...rect };
    case 90:
      // Rotated (u,v) -> source (v, 1-u)
      return { x: y, y: 1 - x - w, width: h, height: w };
    case 180:
      return { x: 1 - x - w, y: 1 - y - h, width: w, height: h };
    case 270:
      // Rotated (u,v) -> source (1-v, u)
      return { x: 1 - y - h, y: x, width: h, height: w };
  }
}

/** Inverse of rectFromRotatedToSource. */
export function rectFromSourceToRotated(rect: NormalizedRect, rotation: Rotation): NormalizedRect {
  const inverse: Record<Rotation, Rotation> = { 0: 0, 90: 270, 180: 180, 270: 90 };
  return rectFromRotatedToSource(rect, inverse[rotation]);
}

/** Converts a normalized rect into integer pixels within the given image size. */
export function toPixelRect(rect: NormalizedRect, size: Size): PixelRect {
  const x = Math.round(rect.x * size.width);
  const y = Math.round(rect.y * size.height);
  const x2 = Math.round((rect.x + rect.width) * size.width);
  const y2 = Math.round((rect.y + rect.height) * size.height);
  return {
    x: Math.min(Math.max(0, x), size.width - 1),
    y: Math.min(Math.max(0, y), size.height - 1),
    width: Math.max(1, Math.min(size.width, x2) - x),
    height: Math.max(1, Math.min(size.height, y2) - y),
  };
}

/** Scale factor so the longest side fits maxLongSide (never upscales). */
export function fitScale(size: Size, maxLongSide: number): number {
  const long = Math.max(size.width, size.height);
  return long > maxLongSide ? maxLongSide / long : 1;
}

export function scaledSize(size: Size, maxLongSide: number): Size {
  const s = fitScale(size, maxLongSide);
  return {
    width: Math.max(1, Math.round(size.width * s)),
    height: Math.max(1, Math.round(size.height * s)),
  };
}

/** Intersection-over-union, used to flag near-identical detections (not to delete distinct covers). */
export function iou(a: NormalizedRect, b: NormalizedRect): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
