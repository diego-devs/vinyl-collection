"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { displayTitle, findPossibleDuplicates } from "@/domain/normalize";
import type { NormalizedRect, Rotation } from "@/domain/types";
import { cropStoredPhoto } from "@/imaging/process";
import {
  addPhotoToCopy,
  getCopyWithAlbum,
  getPhoto,
  listInventory,
  saveCopyDetails,
  type CopyFormValues,
} from "@/persistence/repository";
import { CopyForm } from "./CopyForm";
import { CropEditor } from "./CropEditor";
import { CoverThumb } from "./CoverThumb";
import { PhotoManager } from "./PhotoManager";

export function ReviewView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id") ?? "";
  const data = useLiveQuery(async () => {
    const item = await getCopyWithAlbum(id);
    if (!item) return { item: null, cover: null, source: null };
    const cover = item.copy.coverPhotoId ? await getPhoto(item.copy.coverPhotoId) : undefined;
    const sourceId = cover?.kind === "source" ? cover.id : cover?.sourcePhotoId;
    const source = sourceId ? await getPhoto(sourceId) : undefined;
    return { item, cover: cover ?? null, source: source ?? null };
  }, [id]);
  const inventory = useLiveQuery(() => listInventory(), []);
  const [recrop, setRecrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<CopyFormValues | null>(null);

  const duplicates = useMemo(() => {
    if (!data?.item || !inventory) return [];
    const title = live?.title ?? (data.item.album?.title || data.item.copy.provisionalTitle);
    const artists = live?.credits.map((c) => c.name) ?? data.item.album?.credits.map((c) => c.name) ?? [];
    const catalogNumber = live ? live.catalogNumber : data.item.copy.catalogNumber;
    const signals = findPossibleDuplicates({ copyId: data.item.copy.id, title, artists, catalogNumber }, inventory);
    return signals.map((s) => ({ ...s, item: inventory.find((i) => i.copy.id === s.copyId)! }));
  }, [data, inventory, live]);

  if (!data) return <p className="text-muted">Cargando…</p>;
  if (!data.item)
    return (
      <p>
        No se encontró este registro. <Link href="/" className="text-accent underline">Volver a la colección</Link>
      </p>
    );

  const { copy, album } = data.item;
  const needsCrop = data.cover?.kind === "source" || recrop;

  async function confirmCrop(rotation: Rotation, rect: NormalizedRect) {
    if (!data?.source) return;
    setBusy(true);
    setError(null);
    try {
      const cropped = await cropStoredPhoto(data.source.blob, rotation, rect);
      await addPhotoToCopy(
        copy.id,
        {
          kind: "cover",
          image: cropped.image,
          thumbnail: cropped.thumbnail,
          sha256: cropped.sha256,
          sourcePhotoId: data.source.id,
          region: rect,
          rotation,
        },
        { makeCover: true },
      );
      setRecrop(false);
    } catch {
      setError("No se pudo recortar la imagen. La foto original sigue guardada.");
    } finally {
      setBusy(false);
    }
  }

  async function save(values: CopyFormValues, status: Parameters<typeof saveCopyDetails>[2]) {
    setBusy(true);
    setError(null);
    try {
      await saveCopyDetails(copy.id, values, status);
      router.push(status === "pendingReview" ? "/pendientes" : `/ejemplar?id=${copy.id}`);
    } catch {
      setError("No se pudo guardar. Revisa el espacio disponible e inténtalo de nuevo.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-semibold">{needsCrop ? "Recortar la portada" : "Datos del disco"}</h1>
      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {needsCrop && data.source ? (
        <>
          <CropEditor source={data.source.blob} busy={busy} onConfirm={confirmCrop} />
          {recrop && (
            <button type="button" className="btn w-full" onClick={() => setRecrop(false)}>
              Cancelar y mantener el recorte actual
            </button>
          )}
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <CoverThumb photoId={copy.coverPhotoId} alt={`Portada de ${displayTitle(copy, album)}`} className="w-32 shrink-0" />
            <div className="space-y-2 text-sm text-muted">
              <p>Escribe lo que puedas leer. Ningún campo es obligatorio: un disco desconocido también se guarda.</p>
              {data.source && (
                <button type="button" className="btn" onClick={() => setRecrop(true)}>
                  Volver a recortar
                </button>
              )}
            </div>
          </div>

          {duplicates.length > 0 && (
            <section role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
              <p className="font-semibold text-warn">Posible repetido</p>
              <p className="mt-1">
                Ya hay registros parecidos. Se guardará como otro ejemplar; nada se fusiona ni se borra automáticamente.
              </p>
              <ul className="mt-2 list-disc pl-5">
                {duplicates.map((d) => (
                  <li key={d.copyId}>
                    <Link className="text-accent underline" href={`/ejemplar?id=${d.copyId}`}>
                      {displayTitle(d.item.copy, d.item.album)}
                    </Link>{" "}
                    ({d.reason === "sameCatalogNumber" ? "mismo número de catálogo" : "mismo título y artista"})
                  </li>
                ))}
              </ul>
            </section>
          )}

          <CopyForm key={copy.id} copy={copy} album={album} busy={busy} onSave={save} onChange={setLive} />

          <PhotoManager copy={copy} />
        </>
      )}
    </div>
  );
}
