import { strToU8, unzipSync, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { inventoryToCsv } from "@/backup/csv-export";
import { applyRestore, buildBackup, prepareRestore } from "@/backup/zip-backup";
import { sha256Hex } from "@/imaging/hash";
import { ArchivoDb, getDb, setDbForTests } from "@/persistence/db";
import {
  addPhotoToCopy,
  countInventory,
  createDraftFromPhoto,
  listInventory,
  saveCopyDetails,
  softDeleteCopy,
  restoreDeletedCopy,
  type CopyFormValues,
  type StorePhotoInput,
} from "@/persistence/repository";

let dbCounter = 0;
function freshDb() {
  const db = new ArchivoDb(`test-${Date.now()}-${dbCounter++}`);
  setDbForTests(db);
  return db;
}

async function photoInput(seed: string, extra: Partial<StorePhotoInput> = {}): Promise<StorePhotoInput> {
  const bytes = strToU8(`fake-jpeg-${seed}`);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/jpeg" });
  return {
    kind: "source",
    image: { blob, width: 2048, height: 1536, mimeType: "image/jpeg" },
    thumbnail: { blob: new Blob([`thumb-${seed}`], { type: "image/jpeg" }), width: 320, height: 240, mimeType: "image/jpeg" },
    sha256: await sha256Hex(bytes),
    originalFileSha256: await sha256Hex(strToU8(`orig-${seed}`)),
    originalFileName: `${seed}.jpg`,
    ...extra,
  };
}

const values = (over: Partial<CopyFormValues> = {}): CopyFormValues => ({
  title: "Él",
  credits: [{ name: "Juan Gabriel", role: "artist" }],
  originalYear: 1984,
  genres: ["Balada"],
  languages: ["español"],
  pressingYear: null,
  label: "Ariola",
  catalogNumber: "=CMD-1234",
  country: "México",
  discCount: 1,
  notes: 'Funda con "nota", y coma',
  investigateValue: true,
  ...over,
});

async function seedOne(seed = "a") {
  const { copy, photo } = await createDraftFromPhoto(await photoInput(seed), null);
  const crop = await addPhotoToCopy(
    copy.id,
    await photoInput(`${seed}-crop`, { kind: "cover", sourcePhotoId: photo.id, region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, rotation: 90 }),
    { makeCover: true },
  );
  await saveCopyDetails(copy.id, values(), "confirmed");
  return { copyId: copy.id, sourceId: photo.id, cropId: crop.id };
}

beforeEach(() => {
  freshDb();
});

describe("repository", () => {
  it("saves a draft with its photo before any identification", async () => {
    const { copy } = await createDraftFromPhoto(await photoInput("x"), null);
    const items = await listInventory();
    expect(items).toHaveLength(1);
    expect(items[0].copy.reviewStatus).toBe("pendingReview");
    expect(await getDb().photos.get(copy.coverPhotoId!)).toBeTruthy();
    expect(await getDb().thumbnails.get(copy.coverPhotoId!)).toBeTruthy();
  });

  it("stores the crop as cover, keeps the source, and marks user fields", async () => {
    const { copyId, sourceId, cropId } = await seedOne();
    const db = getDb();
    const copy = (await db.copies.get(copyId))!;
    expect(copy.coverPhotoId).toBe(cropId);
    expect(copy.photoIds).toEqual([sourceId, cropId]);
    expect(copy.reviewStatus).toBe("confirmed");
    const album = (await db.albums.get(copy.albumId!))!;
    expect(album.title).toBe("Él");
    expect(album.fieldSources.title).toBe("user");
    expect(album.fieldSources.credits).toBe("user");
  });

  it("keeps an unknown record without inventing an album", async () => {
    const { copy } = await createDraftFromPhoto(await photoInput("u"), null);
    await saveCopyDetails(copy.id, values({ title: "", credits: [], originalYear: null }), "unidentified");
    const saved = (await getDb().copies.get(copy.id))!;
    expect(saved.albumId).toBeNull();
    expect(saved.reviewStatus).toBe("unidentified");
  });

  it("counts copies, albums and pending separately; two copies of one album are legitimate", async () => {
    await seedOne("a");
    await seedOne("b");
    await createDraftFromPhoto(await photoInput("c"), null);
    const counts = countInventory(await listInventory());
    expect(counts).toMatchObject({ copies: 3, pending: 1, confirmed: 2 });
  });

  it("soft-deletes and restores", async () => {
    const { copyId } = await seedOne();
    await softDeleteCopy(copyId);
    expect(await listInventory()).toHaveLength(0);
    expect(await getDb().photos.count()).toBe(2);
    await restoreDeletedCopy(copyId);
    expect(await listInventory()).toHaveLength(1);
  });
});

describe("backup", () => {
  it("round-trips copies, albums, photos and relations into an empty database", async () => {
    const { copyId, sourceId, cropId } = await seedOne();
    const before = (await getDb().photos.get(cropId))!;
    const { blob, manifest } = await buildBackup("all");
    expect(manifest.counts).toMatchObject({ copies: 1, photos: 2 });

    const target = freshDb();
    const preview = await prepareRestore(blob);
    expect(preview.newCopies).toBe(1);
    const r = await applyRestore(preview);
    expect(r).toEqual({ addedCopies: 1, skippedCopies: 0 });

    const copy = (await target.copies.get(copyId))!;
    expect(copy.coverPhotoId).toBe(cropId);
    const crop = (await target.photos.get(cropId))!;
    expect(crop.sourcePhotoId).toBe(sourceId);
    expect(crop.region).toEqual(before.region);
    expect(crop.rotation).toBe(90);
    expect(await sha256Hex(crop.bytes)).toBe(before.sha256);
    expect(await target.thumbnails.get(cropId)).toBeTruthy();
    expect((await target.albums.get(copy.albumId!))!.title).toBe("Él");
  });

  it("selected export includes source photos of crops", async () => {
    const a = await seedOne("a");
    await seedOne("b");
    const { blob, manifest } = await buildBackup([a.copyId]);
    expect(manifest.counts).toMatchObject({ copies: 1, photos: 2 });
    const names = Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())));
    expect(names).toContain(`photos/${a.sourceId}.jpg`);
  });

  it("restoring twice does not duplicate copies", async () => {
    await seedOne();
    const { blob } = await buildBackup("all");
    const r = await applyRestore(await prepareRestore(blob));
    expect(r).toEqual({ addedCopies: 0, skippedCopies: 1 });
    expect(await getDb().copies.count()).toBe(1);
  });

  it("rejects a corrupted backup and leaves existing data intact", async () => {
    await seedOne("a");
    const { blob } = await buildBackup("all");
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const photoPath = Object.keys(entries).find((n) => n.startsWith("photos/"))!;
    entries[photoPath] = strToU8("tampered");
    const corrupted = new Blob([zipSync(entries).slice().buffer as ArrayBuffer]);

    freshDb();
    await seedOne("existing");
    const beforeCount = await getDb().copies.count();
    await expect(prepareRestore(corrupted)).rejects.toThrow(/Checksum|dañado/);
    expect(await getDb().copies.count()).toBe(beforeCount);
  });

  it("rejects unexpected entries such as path traversal", async () => {
    await seedOne();
    const { blob } = await buildBackup("all");
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    entries["../evil.txt"] = strToU8("x");
    await expect(prepareRestore(new Blob([zipSync(entries).slice().buffer as ArrayBuffer]))).rejects.toThrow(/no permitida/);
  });

  it("rejects files that are not zips", async () => {
    await expect(prepareRestore(new Blob(["hola"]))).rejects.toThrow(/ZIP/);
  });

  it("rejects unsupported newer backup versions", async () => {
    await seedOne();
    const { blob } = await buildBackup("all");
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    manifest.formatVersion = 999;
    entries["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(prepareRestore(new Blob([zipSync(entries).slice().buffer as ArrayBuffer]))).rejects.toThrow();
  });
});

describe("csv export", () => {
  it("exports readable Spanish columns with escaping", async () => {
    await seedOne();
    const csv = inventoryToCsv(await listInventory());
    const [header, row] = csv.replace("\uFEFF", "").split("\r\n");
    expect(header).toContain("titulo,artistas,anio_original");
    expect(row).toContain("Juan Gabriel");
    expect(row).toContain("'=CMD-1234");
    expect(row).toContain('"Funda con ""nota"", y coma"');
  });
});
