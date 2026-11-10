export interface ImageSize {
  width: number;
  height: number;
}

/** Reads width/height from PNG IHDR or JPEG SOFn without decoding pixels. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    if (marker === 0xda || len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Removes APPn (EXIF, XMP, IPTC…) and COM segments from a JPEG, keeping APP0 (JFIF)
 * and APP14 (Adobe colour transform). Returns null if the stream is not a well-formed JPEG.
 * Defense in depth: the browser pipeline already re-encodes images without metadata.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out: number[] = [0xff, 0xd8];
  const chunks: Uint8Array[] = [];
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda) {
      chunks.push(bytes.subarray(i));
      break;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    const isAppOrCom = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!isAppOrCom) chunks.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (!chunks.length || chunks[chunks.length - 1][1] !== 0xda) return null;
  const total = out.length + chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  result.set(out, 0);
  let off = out.length;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}
