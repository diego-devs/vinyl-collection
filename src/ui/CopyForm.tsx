"use client";

import { useState } from "react";
import { parseList, parseYear } from "@/domain/normalize";
import { LANGUAGE_INSTRUMENTAL, type Album, type ArtistCredit, type Copy, type CreditRole, type ReviewStatus } from "@/domain/types";
import type { CopyFormValues } from "@/persistence/repository";

const ROLES: { id: CreditRole; label: string }[] = [
  { id: "artist", label: "Artista" },
  { id: "composer", label: "Compositor/a" },
  { id: "performer", label: "Intérprete" },
  { id: "conductor", label: "Director/a" },
  { id: "orchestra", label: "Orquesta" },
  { id: "other", label: "Otro" },
];

interface Draft {
  title: string;
  credits: ArtistCredit[];
  originalYear: string;
  genres: string;
  languages: string;
  instrumental: boolean;
  pressingYear: string;
  label: string;
  catalogNumber: string;
  country: string;
  discCount: string;
  notes: string;
  investigateValue: boolean;
}

function toDraft(copy: Copy, album: Album | null): Draft {
  const langs = album?.languages ?? [];
  return {
    title: album?.title || copy.provisionalTitle,
    credits: album?.credits.length ? album.credits : [{ name: "", role: "artist" }],
    originalYear: album?.originalYear?.toString() ?? "",
    genres: (album?.genres ?? []).join(", "),
    languages: langs.filter((l) => l !== LANGUAGE_INSTRUMENTAL).join(", "),
    instrumental: langs.includes(LANGUAGE_INSTRUMENTAL),
    pressingYear: copy.pressingYear?.toString() ?? "",
    label: copy.label ?? "",
    catalogNumber: copy.catalogNumber ?? "",
    country: copy.country ?? "",
    discCount: copy.discCount?.toString() ?? "",
    notes: copy.notes,
    investigateValue: copy.investigateValue,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

function toValues(d: Draft): CopyFormValues {
  const disc = Number(d.discCount);
  return {
    title: d.title.trim(),
    credits: d.credits.map((c) => ({ ...c, name: c.name.trim() })).filter((c) => c.name),
    originalYear: parseYear(d.originalYear),
    genres: parseList(d.genres),
    languages: [...parseList(d.languages), ...(d.instrumental ? [LANGUAGE_INSTRUMENTAL] : [])],
    pressingYear: parseYear(d.pressingYear),
    label: orNull(d.label),
    catalogNumber: orNull(d.catalogNumber),
    country: orNull(d.country),
    discCount: Number.isInteger(disc) && disc >= 1 && disc <= 50 ? disc : null,
    notes: d.notes,
    investigateValue: d.investigateValue,
  };
}

export function CopyForm({
  copy,
  album,
  busy,
  onSave,
  onChange,
}: {
  copy: Copy;
  album: Album | null;
  busy: boolean;
  onSave: (values: CopyFormValues, status: ReviewStatus) => void;
  onChange?: (values: CopyFormValues) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(copy, album));
  const [yearError, setYearError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    const next = { ...d, [k]: v };
    setD(next);
    onChange?.(toValues(next));
  };
  const setCredit = (i: number, patch: Partial<ArtistCredit>) =>
    set(
      "credits",
      d.credits.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );

  function submit(status: ReviewStatus) {
    for (const [field, label] of [
      ["originalYear", "Año original"],
      ["pressingYear", "Año de la edición"],
    ] as const) {
      if (d[field].trim() && parseYear(d[field]) === null) {
        setYearError(`${label}: escribe un año de 4 cifras o déjalo vacío.`);
        return;
      }
    }
    setYearError(null);
    onSave(toValues(d), status);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit("confirmed");
      }}
    >
      <div>
        <label className="label" htmlFor="title">
          Título del álbum
        </label>
        <input id="title" className="field" value={d.title} onChange={(e) => set("title", e.target.value)} autoComplete="off" enterKeyHint="next" />
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Artistas y créditos</legend>
        {d.credits.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={`Nombre del crédito ${i + 1}`}
              className="field flex-1"
              value={c.name}
              placeholder="Nombre"
              onChange={(e) => setCredit(i, { name: e.target.value })}
              autoComplete="off"
            />
            <select
              aria-label={`Rol del crédito ${i + 1}`}
              className="field w-36"
              value={c.role}
              onChange={(e) => setCredit(i, { role: e.target.value as CreditRole })}
            >
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            {d.credits.length > 1 && (
              <button
                type="button"
                className="btn px-3"
                aria-label={`Quitar crédito ${i + 1}`}
                onClick={() => set("credits", d.credits.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn" onClick={() => set("credits", [...d.credits, { name: "", role: "artist" }])}>
          Añadir crédito
        </button>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="originalYear">
            Año original
          </label>
          <input id="originalYear" className="field" inputMode="numeric" placeholder="Desconocido" value={d.originalYear} onChange={(e) => set("originalYear", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pressingYear">
            Año de esta edición
          </label>
          <input id="pressingYear" className="field" inputMode="numeric" placeholder="Desconocido" value={d.pressingYear} onChange={(e) => set("pressingYear", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="genres">
          Géneros (separados por coma)
        </label>
        <input id="genres" className="field" value={d.genres} onChange={(e) => set("genres", e.target.value)} />
      </div>

      <div>
        <label className="label" htmlFor="languages">
          Idiomas cantados (separados por coma)
        </label>
        <input id="languages" className="field" value={d.languages} onChange={(e) => set("languages", e.target.value)} />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={d.instrumental} onChange={(e) => set("instrumental", e.target.checked)} />
          Instrumental
        </label>
      </div>

      <details className="rounded-xl border border-line bg-card p-3">
        <summary className="cursor-pointer font-semibold">Datos de esta edición física</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="label">
              Sello
            </label>
            <input id="label" className="field" value={d.label} onChange={(e) => set("label", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="catalogNumber">
              Número de catálogo
            </label>
            <input id="catalogNumber" className="field" value={d.catalogNumber} onChange={(e) => set("catalogNumber", e.target.value)} autoCapitalize="characters" />
          </div>
          <div>
            <label className="label" htmlFor="country">
              País
            </label>
            <input id="country" className="field" value={d.country} onChange={(e) => set("country", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="discCount">
              Discos dentro
            </label>
            <input id="discCount" className="field" inputMode="numeric" placeholder="?" value={d.discCount} onChange={(e) => set("discCount", e.target.value)} />
          </div>
        </div>
      </details>

      <div>
        <label className="label" htmlFor="notes">
          Notas
        </label>
        <textarea id="notes" className="field min-h-24" value={d.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" className="h-5 w-5" checked={d.investigateValue} onChange={(e) => set("investigateValue", e.target.checked)} />
        Investigar valor más adelante
      </label>

      {yearError && (
        <p role="alert" className="text-sm text-danger">
          {yearError}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Guardar como confirmado
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit("unidentified")}>
          Guardar como desconocido
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => submit("pendingReview")}>
          Dejar pendiente
        </button>
      </div>
    </form>
  );
}
