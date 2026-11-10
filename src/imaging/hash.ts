export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Este navegador no permite calcular huellas: abre la app mediante HTTPS.");
  }
  let buffer: ArrayBuffer;
  if (data instanceof Blob) buffer = await data.arrayBuffer();
  else if (data instanceof Uint8Array) buffer = data.slice().buffer as ArrayBuffer;
  else buffer = data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
