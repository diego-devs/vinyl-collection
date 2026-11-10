"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { inventoryToCsv } from "@/backup/csv-export";
import { saveOrShareFile, timestampForFile } from "@/backup/save-file";
import { applyRestore, buildBackup, prepareRestore, type RestorePreview } from "@/backup/zip-backup";
import { listInventory, updateSettings } from "@/persistence/repository";
import { useSettings } from "./hooks";

interface VisionStatusDto {
  provider: string;
  model: string | null;
  isMock: boolean;
  available: boolean;
  message: string;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function SettingsView() {
  const settings = useSettings();
  const copyCount = useLiveQuery(async () => (await listInventory()).length, []);
  const [title, setTitle] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [vision, setVision] = useState<VisionStatusDto | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  async function refreshStorage() {
    if (!navigator.storage?.estimate) return;
    const est = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async browser API, result arrives later
    refreshStorage();
    fetch("/api/vision/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: VisionStatusDto | null) => setVision(s))
      .catch(() => setVision(null));
  }, []);

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await task();
      if (text) setMessage({ text, tone: "ok" });
    } catch (e) {
      const quota = e instanceof DOMException && e.name === "QuotaExceededError";
      setMessage({
        text: quota
          ? "No hay espacio suficiente en el dispositivo. Exporta un respaldo y libera espacio."
          : e instanceof Error
            ? e.message
            : "Ocurrió un error.",
        tone: "error",
      });
    } finally {
      setBusy(false);
      refreshStorage();
    }
  }

  const exportAll = () =>
    run(async () => {
      const { blob, manifest } = await buildBackup("all");
      const r = await saveOrShareFile(blob, `archivo-lp-respaldo-${timestampForFile()}.zip`);
      if (r === "cancelled") return null;
      await updateSettings({ lastBackupAt: new Date().toISOString() });
      return `Archivo exportado: ${manifest.counts.copies} ejemplares y ${manifest.counts.photos} fotos. Guárdalo en Archivos, iCloud Drive o tu computadora.`;
    });

  const exportCsv = () =>
    run(async () => {
      const csv = inventoryToCsv(await listInventory());
      const r = await saveOrShareFile(new Blob([csv], { type: "text/csv;charset=utf-8" }), `archivo-lp-inventario-${timestampForFile()}.csv`);
      return r === "cancelled" ? null : "Inventario CSV exportado (solo datos, sin fotos).";
    });

  const pickRestore = (file: File) =>
    run(async () => {
      setPreview(await prepareRestore(file));
      return null;
    });

  const confirmRestore = () =>
    run(async () => {
      if (!preview) return null;
      const r = await applyRestore(preview);
      setPreview(null);
      return `Restauración completa: ${r.addedCopies} ejemplares añadidos, ${r.skippedCopies} ya existían y no se tocaron.`;
    });

  const unsaved =
    settings?.lastChangeAt && (!settings.lastBackupAt || settings.lastChangeAt > settings.lastBackupAt);

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold">Ajustes</h1>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${message.tone === "error" ? "bg-danger/10 text-danger" : "bg-ok/10"}`}>
          {message.text}
        </p>
      )}

      <section className="space-y-2">
        <label className="label" htmlFor="collectionTitle">
          Nombre de la colección
        </label>
        <div className="flex gap-2">
          <input
            id="collectionTitle"
            className="field flex-1"
            value={title ?? settings?.collectionTitle ?? ""}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <button
            type="button"
            className="btn"
            disabled={!title?.trim()}
            onClick={() =>
              run(async () => {
                await updateSettings({ collectionTitle: title!.trim() });
                setTitle(null);
                return "Nombre guardado.";
              })
            }
          >
            Guardar
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Respaldo</h2>
        <p className="text-sm">
          Las fotos y los datos viven solo en este dispositivo. Si se borran los datos del navegador o pierdes el
          teléfono, sin un archivo exportado se pierden.
        </p>
        <p className="text-sm" data-testid="backup-status">
          Último archivo exportado:{" "}
          <strong>{settings?.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString("es") : "nunca"}</strong>
        </p>
        {unsaved && (
          <p className="rounded-lg bg-warn/10 p-2 text-sm text-warn">
            Hay cambios posteriores al último archivo exportado. Exporta de nuevo y guarda el archivo fuera del teléfono.
          </p>
        )}
        <p className="text-xs text-muted">
          La app no puede comprobar dónde guardaste el archivo. Para confirmar que sirve, puedes restaurarlo en otro
          navegador o dispositivo.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={busy || !copyCount} onClick={exportAll}>
            Exportar todo con fotos (.zip)
          </button>
          <button type="button" className="btn" disabled={busy || !copyCount} onClick={exportCsv}>
            Exportar inventario (.csv)
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Restaurar desde un archivo</h2>
        <p className="text-sm text-muted">
          Se revisa el archivo completo antes de cambiar nada. Los ejemplares que ya existen no se sobrescriben.
        </p>
        <input
          ref={restoreInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          data-testid="restore-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) pickRestore(f);
          }}
        />
        <button type="button" className="btn" disabled={busy} onClick={() => restoreInput.current?.click()}>
          Elegir archivo de respaldo
        </button>
        {preview && (
          <div className="space-y-2 rounded-xl border border-accent/40 p-3 text-sm" data-testid="restore-preview">
            <p>
              Archivo creado el {new Date(preview.manifest.createdAt).toLocaleString("es")} con{" "}
              {preview.manifest.counts.copies} ejemplares y {preview.manifest.counts.photos} fotos.
            </p>
            <p>
              Se añadirán <strong>{preview.newCopies}</strong> ejemplares nuevos. {preview.existingCopies} ya están en
              este dispositivo y se dejarán como están.
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={confirmRestore}>
                Restaurar
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setPreview(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Almacenamiento</h2>
        {storage ? (
          <>
            <p className="text-sm">
              Usado: {formatBytes(storage.usage)}
              {storage.quota ? ` de ~${formatBytes(storage.quota)} disponibles para la app (estimación del navegador)` : ""}.
            </p>
            <p className="text-sm">
              Almacenamiento persistente: <strong>{storage.persisted ? "concedido" : "no concedido"}</strong>
            </p>
            {!storage.persisted && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  run(async () =>
                    (await navigator.storage.persist?.())
                      ? "El navegador concedió almacenamiento persistente."
                      : "El navegador no lo concedió. En iPhone suele concederse al instalar la app en la pantalla de inicio. Exporta respaldos con regularidad.",
                  )
                }
              >
                Pedir almacenamiento persistente
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Este navegador no informa el uso de almacenamiento.</p>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Reconocimiento automático</h2>
        <p className="text-sm" data-testid="vision-status">
          {vision ? vision.message : "No se pudo consultar el estado del reconocimiento."}
        </p>
        <p className="text-xs text-muted">
          Cuando se active, las fotos recortadas se enviarán a Google Gemini. En el nivel gratuito, Google puede usar
          ese contenido para mejorar sus productos y personas pueden revisarlo. No se envía nada sin que lo actives.
          Antes del envío se eliminan los metadatos de la foto (incluida la ubicación).
        </p>
      </section>

      <section className="space-y-1 text-xs text-muted">
        <p>Archivo LP · datos locales en IndexedDB · sin cuentas ni servicios de pago.</p>
      </section>
    </div>
  );
}
