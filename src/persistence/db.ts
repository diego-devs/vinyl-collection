import Dexie, { type EntityTable } from "dexie";
import type {
  Album,
  CaptureBatch,
  Collection,
  Copy,
  IdentificationJob,
  PhotoAsset,
  PhotoMeta,
  Settings,
  Thumbnail,
} from "@/domain/types";

export const DB_NAME = "archivo-lp";

/**
 * Image bytes are stored as ArrayBuffer, not Blob: WebKit builds have failed to persist Blobs in
 * IndexedDB (reproduced with Playwright WebKit), while ArrayBuffer works everywhere.
 */
export interface PhotoRecord extends PhotoMeta {
  bytes: ArrayBuffer;
}

export interface ThumbnailRecord {
  photoId: string;
  width: number;
  height: number;
  bytes: ArrayBuffer;
}

export function photoFromRecord(r: PhotoRecord): PhotoAsset {
  const { bytes, ...meta } = r;
  return { ...meta, blob: new Blob([bytes], { type: r.mimeType }) };
}

export function photoMetaFromRecord(r: PhotoRecord): PhotoMeta {
  const { bytes: _bytes, ...meta } = r;
  return meta;
}

export function thumbnailFromRecord(r: ThumbnailRecord): Thumbnail {
  const { bytes, ...rest } = r;
  return { ...rest, blob: new Blob([bytes], { type: "image/jpeg" }) };
}

export class ArchivoDb extends Dexie {
  collections!: EntityTable<Collection, "id">;
  albums!: EntityTable<Album, "id">;
  copies!: EntityTable<Copy, "id">;
  photos!: EntityTable<PhotoRecord, "id">;
  thumbnails!: EntityTable<ThumbnailRecord, "photoId">;
  captureBatches!: EntityTable<CaptureBatch, "id">;
  jobs!: EntityTable<IdentificationJob, "id">;
  settings!: EntityTable<Settings, "key">;

  constructor(name = DB_NAME) {
    super(name);
    // Schema history. Never edit a released version; add a new .version(n) with .upgrade().
    this.version(1).stores({
      collections: "id",
      albums: "id, title, updatedAt",
      copies: "id, collectionId, albumId, reviewStatus, captureBatchId, updatedAt, createdAt, deletedAt",
      photos: "id, kind, sha256, originalFileSha256, sourcePhotoId",
      thumbnails: "photoId",
      captureBatches: "id, createdAt",
      jobs: "id, status, targetPhotoId, copyId, &idempotencyKey",
      settings: "key",
    });
  }
}

let instance: ArchivoDb | null = null;

export function getDb(): ArchivoDb {
  instance ??= new ArchivoDb();
  return instance;
}

/** Test hook: use a fresh database. */
export function setDbForTests(db: ArchivoDb | null) {
  instance = db;
}
