import type { Album, Copy } from "./types";

/**
 * Comparison key only: lowercases, strips diacritics and collapses whitespace/punctuation.
 * Original text is always kept separately; never store this as the display value.
 */
export function normalizeForMatch(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function primaryArtistNames(album: Pick<Album, "credits"> | null | undefined): string[] {
  return album?.credits.map((c) => c.name) ?? [];
}

export function displayTitle(copy: Copy, album: Album | null | undefined): string {
  return album?.title?.trim() || copy.provisionalTitle.trim() || "Sin título";
}

export function displayArtists(album: Album | null | undefined): string {
  const names = primaryArtistNames(album);
  return names.length ? names.join(", ") : "Artista desconocido";
}

/** Text used by accent/case-insensitive search. */
export function searchHaystack(copy: Copy, album: Album | null | undefined): string {
  return normalizeForMatch(
    [
      album?.title,
      copy.provisionalTitle,
      ...primaryArtistNames(album),
      ...(album?.genres ?? []),
      ...(album?.languages ?? []),
      copy.label,
      copy.catalogNumber,
      copy.country,
      copy.notes,
      album?.originalYear?.toString(),
      copy.pressingYear?.toString(),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function matchesQuery(haystack: string, query: string): boolean {
  const terms = normalizeForMatch(query).split(" ").filter(Boolean);
  return terms.every((t) => haystack.includes(t));
}

export interface DuplicateSignal {
  copyId: string;
  reason: "sameTitleAndArtist" | "sameCatalogNumber";
}

/**
 * Possible repeats are *signals* for the user; never a reason to merge or delete.
 * Two copies of the same album are legitimate.
 */
export function findPossibleDuplicates(
  target: { copyId: string; title: string; artists: string[]; catalogNumber: string | null },
  others: Array<{ copy: Copy; album: Album | null }>,
): DuplicateSignal[] {
  const title = normalizeForMatch(target.title);
  const artists = new Set(target.artists.map(normalizeForMatch).filter(Boolean));
  const catalog = normalizeForMatch(target.catalogNumber).replace(/ /g, "");
  const signals: DuplicateSignal[] = [];
  for (const { copy, album } of others) {
    if (copy.id === target.copyId || copy.deletedAt) continue;
    const otherCatalog = normalizeForMatch(copy.catalogNumber).replace(/ /g, "");
    if (catalog && otherCatalog && catalog === otherCatalog) {
      signals.push({ copyId: copy.id, reason: "sameCatalogNumber" });
      continue;
    }
    const otherTitle = normalizeForMatch(album?.title || copy.provisionalTitle);
    if (!title || title !== otherTitle) continue;
    const otherArtists = primaryArtistNames(album).map(normalizeForMatch);
    const artistOverlap =
      artists.size === 0 || otherArtists.length === 0 || otherArtists.some((a) => artists.has(a));
    if (artistOverlap) signals.push({ copyId: copy.id, reason: "sameTitleAndArtist" });
  }
  return signals;
}

/** Parses a free-text list ("Rock, Bolero; Jazz") into trimmed unique values, preserving order. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const v = raw.trim();
    const key = normalizeForMatch(v);
    if (v && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/** Parses an optional year; empty/invalid becomes null (never 0 or the current year). */
export function parseYear(text: string): number | null {
  const t = text.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1880 && n <= 2100 ? n : null;
}
