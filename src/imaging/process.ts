"use client";

import { rectFromRotatedToSource, rotatedSize, scaledSize, toPixelRect } from "@/domain/geometry";
import type { NormalizedRect, Rotation } from "@/domain/types";
import type { ProcessedImage } from "@/persistence/repository";
import { detectImageFormat, HEIC_HELP } from "./format";
import { sha256Hex } from "./hash";

/** Experimental parameters (see docs/recognition-evaluation.md); not guarantees. */
export const WORK_LONG_SIDE = 2048;
export const THUMB_LONG_SIDE = 320;
export const WORK_JPEG_QUALITY = 0.86;
export const THUMB_JPEG_QUALITY = 0.78;
export const MAX_INPUT_BYTES = 60 * 1024 * 1024;

export class ImageImportError extends Error {}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

async function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo codificar la imagen."))), "image/jpeg", quality),
  );
}

function context2d(canvas: AnyCanvas) {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new ImageImportError("El navegador no permite procesar imágenes (canvas).");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/**
 * Decodes with EXIF orientation applied. Re-encoding through canvas later drops all
 * metadata (EXIF, GPS), so nothing derived from it carries location data.
 */
export async function decodeOriented(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/** Draws `bitmap` rotated clockwise, cropped to `region` (normalized on the rotated view), scaled to fit. */
async function renderRegion(
  bitmap: ImageBitmap,
  rotation: Rotation,
  region: NormalizedRect | null,
  maxLongSide: number,
  quality: number,
): Promise<ProcessedImage> {
  const src = { width: bitmap.width, height: bitmap.height };
  const srcRegion = toPixelRect(
    region ? rectFromRotatedToSource(region, rotation) : { x: 0, y: 0, width: 1, height: 1 },
    src,
  );
  const outRotated = rotatedSize({ width: srcRegion.width, height: srcRegion.height }, rotation);
  const out = scaledSize(outRotated, maxLongSide);
  const canvas = makeCanvas(out.width, out.height);
  const ctx = context2d(canvas);
  // Map the output canvas to the rotated, scaled source region.
  const drawW = rotation === 90 || rotation === 270 ? out.height : out.width;
  const drawH = rotation === 90 || rotation === 270 ? out.width : out.height;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    bitmap,
    srcRegion.x,
    srcRegion.y,
    srcRegion.width,
    srcRegion.height,
    -drawW / 2,
    -drawH / 2,
    drawW,
    drawH,
  );
  const blob = await canvasToJpeg(canvas, quality);
  return { blob, width: out.width, height: out.height, mimeType: "image/jpeg" };
}

export interface ImportedImage {
  work: ProcessedImage;
  thumbnail: ProcessedImage;
  workSha256: string;
  originalFileSha256: string;
  originalFileName: string;
}

/** Validates, decodes (orientation-corrected), downsizes and strips metadata from a picked file. */
export async function importImageFile(file: File): Promise<ImportedImage> {
  if (file.size === 0) throw new ImageImportError("El archivo está vacío.");
  if (file.size > MAX_INPUT_BYTES) throw new ImageImportError("La imagen supera 60 MB.");
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const format = detectImageFormat(header);
  if (format === "unknown") {
    throw new ImageImportError("Formato no reconocido. Usa fotos JPEG o PNG.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeOriented(file);
  } catch {
    throw new ImageImportError(format === "heic" ? HEIC_HELP : "No se pudo leer la imagen.");
  }
  try {
    const work = await renderRegion(bitmap, 0, null, WORK_LONG_SIDE, WORK_JPEG_QUALITY);
    const thumbnail = await renderRegion(bitmap, 0, null, THUMB_LONG_SIDE, THUMB_JPEG_QUALITY);
    const [workSha256, originalFileSha256] = await Promise.all([sha256Hex(work.blob), sha256Hex(file)]);
    return { work, thumbnail, workSha256, originalFileSha256, originalFileName: file.name.slice(0, 300) };
  } finally {
    bitmap.close();
  }
}

export interface CroppedImage {
  image: ProcessedImage;
  thumbnail: ProcessedImage;
  sha256: string;
}

/** Crops a stored photo. `region` is normalized on the view rotated by `rotation`. */
export async function cropStoredPhoto(
  source: Blob,
  rotation: Rotation,
  region: NormalizedRect,
): Promise<CroppedImage> {
  const bitmap = await decodeOriented(source);
  try {
    const image = await renderRegion(bitmap, rotation, region, WORK_LONG_SIDE, WORK_JPEG_QUALITY);
    const thumbnail = await renderRegion(bitmap, rotation, region, THUMB_LONG_SIDE, THUMB_JPEG_QUALITY);
    return { image, thumbnail, sha256: await sha256Hex(image.blob) };
  } finally {
    bitmap.close();
  }
}
