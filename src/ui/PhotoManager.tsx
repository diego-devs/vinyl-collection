"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import type { Copy } from "@/domain/types";
import { addPhotoToCopy, getPhotoMetas, removePhotoFromCopy, setCoverPhoto } from "@/persistence/repository";
import { CoverThumb } from "./CoverThumb";
import { importErrorMessage, PHOTO_KIND_LABEL, PhotoPicker, photoInputFromFile, type UploadKind } from "./PhotoPicker";

/** Lets the owner add, remove and choose the main photo of an existing copy. */
export function PhotoManager({ copy }: { copy: Copy }) {
  const photos = useLiveQuery(() => getPhotoMetas(copy.photoIds), [copy.photoIds.join(",")]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function addFiles(files: File[], kind: UploadKind) {
    setBusy(true);
    const problems: string[] = [];
    let hasCover = !!copy.coverPhotoId;
    for (const file of files) {
      try {
        const input = await photoInputFromFile(file, kind);
        await addPhotoToCopy(copy.id, input, { makeCover: kind === "cover" || !hasCover });
        hasCover = true;
      } catch (e) {
        problems.push(importErrorMessage(e, file.name || "imagen"));
      }
    }
    setErrors(problems);
    setBusy(false);
  }

  async function remove(photoId: string) {
    if (!window.confirm("¿Quitar esta foto del ejemplar?")) return;
    setBusy(true);
    try {
      await removePhotoFromCopy(copy.id, photoId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">Fotos del ejemplar ({photos?.length ?? 0})</h2>
      {photos && photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" data-testid="copy-photos">
          {photos.map((p) => {
            const isCover = p.id === copy.coverPhotoId;
            return (
              <li key={p.id} className="space-y-1">
                <CoverThumb photoId={p.id} alt={PHOTO_KIND_LABEL[p.kind]} />
                <p className="text-xs text-muted">
                  {PHOTO_KIND_LABEL[p.kind]}
                  {isCover && " · principal"}
                </p>
                {!isCover && (
                  <button type="button" className="btn w-full py-1 text-xs" disabled={busy} onClick={() => setCoverPhoto(copy.id, p.id)}>
                    Usar como principal
                  </button>
                )}
                <button type="button" className="btn w-full py-1 text-xs text-danger" disabled={busy} onClick={() => remove(p.id)}>
                  Quitar
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <PhotoPicker disabled={busy} onPick={addFiles} />
      {busy && <p className="text-sm text-muted">Guardando…</p>}
      {errors.length > 0 && (
        <ul role="alert" className="text-sm text-danger">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
