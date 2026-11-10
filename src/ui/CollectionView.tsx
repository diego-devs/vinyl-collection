"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { buildBackup } from "@/backup/zip-backup";
import { saveOrShareFile, timestampForFile } from "@/backup/save-file";
import { displayArtists, displayTitle, findPossibleDuplicates, matchesQuery, searchHaystack } from "@/domain/normalize";
import { countInventory, listInventory, updateSettings } from "@/persistence/repository";
import { CoverThumb, StatusBadge } from "./CoverThumb";
import { useSettings } from "./hooks";

type Filter = "all" | "pendingReview" | "unidentified" | "confirmed" | "investigate" | "duplicates";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "confirmed", label: "Confirmados" },
  { id: "pendingReview", label: "Pendientes" },
  { id: "unidentified", label: "Desconocidos" },
  { id: "investigate", label: "Investigar valor" },
  { id: "duplicates", label: "Posibles repetidos" },
];

export function CollectionView() {
  const items = useLiveQuery(() => listInventory(), []);
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const indexed = useMemo(
    () => (items ?? []).map((it) => ({ ...it, haystack: searchHaystack(it.copy, it.album) })),
    [items],
  );
  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    if (!items) return ids;
    for (const it of items) {
      const signals = findPossibleDuplicates(
        {
          copyId: it.copy.id,
          title: it.album?.title || it.copy.provisionalTitle,
          artists: it.album?.credits.map((c) => c.name) ?? [],
          catalogNumber: it.copy.catalogNumber,
        },
        items,
      );
      if (signals.length) ids.add(it.copy.id);
    }
    return ids;
  }, [items]);

  const visible = indexed.filter((it) => {
    if (query && !matchesQuery(it.haystack, query)) return false;
    switch (filter) {
      case "all":
        return true;
      case "investigate":
        return it.copy.investigateValue;
      case "duplicates":
        return duplicateIds.has(it.copy.id);
      default:
        return it.copy.reviewStatus === filter;
    }
  });

  const counts = countInventory(items ?? []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function exportSelection() {
    setBusy(true);
    setMessage(null);
    try {
      const { blob, manifest } = await buildBackup([...selected]);
      const r = await saveOrShareFile(blob, `archivo-lp-seleccion-${timestampForFile()}.zip`);
      if (r !== "cancelled") {
        await updateSettings({ lastBackupAt: new Date().toISOString() });
        setMessage(`Archivo exportado con ${manifest.counts.copies} ejemplar(es) y ${manifest.counts.photos} foto(s). Guárdalo fuera del teléfono.`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo exportar.");
    } finally {
      setBusy(false);
    }
  }

  if (!items) return <p className="text-muted">Cargando colección…</p>;

  return (
    <div>
      <header className="mb-4">
        <h1 className="font-serif text-3xl font-semibold">{settings?.collectionTitle ?? "Archivo LP"}</h1>
        <p className="mt-1 text-sm text-muted" data-testid="counts">
          {counts.copies} ejemplares · {counts.distinctAlbums} álbumes registrados · {counts.pending} pendientes ·{" "}
          {counts.unidentified} desconocidos
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-line bg-card p-6 text-center">
          <p className="font-serif text-xl">Aún no hay discos en el archivo.</p>
          <p className="mt-2 text-muted">Fotografía una portada o elige fotos de la galería para empezar.</p>
          <Link href="/agregar" className="btn btn-primary mt-4">
            Agregar el primer disco
          </Link>
        </section>
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-4 mb-3 space-y-2 bg-paper/95 px-4 py-2 backdrop-blur">
            <label className="sr-only" htmlFor="search">
              Buscar
            </label>
            <input
              id="search"
              type="search"
              className="field"
              placeholder="Buscar por título, artista, género, año…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtros">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                    filter === f.id ? "border-accent bg-accent text-white" : "border-line bg-card"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">{visible.length} resultados</span>
              <div className="flex gap-2">
                <button type="button" className="btn min-h-9 px-3 py-1" onClick={() => setLayout(layout === "grid" ? "list" : "grid")}>
                  {layout === "grid" ? "Ver lista" : "Ver portadas"}
                </button>
                <button
                  type="button"
                  className="btn min-h-9 px-3 py-1"
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelected(new Set());
                  }}
                >
                  {selecting ? "Cancelar" : "Seleccionar"}
                </button>
              </div>
            </div>
            {selecting && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-2 text-sm">
                <span>{selected.size} seleccionados</span>
                <button type="button" className="btn min-h-9 px-3 py-1" onClick={() => setSelected(new Set(visible.map((v) => v.copy.id)))}>
                  Seleccionar visibles
                </button>
                <button type="button" className="btn btn-primary min-h-9 px-3 py-1" disabled={!selected.size || busy} onClick={exportSelection}>
                  {busy ? "Exportando…" : "Exportar selección con fotos"}
                </button>
              </div>
            )}
          </div>

          {message && (
            <p role="status" className="mb-3 rounded-xl bg-card p-3 text-sm">
              {message}
            </p>
          )}

          {visible.length === 0 ? (
            <p className="text-muted">Nada coincide con la búsqueda o el filtro.</p>
          ) : layout === "grid" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="collection-grid">
              {visible.map(({ copy, album }) => {
                const title = displayTitle(copy, album);
                const body = (
                  <>
                    <CoverThumb photoId={copy.coverPhotoId} alt={`Portada de ${title}`} />
                    <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{title}</p>
                    <p className="line-clamp-1 text-xs text-muted">{displayArtists(album)}</p>
                    {copy.reviewStatus !== "confirmed" && <StatusBadge status={copy.reviewStatus} />}
                  </>
                );
                return (
                  <li key={copy.id}>
                    {selecting ? (
                      <label className={`block rounded-xl p-1 ${selected.has(copy.id) ? "ring-2 ring-accent" : ""}`}>
                        <input type="checkbox" className="sr-only" checked={selected.has(copy.id)} onChange={() => toggle(copy.id)} />
                        {body}
                      </label>
                    ) : (
                      <Link href={`/ejemplar?id=${copy.id}`} className="block rounded-xl p-1">
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-card">
              {visible.map(({ copy, album }) => {
                const title = displayTitle(copy, album);
                const inner = (
                  <div className="flex items-center gap-3 p-2">
                    <CoverThumb photoId={copy.coverPhotoId} alt="" className="w-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{title}</p>
                      <p className="truncate text-sm text-muted">
                        {displayArtists(album)}
                        {album?.originalYear ? ` · ${album.originalYear}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={copy.reviewStatus} />
                  </div>
                );
                return (
                  <li key={copy.id}>
                    {selecting ? (
                      <label className={`block ${selected.has(copy.id) ? "bg-accent/10" : ""}`}>
                        <input type="checkbox" className="sr-only" checked={selected.has(copy.id)} onChange={() => toggle(copy.id)} />
                        {inner}
                      </label>
                    ) : (
                      <Link href={`/ejemplar?id=${copy.id}`}>{inner}</Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
