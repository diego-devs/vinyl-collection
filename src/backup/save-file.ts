/**
 * Saves a file in a Safari/iOS-compatible way: Web Share (Files/AirDrop) when available,
 * otherwise a regular download. Does not rely on the desktop-only File System Access API.
 */
export async function saveOrShareFile(blob: Blob, fileName: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], fileName, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (isTouch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}

export function timestampForFile(d = new Date()): string {
  return d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
}
