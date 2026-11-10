"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { displayTitle } from "@/domain/normalize";
import { getDb } from "@/persistence/db";
import { listInventory } from "@/persistence/repository";
import { CoverThumb, StatusBadge } from "./CoverThumb";

export function PendingView() {
  const data = useLiveQuery(async () => {
    const items = (await listInventory()).filter((i) => i.copy.reviewStatus !== "confirmed");
    const batches = await getDb().captureBatches.toArray();
    return { items, batches: new Map(batches.map((b) => [b.id, b])) };
  }, []);

  if (!data) return <p className="text-muted">Cargando…</p>;

  const groups = new Map<string, typeof data.items>();
  for (const it of data.items) {
    const key = it.copy.captureBatchId ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-serif text-3xl font-semibold">Pendientes</h1>
        <p className="text-sm text-muted">
          Discos guardados que aún faltan revisar o que quedaron como desconocidos. Puedes retomarlos cuando quieras.
        </p>
      </header>
      {data.items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card p-6 text-center">No hay nada pendiente.</p>
      ) : (
        [...groups.entries()].map(([batchId, items]) => {
          const batch = data.batches.get(batchId);
          return (
            <section key={batchId}>
              <h2 className="mb-2 text-sm font-semibold text-muted">
                {batch
                  ? `Lote del ${new Date(batch.createdAt).toLocaleString("es")} · ${batch.source === "camera" ? "cámara" : "galería"}`
                  : "Sin lote"}
              </h2>
              <ul className="divide-y divide-line rounded-xl border border-line bg-card">
                {items.map(({ copy, album }) => (
                  <li key={copy.id}>
                    <Link href={`/revisar?id=${copy.id}`} className="flex items-center gap-3 p-2">
                      <CoverThumb photoId={copy.coverPhotoId} alt="" className="w-14 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-semibold">{displayTitle(copy, album)}</span>
                      <StatusBadge status={copy.reviewStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
