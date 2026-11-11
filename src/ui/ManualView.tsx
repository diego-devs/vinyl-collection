"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReviewStatus } from "@/domain/types";
import { createManualCopy, type CopyFormValues, type StorePhotoInput } from "@/persistence/repository";
import { CopyForm } from "./CopyForm";
import { importErrorMessage, PHOTO_KIND_LABEL, PhotoPicker, photoInputFromFile, type UploadKind } from "./PhotoPicker";

interface PendingPhoto {
  key: string;
  kind: UploadKind;
  input: StorePhotoInput;
  url: string;
}

export function ManualView() {
  const router = useRouter();
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [formKey, setFormKey] = useState(0);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const set = urls.current;
    return () => set.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function addFiles(files: File[], kind: UploadKind) {
    setProcessing(true);
    const problems: string[] = [];
    for (const file of files) {
      try {
        const input = await photoInputFromFile(file, kind);
        const url = URL.createObjectURL(input.thumbnail.blob);
        urls.current.add(url);
        setPhotos((prev) => [...prev, { key: crypto.randomUUID(), kind, input, url }]);
      } catch (e) {
        problems.push(importErrorMessage(e, file.name || "imagen"));
      }
    }
    setErrors(problems);
    setProcessing(false);
  }

  function remove(key: string) {
    setPhotos((prev) => {
      const p = prev.find((x) => x.key === key);
      if (p) {
        URL.revokeObjectURL(p.url);
        urls.current.delete(p.url);
      }
      return prev.filter((x) => x.key !== key);
    });
  }

  function setKind(key: string, kind: UploadKind) {
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, kind, input: { ...p.input, kind } } : p)));
  }

  async function save(values: CopyFormValues, status: ReviewStatus) {
    setBusy(true);
    setErrors([]);
    try {
      // The first "Portada" becomes the main cover.
      const ordered = [...photos.filter((p) => p.kind === "cover"), ...photos.filter((p) => p.kind !== "cover")];
      const copy = await createManualCopy(values, status, ordered.map((p) => p.input));
      // Next keeps visited routes mounted (hidden); start clean for the next disc.
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current.clear();
      setPhotos([]);
      setFormKey((k) => k + 1);
      setBusy(false);
      router.push(status === "pendingReview" ? "/pendientes" : `/ejemplar?id=${copy.id}`);
    } catch {
      setErrors(["No se pudo guardar. Revisa el espacio disponible e inténtalo de nuevo."]);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-3xl font-semibold">Agregar manualmente</h1>
      <p className="text-sm text-muted">
        Escribe los datos que conozcas y, si quieres, añade imágenes (portada, contraportada, etiqueta). Ninguna foto es
        obligatoria; podrás añadir más después desde Editar.
      </p>

      <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Imágenes ({photos.length})</h2>
        <PhotoPicker disabled={processing || busy} onPick={addFiles} />
        {processing && <p className="text-sm text-muted">Procesando imágenes…</p>}
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2" data-testid="manual-photos">
            {photos.map((p, i) => (
              <li key={p.key} className="space-y-1">
                <div className="aspect-square overflow-hidden rounded-lg bg-line">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                  <img src={p.url} alt={`${PHOTO_KIND_LABEL[p.kind]} ${i + 1}`} className="h-full w-full object-cover" />
                </div>
                <select
                  aria-label={`Tipo de la imagen ${i + 1}`}
                  className="field py-1 text-xs"
                  value={p.kind}
                  onChange={(e) => setKind(p.key, e.target.value as UploadKind)}
                >
                  {(["cover", "back", "label"] as const).map((k) => (
                    <option key={k} value={k}>
                      {PHOTO_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn w-full py-1 text-xs text-danger" onClick={() => remove(p.key)}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {errors.length > 0 && (
        <ul role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <CopyForm key={formKey} copy={null} album={null} busy={busy || processing} onSave={save} />
    </div>
  );
}
