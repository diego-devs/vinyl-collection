/**
 * Phase 0 viability probe: runs the configured VisionProvider against local photos.
 *
 *   npm run vision:probe -- <folder-with-photos> [--detect] [--delay=13]
 *
 * Reads .env.local (VISION_PROVIDER, VISION_MODEL, GEMINI_API_KEY). JPEG metadata (EXIF/GPS)
 * is stripped before sending. Results are written to evaluation/ (git-ignored) because they
 * may contain personal data. Images and base64 are never logged.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectImageFormat } from "../src/imaging/format";
import { readImageSize, stripJpegMetadata } from "../src/imaging/jpeg";
import { createVisionProvider, getVisionStatus, readServerEnv } from "../src/server/config";
import { VisionError } from "../src/vision/contract";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const detect = args.includes("--detect");
const delayArg = args.find((a) => a.startsWith("--delay="));

async function main() {
  if (!folder) {
    console.error("Uso: npm run vision:probe -- <carpeta-con-fotos> [--detect] [--delay=segundos]");
    process.exit(2);
  }
  const env = readServerEnv();
  const status = getVisionStatus(env);
  const provider = createVisionProvider(env);
  if (!provider) {
    console.error(`Proveedor no disponible: ${status.message}`);
    process.exit(1);
  }
  const delayMs = (delayArg ? Number(delayArg.split("=")[1]) : Math.ceil(60 / env.VISION_MAX_REQUESTS_PER_MINUTE)) * 1000;
  console.log(`Proveedor: ${provider.name} · modelo: ${provider.model}${provider.isMock ? " · SIMULADO" : ""}`);

  const files = (await readdir(folder)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  if (!files.length) {
    console.error("No hay archivos .jpg/.png en la carpeta.");
    process.exit(1);
  }
  const rows: Record<string, unknown>[] = [];
  for (const [i, name] of files.entries()) {
    let bytes: Uint8Array = new Uint8Array(await readFile(path.join(folder, name)));
    const format = detectImageFormat(bytes.subarray(0, 32));
    const size = readImageSize(bytes);
    if ((format !== "jpeg" && format !== "png") || !size) {
      rows.push({ file: name, error: "formato no soportado" });
      continue;
    }
    if (format === "jpeg") bytes = stripJpegMetadata(bytes) ?? bytes;
    if (bytes.length > 3_500_000) {
      rows.push({ file: name, error: "archivo > 3.5 MB; redúcelo a ~2048 px de lado largo" });
      continue;
    }
    const image = { bytes, mimeType: format === "jpeg" ? ("image/jpeg" as const) : ("image/png" as const), ...size };
    try {
      if (detect) {
        const { result, info } = await provider.detectCovers(image);
        rows.push({ file: name, latencyMs: info.latencyMs, regions: result.regions.length, rejected: result.rejected.length, result });
        console.log(`${i + 1}/${files.length} ${name}: ${result.regions.length} regiones · ${info.latencyMs} ms`);
      } else {
        const { result, info } = await provider.identifyRecord(image);
        const top = result.candidates[0];
        rows.push({ file: name, latencyMs: info.latencyMs, model: info.model, promptVersion: info.promptVersion, result });
        console.log(
          `${i + 1}/${files.length} ${name}: ${top ? `${top.artists.map((a) => a.name).join(", ")} — ${top.title ?? "?"}` : "sin candidatos"}` +
            `${result.needsAdditionalPhoto ? " · pide otra foto" : ""} · ${info.latencyMs} ms`,
        );
      }
    } catch (err) {
      const e = err instanceof VisionError ? err : null;
      rows.push({ file: name, error: e?.code ?? "unexpected", message: e?.message ?? String(err) });
      console.log(`${i + 1}/${files.length} ${name}: ERROR ${e?.code ?? "unexpected"} ${e?.message ?? ""}`);
      if (e && (e.code === "quotaExceeded" || e.code === "unauthorized" || e.code === "notConfigured")) break;
    }
    if (!provider.isMock && i < files.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  await mkdir("evaluation", { recursive: true });
  const out = path.join("evaluation", `probe-${detect ? "detect" : "identify"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify({ provider: provider.name, model: provider.model, isMock: provider.isMock, rows }, null, 2));
  console.log(`Resultados: ${out} (revisa manualmente cada caso; no hay tasa de precisión automática).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
