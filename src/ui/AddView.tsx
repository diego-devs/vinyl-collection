"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { importImageFile, ImageImportError } from "@/imaging/process";
import { createCaptureBatch, createDraftFromPhoto, findPhotosByOriginalHash } from "@/persistence/repository";

interface ItemState {
  name: string;
  status: "waiting" | "processing" | "saved" | "error";
  copyId?: string;
  message?: string;
}

export function AddView() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [items, setItems] = useState<ItemState[]>([]);
  const [running, setRunning] = useState(false);

  async function handleFiles(fileList: FileList | null, source: "camera" | "gallery") {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    setRunning(true);
    setItems(files.map((f) => ({ name: f.name || "foto", status: "waiting" })));
    const batch = await createCaptureBatch(mode, source, files.length);
    const update = (i: number, patch: Partial<ItemState>) =>
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
    const created: string[] = [];
    // Sequential on purpose: keeps memory bounded on the iPhone.
    for (const [i, file] of files.entries()) {
      update(i, { status: "processing" });
      try {
        const img = await importImageFile(file);
        const previous = await findPhotosByOriginalHash(img.originalFileSha256);
        const { copy } = await createDraftFromPhoto(
          {
            kind: "source",
            image: img.work,
            thumbnail: img.thumbnail,
            sha256: img.workSha256,
            originalFileSha256: img.originalFileSha256,
            originalFileName: img.originalFileName,
          },
          batch.id,
        );
        created.push(copy.id);
        update(i, {
          status: "saved",
          copyId: copy.id,
          message: previous.length
            ? "Guardada. Aviso: esta misma foto ya se había importado; puede ser otro ejemplar o un repetido."
            : "Guardada en el dispositivo.",
        });
      } catch (e) {
        update(i, {
          status: "error",
          message: e instanceof ImageImportError ? e.message : "No se pudo guardar esta foto. Las demás continúan.",
        });
      }
    }
    setRunning(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
    // Immediate-confirmation flow for a single photo.
    if (files.length === 1 && created.length === 1 && mode === "single") {
      router.push(`/revisar?id=${created[0]}`);
    }
  }

  const saved = items.filter((i) => i.status === "saved").length;

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-3xl font-semibold">Agregar discos</h1>

      <fieldset className="rounded-2xl border border-line bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-muted">¿Qué hay en la foto?</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className={`btn ${mode === "single" ? "btn-primary" : ""}`}>
            <input type="radio" name="mode" className="sr-only" checked={mode === "single"} onChange={() => setMode("single")} />
            Un disco
          </label>
          <label className={`btn ${mode === "multiple" ? "btn-primary" : ""}`}>
            <input type="radio" name="mode" className="sr-only" checked={mode === "multiple"} onChange={() => setMode("multiple")} />
            Varios discos
          </label>
        </div>
        {mode === "multiple" && (
          <p className="mt-3 text-sm text-warn">
            La separación automática de varias portadas llegará en una próxima fase. Por ahora la foto se guarda y puedes
            recortar manualmente una portada; para las demás, vuelve a importar la foto o fotografíalas por separado.
          </p>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" className="btn btn-primary min-h-16 text-lg" disabled={running} onClick={() => cameraRef.current?.click()}>
          Tomar foto
        </button>
        <button type="button" className="btn min-h-16 text-lg" disabled={running} onClick={() => galleryRef.current?.click()}>
          Elegir de la galería
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          data-testid="camera-input"
          onChange={(e) => handleFiles(e.target.files, "camera")}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,image/*"
          multiple
          className="hidden"
          data-testid="gallery-input"
          onChange={(e) => handleFiles(e.target.files, "gallery")}
        />
      </div>

      <p className="text-sm text-muted">
        Las fotos se procesan una a una y se guardan primero en este dispositivo (sin ubicación ni metadatos), antes de
        cualquier envío a internet. Una foto tomada aquí no siempre queda en tu app Fotos: el respaldo de la app es la
        copia de seguridad.
      </p>

      <Link href="/manual" className="btn w-full">
        Agregar manualmente (escribir datos y subir imágenes)
      </Link>

      {items.length > 0 && (
        <section aria-live="polite" className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">
            {running ? "Procesando" : "Listo"}: {saved} de {items.length} guardadas
          </h2>
          <progress className="mt-2 w-full" max={items.length} value={items.filter((i) => i.status === "saved" || i.status === "error").length} />
          <ul className="mt-3 space-y-2 text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate">{it.name}</span>
                <span className={it.status === "error" ? "text-danger" : it.status === "saved" ? "text-ok" : "text-muted"}>
                  {it.status === "waiting" ? "En espera" : it.status === "processing" ? "Procesando…" : it.message}
                </span>
                {it.copyId && (
                  <Link className="text-accent underline" href={`/revisar?id=${it.copyId}`}>
                    Revisar
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {!running && saved > 1 && (
            <Link href="/pendientes" className="btn mt-3">
              Ir a pendientes
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
