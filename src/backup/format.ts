import { z } from "zod";
import {
  albumSchema,
  captureBatchSchema,
  collectionSchema,
  copySchema,
  DATA_SCHEMA_VERSION,
  photoMetaSchema,
} from "@/domain/types";

export const BACKUP_FORMAT = "archivo-lp-backup";
export const BACKUP_FORMAT_VERSION = 1;

/** Hard limits applied before and during extraction (zip-bomb / abuse protection). */
export const RESTORE_LIMITS = {
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxEntries: 20_000,
  maxEntryBytes: 40 * 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxJsonBytes: 50 * 1024 * 1024,
};

export const PHOTO_PATH = /^photos\/([0-9a-f-]{36})\.(jpg|png|webp)$/;
export const THUMB_PATH = /^thumbs\/([0-9a-f-]{36})\.jpg$/;

export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int().min(1),
  schemaVersion: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  scope: z.enum(["all", "selection"]),
  counts: z.object({
    collections: z.number().int().nonnegative(),
    albums: z.number().int().nonnegative(),
    copies: z.number().int().nonnegative(),
    photos: z.number().int().nonnegative(),
  }),
  files: z
    .array(
      z.object({
        path: z.string().max(200),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(RESTORE_LIMITS.maxEntries),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export const thumbMetaSchema = z.object({
  photoId: z.uuid(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const backupDataSchema = z.object({
  collections: z.array(collectionSchema),
  albums: z.array(albumSchema),
  copies: z.array(copySchema),
  photos: z.array(photoMetaSchema),
  thumbnails: z.array(thumbMetaSchema),
  captureBatches: z.array(captureBatchSchema),
});
export type BackupData = z.infer<typeof backupDataSchema>;

export function isSupportedManifest(m: BackupManifest): string | null {
  if (m.formatVersion > BACKUP_FORMAT_VERSION) return "El respaldo proviene de una versión más nueva de la app.";
  if (m.schemaVersion > DATA_SCHEMA_VERSION) return "El esquema de datos del respaldo es más nuevo que esta app.";
  return null;
}
