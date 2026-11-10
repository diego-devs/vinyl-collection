"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { buildBackup } from "@/backup/zip-backup";
import { saveOrShareFile, timestampForFile } from "@/backup/save-file";
import { displayArtists, displayTitle } from "@/domain/normalize";
import { LANGUAGE_INSTRUMENTAL, type CreditRole } from "@/domain/types";
import { getCopyWithAlbum, getPhotoMetas, restoreDeletedCopy, softDeleteCopy, updateSettings } from "@/persistence/repository";
import { CoverThumb, StatusBadge } from "./CoverThumb";
import { usePhotoUrl } from "./hooks";

const ROLE_LABEL: Record<CreditRole, string> = {
  artist: "Artista",
  composer: "Compositor/a",
  performer: "Intérprete",
  conductor: "Director/a",
  orchestra: "Orquesta",
  other: "Otro",
};

const KIND_LABEL = { cover: "Portada", back: "Contraportada", label: "Etiqueta", source: "Foto original" } as const;

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value === null || value === undefined || value === "" ? "Desconocido" : value}</dd>
    </div>
  );
}

export function DetailView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const item = useLiveQuery(async () => (await getCopyWithAlbum(id)) ?? null, [id]);
  const photos = useLiveQuery(
    async () => (item ? getPhotoMetas(item.copy.photoIds) : []),
    [item?.copy.photoIds.join(",")],
  );
  const [zoom, setZoom] = useState<string | null>(null);
  const zoomUrl = usePhotoUrl(zoom);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (item === undefined) return <p className="text-muted">Cargando…</p>;
  if (item === null)
    return (
      <p>
        No se encontró este registro. <Link href="/" className="text-accent underline">Volver a la colección</Link>
      </p>
    );

  const { copy, album } = item;
  const title = displayTitle(copy, album);
  const langs = album?.languages ?? [];

  async function exportOne() {
    setBusy(true);
    setMessage(null);
    try {
      const { blob } = await buildBackup([copy.id]);
      const r = await saveOrShareFile(blob, `archivo-lp-ejemplar-${timestampForFile()}.zip`);
      if (r !== "cancelled") {
        await updateSettings({ lastBackupAt: new Date().toISOString() });
        setMessage("Ejemplar exportado con sus fotos.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo exportar.");
    } finally {
      setBusy(false);
    }
  }

  if (copy.deletedAt) {
    return (
      <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <p className="font-semibold">“{title}” está en la papelera.</p>
        <p className="text-sm text-muted">Sus fotos siguen guardadas en este dispositivo.</p>
        <button type="button" className="btn btn-primary" onClick={() => restoreDeletedCopy(copy.id)}>
          Deshacer y restaurar
        </button>
        <Link href="/" className="btn ml-2">
          Volver a la colección
        </Link>
      </div>
    );
  }

  return (
    <article className="space-y-5">
      <div className="flex items-start gap-4">
        <CoverThumb photoId={copy.coverPhotoId} alt={`Portada de ${title}`} className="w-36 shrink-0" />
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold leading-tight">{title}</h1>
          <p className="text-muted">{displayArtists(album)}</p>
          <div className="mt-2">
            <StatusBadge status={copy.reviewStatus} />
          </div>
          {copy.investigateValue && <p className="mt-2 text-sm text-accent">Investigar valor</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/revisar?id=${copy.id}`} className="btn btn-primary">
          Editar
        </Link>
        <button type="button" className="btn" disabled={busy} onClick={exportOne}>
          Exportar este ejemplar
        </button>
        <button
          type="button"
          className="btn text-danger"
          onClick={() => softDeleteCopy(copy.id)}
        >
          Eliminar
        </button>
      </div>
      {message && (
        <p role="status" className="rounded-xl bg-card p-3 text-sm">
          {message}
        </p>
      )}

      <section>
        <h2 className="mb-1 font-semibold">Álbum</h2>
        <dl className="rounded-xl border border-line bg-card px-3">
          {(album?.credits ?? []).map((c, i) => (
            <Row key={i} label={ROLE_LABEL[c.role]} value={c.name} />
          ))}
          <Row label="Año original" value={album?.originalYear} />
          <Row label="Géneros" value={album?.genres.join(", ")} />
          <Row
            label="Idiomas"
            value={langs.map((l) => (l === LANGUAGE_INSTRUMENTAL ? "Instrumental" : l)).join(", ")}
          />
        </dl>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Este ejemplar</h2>
        <dl className="rounded-xl border border-line bg-card px-3">
          <Row label="Año de la edición" value={copy.pressingYear} />
          <Row label="Sello" value={copy.label} />
          <Row label="Número de catálogo" value={copy.catalogNumber} />
          <Row label="País" value={copy.country} />
          <Row label="Discos dentro" value={copy.discCount} />
          <Row label="Agregado" value={new Date(copy.createdAt).toLocaleDateString("es")} />
        </dl>
        {copy.notes && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-card p-3 text-sm">{copy.notes}</p>}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Fotos ({photos?.length ?? 0})</h2>
        <ul className="grid grid-cols-3 gap-2">
          {(photos ?? []).map((p) => (
            <li key={p.id}>
              <button type="button" className="block w-full text-left" onClick={() => setZoom(p.id)}>
                <CoverThumb photoId={p.id} alt={KIND_LABEL[p.kind]} />
                <span className="text-xs text-muted">{KIND_LABEL[p.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          {zoomUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local blob URL
            <img src={zoomUrl} alt="Foto ampliada" className="max-h-full max-w-full object-contain" />
          )}
          <button type="button" className="btn absolute right-4 top-4" style={{ marginTop: "env(safe-area-inset-top)" }}>
            Cerrar
          </button>
        </div>
      )}
    </article>
  );
}
