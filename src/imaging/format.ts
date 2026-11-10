/** Detects the real container format from magic bytes (file.type is unreliable on iOS). */
export type DetectedFormat = "jpeg" | "png" | "webp" | "heic" | "unknown";

export function detectImageFormat(header: Uint8Array): DetectedFormat {
  const b = header;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  )
    return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "avif"].includes(brand)) {
      return brand === "avif" ? "unknown" : "heic";
    }
  }
  return "unknown";
}

export const HEIC_HELP =
  "Este navegador no pudo leer la foto HEIC. En el iPhone: Ajustes › Cámara › Formatos › «Más compatible» " +
  "para nuevas fotos, o exporta/comparte la foto como JPEG y vuelve a importarla.";
