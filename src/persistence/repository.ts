import type {
  Album,
  ArtistCredit,
  CaptureBatch,
  Collection,
  Copy,
  PhotoAsset,
  PhotoMeta,
  ReviewStatus,
  Settings,
  Thumbnail,
} from "@/domain/types";
import {
  getDb,
  photoFromRecord,
  photoMetaFromRecord,
  thumbnailFromRecord,
  type PhotoRecord,
  type ThumbnailRecord,
} from "./db";

export const DEFAULT_COLLECTION_TITLE = "Archivo LP";

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export async function ensureDefaults(): Promise<{ collection: Collection; settings: Settings }> {
  const db = getDb();
  return db.transaction("rw", db.collections, db.settings, async () => {
    let collection = await db.collections.toCollection().first();
    if (!collection) {
      const t = now();
      collection = { id: newId(), name: DEFAULT_COLLECTION_TITLE, createdAt: t, updatedAt: t };
      await db.collections.add(collection);
    }
    let settings = await db.settings.get("app");
    if (!settings) {
      settings = {
        key: "app",
        collectionTitle: collection.name,
        lastBackupAt: null,
        lastChangeAt: null,
        recognitionConsentAt: null,
      };
      await db.settings.add(settings);
    }
    return { collection, settings };
  });
}

export async function updateSettings(patch: Partial<Omit<Settings, "key">>): Promise<void> {
  const db = getDb();
  await ensureDefaults();
  await db.transaction("rw", db.settings, db.collections, async () => {
    await db.settings.update("app", patch);
    if (patch.collectionTitle) {
      const c = await db.collections.toCollection().first();
      if (c) await db.collections.update(c.id, { name: patch.collectionTitle, updatedAt: now() });
    }
  });
}

async function markChanged() {
  await getDb().settings.update("app", { lastChangeAt: now() });
}

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: PhotoAsset["mimeType"];
}

export interface StorePhotoInput {
  kind: PhotoAsset["kind"];
  image: ProcessedImage;
  thumbnail: ProcessedImage;
  sha256: string;
  originalFileSha256?: string | null;
  originalFileName?: string | null;
  sourcePhotoId?: string | null;
  region?: PhotoAsset["region"];
  rotation?: PhotoAsset["rotation"];
}

function buildPhoto(input: StorePhotoInput): { photo: PhotoAsset; thumb: Thumbnail } {
  const id = newId();
  const photo: PhotoAsset = {
    id,
    kind: input.kind,
    mimeType: input.image.mimeType,
    width: input.image.width,
    height: input.image.height,
    byteSize: input.image.blob.size,
    sha256: input.sha256,
    originalFileSha256: input.originalFileSha256 ?? null,
    originalFileName: input.originalFileName ?? null,
    sourcePhotoId: input.sourcePhotoId ?? null,
    region: input.region ?? null,
    rotation: input.rotation ?? 0,
    createdAt: now(),
    blob: input.image.blob,
  };
  const thumb: Thumbnail = {
    photoId: id,
    blob: input.thumbnail.blob,
    width: input.thumbnail.width,
    height: input.thumbnail.height,
  };
  return { photo, thumb };
}

/** Reads blob bytes up front: IndexedDB transactions must not await non-database promises. */
async function buildRecords(input: StorePhotoInput): Promise<{ photo: PhotoAsset; record: PhotoRecord; thumbRecord: ThumbnailRecord }> {
  const { photo, thumb } = buildPhoto(input);
  const [bytes, thumbBytes] = await Promise.all([photo.blob.arrayBuffer(), thumb.blob.arrayBuffer()]);
  const { blob: _blob, ...meta } = photo;
  return {
    photo,
    record: { ...meta, bytes },
    thumbRecord: { photoId: thumb.photoId, width: thumb.width, height: thumb.height, bytes: thumbBytes },
  };
}

/** Photos already imported with the same original file (warn, never block). */
export async function findPhotosByOriginalHash(originalFileSha256: string): Promise<PhotoMeta[]> {
  const rows = await getDb().photos.where("originalFileSha256").equals(originalFileSha256).toArray();
  return rows.map(photoMetaFromRecord);
}

export async function createCaptureBatch(
  mode: CaptureBatch["mode"],
  source: CaptureBatch["source"],
  itemCount: number,
): Promise<CaptureBatch> {
  const batch: CaptureBatch = { id: newId(), mode, source, createdAt: now(), itemCount };
  await getDb().captureBatches.add(batch);
  return batch;
}

/**
 * Persists a captured/imported photo and a pending draft copy in one transaction.
 * This runs before any remote call so the photo survives network interruptions.
 */
export async function createDraftFromPhoto(
  input: StorePhotoInput,
  captureBatchId: string | null,
): Promise<{ copy: Copy; photo: PhotoAsset }> {
  const db = getDb();
  const { collection } = await ensureDefaults();
  const { photo, record, thumbRecord } = await buildRecords(input);
  const t = now();
  const copy: Copy = {
    id: newId(),
    collectionId: collection.id,
    albumId: null,
    provisionalTitle: "",
    coverPhotoId: photo.id,
    photoIds: [photo.id],
    pressingYear: null,
    label: null,
    catalogNumber: null,
    country: null,
    discCount: null,
    notes: "",
    investigateValue: false,
    reviewStatus: "pendingReview",
    captureBatchId,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  await db.transaction("rw", [db.photos, db.thumbnails, db.copies, db.settings], async () => {
    await db.photos.add(record);
    await db.thumbnails.add(thumbRecord);
    await db.copies.add(copy);
    await markChanged();
  });
  return { copy, photo };
}

/** Adds a photo (crop, back cover, label…) to an existing copy, optionally making it the cover. */
export async function addPhotoToCopy(
  copyId: string,
  input: StorePhotoInput,
  options: { makeCover: boolean },
): Promise<PhotoAsset> {
  const db = getDb();
  const { photo, record, thumbRecord } = await buildRecords(input);
  await db.transaction("rw", [db.photos, db.thumbnails, db.copies, db.settings], async () => {
    const copy = await db.copies.get(copyId);
    if (!copy) throw new Error("El ejemplar no existe.");
    await db.photos.add(record);
    await db.thumbnails.add(thumbRecord);
    await db.copies.update(copyId, {
      photoIds: [...copy.photoIds, photo.id],
      coverPhotoId: options.makeCover ? photo.id : copy.coverPhotoId,
      updatedAt: now(),
    });
    await markChanged();
  });
  return photo;
}

/** Picks the photo shown in the inventory: prefer a cover, then any non-source photo, then a source. */
function pickCover(photos: PhotoMeta[]): string | null {
  return (
    photos.find((p) => p.kind === "cover")?.id ??
    photos.find((p) => p.kind !== "source")?.id ??
    photos[0]?.id ??
    null
  );
}

/**
 * Manual entry: creates a copy with optional photos (cover, back, label…) and all its details.
 * Photos and the copy are written in one transaction so nothing is half-saved.
 */
export async function createManualCopy(
  values: CopyFormValues,
  reviewStatus: ReviewStatus,
  photos: StorePhotoInput[],
): Promise<Copy> {
  const db = getDb();
  const { collection } = await ensureDefaults();
  const built: Awaited<ReturnType<typeof buildRecords>>[] = [];
  for (const p of photos) built.push(await buildRecords(p));
  const t = now();
  const copy: Copy = {
    id: newId(),
    collectionId: collection.id,
    albumId: null,
    provisionalTitle: values.title.trim(),
    coverPhotoId: pickCover(built.map((b) => b.photo)),
    photoIds: built.map((b) => b.photo.id),
    pressingYear: null,
    label: null,
    catalogNumber: null,
    country: null,
    discCount: null,
    notes: "",
    investigateValue: false,
    reviewStatus: "pendingReview",
    captureBatchId: null,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  await db.transaction("rw", [db.photos, db.thumbnails, db.copies, db.settings], async () => {
    for (const b of built) {
      await db.photos.add(b.record);
      await db.thumbnails.add(b.thumbRecord);
    }
    await db.copies.add(copy);
    await markChanged();
  });
  return saveCopyDetails(copy.id, values, reviewStatus);
}

export async function setCoverPhoto(copyId: string, photoId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.copies, db.settings], async () => {
    const copy = await db.copies.get(copyId);
    if (!copy?.photoIds.includes(photoId)) throw new Error("La foto no pertenece a este ejemplar.");
    await db.copies.update(copyId, { coverPhotoId: photoId, updatedAt: now() });
    await markChanged();
  });
}

/**
 * Removes a photo from a copy. The image is deleted only if no other copy uses it
 * and no remaining photo was cropped from it.
 */
export async function removePhotoFromCopy(copyId: string, photoId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.copies, db.photos, db.thumbnails, db.settings], async () => {
    const copy = await db.copies.get(copyId);
    if (!copy?.photoIds.includes(photoId)) return;
    const photoIds = copy.photoIds.filter((id) => id !== photoId);
    const remaining = (await db.photos.bulkGet(photoIds)).filter((r): r is PhotoRecord => !!r).map(photoMetaFromRecord);
    const coverPhotoId = copy.coverPhotoId === photoId ? pickCover(remaining) : copy.coverPhotoId;
    await db.copies.update(copyId, { photoIds, coverPhotoId, updatedAt: now() });
    const usedElsewhere = await db.copies.filter((c) => c.photoIds.includes(photoId)).count();
    const isSource = (await db.photos.where("sourcePhotoId").equals(photoId).count()) > 0;
    if (!usedElsewhere && !isSource) {
      await db.photos.delete(photoId);
      await db.thumbnails.delete(photoId);
    }
    await markChanged();
  });
}

export interface CopyFormValues {
  title: string;
  credits: ArtistCredit[];
  originalYear: number | null;
  genres: string[];
  languages: string[];
  pressingYear: number | null;
  label: string | null;
  catalogNumber: string | null;
  country: string | null;
  discCount: number | null;
  notes: string;
  investigateValue: boolean;
}

const ALBUM_FORM_FIELDS = ["title", "credits", "originalYear", "genres", "languages"] as const;

/**
 * Saves user-entered values. Every album field touched here is marked as source "user",
 * so later model/catalog enrichment must not overwrite it.
 */
export async function saveCopyDetails(
  copyId: string,
  values: CopyFormValues,
  reviewStatus: ReviewStatus,
): Promise<Copy> {
  const db = getDb();
  return db.transaction("rw", [db.copies, db.albums, db.settings], async () => {
    const copy = await db.copies.get(copyId);
    if (!copy) throw new Error("El ejemplar no existe.");
    const t = now();
    const hasAlbumData = values.title.trim() !== "" || values.credits.length > 0;
    let albumId = copy.albumId;
    if (hasAlbumData) {
      const existing = albumId ? await db.albums.get(albumId) : undefined;
      const fieldSources = { ...(existing?.fieldSources ?? {}) };
      for (const f of ALBUM_FORM_FIELDS) fieldSources[f] = "user";
      const album: Album = {
        id: existing?.id ?? newId(),
        title: values.title.trim(),
        credits: values.credits,
        originalYear: values.originalYear,
        genres: values.genres,
        languages: values.languages,
        externalIds: existing?.externalIds ?? {},
        fieldSources,
        createdAt: existing?.createdAt ?? t,
        updatedAt: t,
      };
      await db.albums.put(album);
      albumId = album.id;
    }
    const updated: Copy = {
      ...copy,
      albumId,
      provisionalTitle: values.title.trim(),
      pressingYear: values.pressingYear,
      label: values.label,
      catalogNumber: values.catalogNumber,
      country: values.country,
      discCount: values.discCount,
      notes: values.notes,
      investigateValue: values.investigateValue,
      reviewStatus,
      updatedAt: t,
    };
    await db.copies.put(updated);
    await markChanged();
    return updated;
  });
}

export async function softDeleteCopy(copyId: string): Promise<void> {
  await getDb().copies.update(copyId, { deletedAt: now(), updatedAt: now() });
  await markChanged();
}

export async function restoreDeletedCopy(copyId: string): Promise<void> {
  await getDb().copies.update(copyId, { deletedAt: null, updatedAt: now() });
  await markChanged();
}

export interface InventoryItem {
  copy: Copy;
  album: Album | null;
}

/** Loads metadata only (no image blobs). */
export async function listInventory(options: { includeDeleted?: boolean } = {}): Promise<InventoryItem[]> {
  const db = getDb();
  const copies = await db.copies.orderBy("createdAt").reverse().toArray();
  const visible = options.includeDeleted ? copies : copies.filter((c) => !c.deletedAt);
  const albumIds = [...new Set(visible.map((c) => c.albumId).filter((id): id is string => !!id))];
  const albums = await db.albums.bulkGet(albumIds);
  const byId = new Map(albums.filter((a): a is Album => !!a).map((a) => [a.id, a]));
  return visible.map((copy) => ({ copy, album: copy.albumId ? (byId.get(copy.albumId) ?? null) : null }));
}

export async function getCopyWithAlbum(copyId: string): Promise<InventoryItem | null> {
  const db = getDb();
  const copy = await db.copies.get(copyId);
  if (!copy) return null;
  const album = copy.albumId ? ((await db.albums.get(copy.albumId)) ?? null) : null;
  return { copy, album };
}

export async function getPhoto(photoId: string): Promise<PhotoAsset | undefined> {
  const r = await getDb().photos.get(photoId);
  return r && photoFromRecord(r);
}

export async function getPhotoMetas(photoIds: string[]): Promise<PhotoMeta[]> {
  const rows = await getDb().photos.bulkGet(photoIds);
  return rows.filter((r): r is PhotoRecord => !!r).map(photoMetaFromRecord);
}

export async function getThumbnail(photoId: string): Promise<Thumbnail | undefined> {
  const r = await getDb().thumbnails.get(photoId);
  return r && thumbnailFromRecord(r);
}

export interface InventoryCounts {
  copies: number;
  distinctAlbums: number;
  pending: number;
  unidentified: number;
  confirmed: number;
}

/** Copies, albums and pending records are counted separately on purpose. */
export function countInventory(items: InventoryItem[]): InventoryCounts {
  const albums = new Set<string>();
  let pending = 0;
  let unidentified = 0;
  let confirmed = 0;
  for (const { copy } of items) {
    if (copy.albumId) albums.add(copy.albumId);
    if (copy.reviewStatus === "pendingReview") pending++;
    else if (copy.reviewStatus === "unidentified") unidentified++;
    else confirmed++;
  }
  return { copies: items.length, distinctAlbums: albums.size, pending, unidentified, confirmed };
}
