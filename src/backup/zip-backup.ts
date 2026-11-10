import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { DATA_SCHEMA_VERSION, type PhotoAsset } from "@/domain/types";
import { sha256Hex } from "@/imaging/hash";
import { getDb, photoMetaFromRecord, type PhotoRecord, type ThumbnailRecord } from "@/persistence/db";
import { ensureDefaults } from "@/persistence/repository";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupDataSchema,
  isSupportedManifest,
  manifestSchema,
  PHOTO_PATH,
  RESTORE_LIMITS,
  THUMB_PATH,
  type BackupData,
  type BackupManifest,
} from "./format";

const EXT: Record<PhotoAsset["mimeType"], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class BackupError extends Error {}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

/**
 * Builds a self-contained, versioned backup ZIP of the given copies (or all non-deleted copies).
 * Includes related albums, photos (and their source photos), thumbnails and checksums.
 * Never includes settings secrets, cookies or API keys (none are stored client-side).
 */
export async function buildBackup(copyIds: string[] | "all"): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const db = getDb();
  const allCopies = copyIds === "all" ? await db.copies.toArray() : (await db.copies.bulkGet(copyIds)).filter((c) => !!c);
  const copies = allCopies.filter((c) => !c.deletedAt);
  if (!copies.length) throw new BackupError("No hay ejemplares para exportar.");

  const photoIds = new Set(copies.flatMap((c) => c.photoIds));
  // Include source photos so crop → origin relations survive.
  const photos: PhotoRecord[] = [];
  const queue = [...photoIds];
  while (queue.length) {
    const batch = queue.splice(0, 200);
    for (const p of await db.photos.bulkGet(batch)) {
      if (!p) continue;
      photos.push(p);
      if (p.sourcePhotoId && !photoIds.has(p.sourcePhotoId)) {
        photoIds.add(p.sourcePhotoId);
        queue.push(p.sourcePhotoId);
      }
    }
  }
  const thumbnails = (await db.thumbnails.bulkGet([...photoIds])).filter((t): t is ThumbnailRecord => !!t);
  const albumIds = [...new Set(copies.map((c) => c.albumId).filter((id): id is string => !!id))];
  const albums = (await db.albums.bulkGet(albumIds)).filter((a) => !!a);
  const batchIds = [...new Set(copies.map((c) => c.captureBatchId).filter((id): id is string => !!id))];
  const captureBatches = (await db.captureBatches.bulkGet(batchIds)).filter((b) => !!b);
  const collectionIds = [...new Set(copies.map((c) => c.collectionId))];
  const collections = (await db.collections.bulkGet(collectionIds)).filter((c) => !!c);

  const data: BackupData = {
    collections,
    albums,
    copies,
    photos: photos.map(photoMetaFromRecord),
    thumbnails: thumbnails.map(({ photoId, width, height }) => ({ photoId, width, height })),
    captureBatches,
  };

  const zip: Zippable = {};
  const files: BackupManifest["files"] = [];
  const add = async (path: string, bytes: Uint8Array, compress: boolean) => {
    zip[path] = [bytes, { level: compress ? 6 : 0 }];
    files.push({ path, sha256: await sha256Hex(bytes), size: bytes.length });
  };
  await add("data.json", strToU8(JSON.stringify(data)), true);
  for (const p of photos) await add(`photos/${p.id}.${EXT[p.mimeType]}`, new Uint8Array(p.bytes), false);
  for (const t of thumbnails) await add(`thumbs/${t.photoId}.jpg`, new Uint8Array(t.bytes), false);

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    scope: copyIds === "all" ? "all" : "selection",
    counts: { collections: collections.length, albums: albums.length, copies: copies.length, photos: photos.length },
    files,
  };
  zip["manifest.json"] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  const bytes = zipSync(zip);
  return { blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/zip" }), manifest };
}

export interface RestorePreview {
  manifest: BackupManifest;
  data: BackupData;
  photoBytes: Map<string, ArrayBuffer>;
  thumbBytes: Map<string, ArrayBuffer>;
  newCopies: number;
  existingCopies: number;
  newPhotos: number;
}

/**
 * Reads and fully validates a backup without touching the database:
 * entry whitelist, size limits, manifest version, checksums, schema and references.
 */
export async function prepareRestore(file: Blob): Promise<RestorePreview> {
  if (file.size > RESTORE_LIMITS.maxArchiveBytes) throw new BackupError("El archivo de respaldo es demasiado grande.");
  const raw = await blobBytes(file);
  let entries: Record<string, Uint8Array>;
  let entryCount = 0;
  let declaredTotal = 0;
  try {
    entries = unzipSync(raw, {
      filter: (f) => {
        entryCount++;
        declaredTotal += f.originalSize;
        if (entryCount > RESTORE_LIMITS.maxEntries) throw new BackupError("El respaldo tiene demasiados archivos.");
        if (f.originalSize > RESTORE_LIMITS.maxEntryBytes || declaredTotal > RESTORE_LIMITS.maxTotalUncompressedBytes) {
          throw new BackupError("El respaldo excede los límites de tamaño permitidos.");
        }
        const allowed = f.name === "manifest.json" || f.name === "data.json" || PHOTO_PATH.test(f.name) || THUMB_PATH.test(f.name);
        if (!allowed) throw new BackupError(`Entrada no permitida en el respaldo: ${f.name.slice(0, 80)}`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("El archivo no es un respaldo ZIP válido o está dañado.");
  }

  const readJson = (name: string): unknown => {
    const bytes = entries[name];
    if (!bytes) throw new BackupError(`Falta ${name} en el respaldo.`);
    if (bytes.length > RESTORE_LIMITS.maxJsonBytes) throw new BackupError(`${name} es demasiado grande.`);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new BackupError(`${name} no es JSON válido.`);
    }
  };

  const manifestParsed = manifestSchema.safeParse(readJson("manifest.json"));
  if (!manifestParsed.success) throw new BackupError("El manifiesto del respaldo no es válido.");
  const manifest = manifestParsed.data;
  const unsupported = isSupportedManifest(manifest);
  if (unsupported) throw new BackupError(unsupported);

  const listed = new Set(manifest.files.map((f) => f.path));
  for (const name of Object.keys(entries)) {
    if (name !== "manifest.json" && !listed.has(name)) throw new BackupError(`Archivo no declarado en el manifiesto: ${name}`);
  }
  for (const f of manifest.files) {
    const bytes = entries[f.path];
    if (!bytes) throw new BackupError(`Falta ${f.path} en el respaldo.`);
    if (bytes.length !== f.size || (await sha256Hex(bytes)) !== f.sha256) {
      throw new BackupError(`Checksum incorrecto en ${f.path}: el respaldo está dañado.`);
    }
  }

  const dataParsed = backupDataSchema.safeParse(readJson("data.json"));
  if (!dataParsed.success) throw new BackupError("Los datos del respaldo no son válidos.");
  const data = dataParsed.data;

  const photoBytes = new Map<string, ArrayBuffer>();
  for (const p of data.photos) {
    const ext = EXT[p.mimeType];
    const bytes = entries[`photos/${p.id}.${ext}`];
    if (!bytes) throw new BackupError(`Falta la foto ${p.id}.`);
    if ((await sha256Hex(bytes)) !== p.sha256) throw new BackupError(`La foto ${p.id} no coincide con su huella.`);
    photoBytes.set(p.id, toArrayBuffer(bytes));
  }
  const thumbBytes = new Map<string, ArrayBuffer>();
  for (const t of data.thumbnails) {
    const bytes = entries[`thumbs/${t.photoId}.jpg`];
    if (bytes) thumbBytes.set(t.photoId, toArrayBuffer(bytes));
  }
  const photoIdSet = new Set(data.photos.map((p) => p.id));
  const albumIdSet = new Set(data.albums.map((a) => a.id));
  for (const c of data.copies) {
    if (c.albumId && !albumIdSet.has(c.albumId)) throw new BackupError("Un ejemplar referencia un álbum ausente.");
    if (c.photoIds.some((id) => !photoIdSet.has(id))) throw new BackupError("Un ejemplar referencia una foto ausente.");
  }

  const db = getDb();
  const existing = await db.copies.bulkGet(data.copies.map((c) => c.id));
  const existingPhotos = await db.photos.bulkGet(data.photos.map((p) => p.id));
  const existingCopies = existing.filter(Boolean).length;
  return {
    manifest,
    data,
    photoBytes,
    thumbBytes,
    existingCopies,
    newCopies: data.copies.length - existingCopies,
    newPhotos: existingPhotos.filter((p) => !p).length,
  };
}

/**
 * Applies a validated restore in ONE transaction: either everything is added or nothing is.
 * Records whose IDs already exist are kept as they are (never overwritten), so re-running
 * an interrupted restore does not duplicate copies.
 */
export async function applyRestore(preview: RestorePreview): Promise<{ addedCopies: number; skippedCopies: number }> {
  const db = getDb();
  const { collection } = await ensureDefaults();
  const { data } = preview;
  let addedCopies = 0;
  await db.transaction(
    "rw",
    [db.copies, db.albums, db.photos, db.thumbnails, db.captureBatches, db.settings],
    async () => {
      const has = async <T>(table: { get(id: string): Promise<T | undefined> }, id: string) => !!(await table.get(id));
      for (const a of data.albums) if (!(await has(db.albums, a.id))) await db.albums.add(a);
      for (const b of data.captureBatches) if (!(await has(db.captureBatches, b.id))) await db.captureBatches.add(b);
      for (const p of data.photos) {
        if (await has(db.photos, p.id)) continue;
        await db.photos.add({ ...p, bytes: preview.photoBytes.get(p.id)! });
      }
      for (const t of data.thumbnails) {
        const bytes = preview.thumbBytes.get(t.photoId);
        if (bytes && !(await has(db.thumbnails, t.photoId))) await db.thumbnails.add({ ...t, bytes });
      }
      for (const c of data.copies) {
        if (await has(db.copies, c.id)) continue;
        // Single-collection app: imported copies join the local collection.
        await db.copies.add({ ...c, collectionId: collection.id });
        addedCopies++;
      }
      await db.settings.update("app", { lastChangeAt: new Date().toISOString() });
    },
  );
  return { addedCopies, skippedCopies: data.copies.length - addedCopies };
}
