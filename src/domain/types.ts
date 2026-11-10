import { z } from "zod";

/** Current IndexedDB / backup data schema version. Bump with a Dexie migration. */
export const DATA_SCHEMA_VERSION = 1;

export const uuidSchema = z.uuid();
const isoDate = z.iso.datetime();

/** Where a field value came from. Model proposals never overwrite "user" values. */
export const fieldSourceSchema = z.enum(["user", "model", "catalog"]);
export type FieldSource = z.infer<typeof fieldSourceSchema>;

export const creditRoleSchema = z.enum([
  "artist",
  "composer",
  "performer",
  "conductor",
  "orchestra",
  "other",
]);
export type CreditRole = z.infer<typeof creditRoleSchema>;

export const artistCreditSchema = z.object({
  name: z.string().min(1).max(300),
  role: creditRoleSchema,
});
export type ArtistCredit = z.infer<typeof artistCreditSchema>;

export const collectionSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Collection = z.infer<typeof collectionSchema>;

export const externalIdsSchema = z.object({
  musicbrainzReleaseGroupId: z.string().max(100).optional(),
  musicbrainzReleaseId: z.string().max(100).optional(),
  discogsMasterId: z.string().max(100).optional(),
  discogsReleaseId: z.string().max(100).optional(),
});

const yearSchema = z.number().int().min(1880).max(2100);

export const albumSchema = z.object({
  id: uuidSchema,
  title: z.string().max(500),
  credits: z.array(artistCreditSchema).max(50),
  /** Original release year of the album. null = unknown (never 0). */
  originalYear: yearSchema.nullable(),
  genres: z.array(z.string().min(1).max(100)).max(20),
  /** Sung languages. "instrumental" is a valid explicit value. Empty = unknown. */
  languages: z.array(z.string().min(1).max(60)).max(20),
  externalIds: externalIdsSchema,
  fieldSources: z.record(z.string(), fieldSourceSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Album = z.infer<typeof albumSchema>;

export const reviewStatusSchema = z.enum(["pendingReview", "confirmed", "unidentified"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const copySchema = z.object({
  id: uuidSchema,
  collectionId: uuidSchema,
  albumId: uuidSchema.nullable(),
  provisionalTitle: z.string().max(500),
  /** Cover photo shown in the inventory. */
  coverPhotoId: uuidSchema.nullable(),
  photoIds: z.array(uuidSchema).max(50),
  pressingYear: yearSchema.nullable(),
  label: z.string().max(300).nullable(),
  catalogNumber: z.string().max(100).nullable(),
  country: z.string().max(100).nullable(),
  /** Number of physical discs inside this copy, when known. */
  discCount: z.number().int().min(1).max(50).nullable(),
  notes: z.string().max(10000),
  investigateValue: z.boolean(),
  reviewStatus: reviewStatusSchema,
  captureBatchId: uuidSchema.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  /** Soft delete; allows undo/recovery. */
  deletedAt: isoDate.nullable(),
});
export type Copy = z.infer<typeof copySchema>;

export const photoKindSchema = z.enum(["cover", "back", "label", "source"]);
export type PhotoKind = z.infer<typeof photoKindSchema>;

/** Normalized rectangle: x/y/width/height in [0,1], origin top-left, relative to the oriented source. */
export const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});
export type NormalizedRect = z.infer<typeof normalizedRectSchema>;

export const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof rotationSchema>;

export const photoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const photoMetaSchema = z.object({
  id: uuidSchema,
  kind: photoKindSchema,
  mimeType: photoMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Hash of the file the user picked (before re-encoding), for re-import warnings. */
  originalFileSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  originalFileName: z.string().max(300).nullable(),
  /** For crops: the source PhotoAsset and region used (region relative to the rotated source). */
  sourcePhotoId: uuidSchema.nullable(),
  region: normalizedRectSchema.nullable(),
  rotation: rotationSchema,
  createdAt: isoDate,
});
export type PhotoMeta = z.infer<typeof photoMetaSchema>;

export interface PhotoAsset extends PhotoMeta {
  blob: Blob;
}

/** Thumbnails are stored apart (keyed by photo id) so listing never loads full images. */
export interface Thumbnail {
  photoId: string;
  blob: Blob;
  width: number;
  height: number;
}

export const captureBatchSchema = z.object({
  id: uuidSchema,
  mode: z.enum(["single", "multiple"]),
  source: z.enum(["camera", "gallery"]),
  createdAt: isoDate,
  itemCount: z.number().int().nonnegative(),
});
export type CaptureBatch = z.infer<typeof captureBatchSchema>;

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Declared now so the DB schema is stable; the queue runner arrives in Phases 2–3. */
export interface IdentificationJob {
  id: string;
  kind: "detectCovers" | "identifyRecord";
  targetPhotoId: string;
  copyId: string | null;
  status: JobStatus;
  attempts: number;
  promptVersion: string | null;
  model: string | null;
  result: unknown;
  error: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  key: "app";
  collectionTitle: string;
  lastBackupAt: string | null;
  lastChangeAt: string | null;
  recognitionConsentAt: string | null;
}

export const LANGUAGE_INSTRUMENTAL = "instrumental";
