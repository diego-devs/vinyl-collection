import { toCsv } from "@/domain/csv";
import type { InventoryItem } from "@/persistence/repository";

const STATUS_ES = { pendingReview: "Pendiente", confirmed: "Confirmado", unidentified: "Desconocido" } as const;

/** CSV of accepted data for sharing with family. Not a full backup: it contains no photos. */
export function inventoryToCsv(items: InventoryItem[]): string {
  const header = [
    "id_ejemplar",
    "titulo",
    "artistas",
    "anio_original",
    "generos",
    "idiomas",
    "anio_edicion",
    "sello",
    "numero_catalogo",
    "pais",
    "discos_fisicos",
    "estado",
    "investigar_valor",
    "notas",
    "musicbrainz_release_group",
    "creado",
  ];
  const rows = items.map(({ copy, album }) => [
    copy.id,
    album?.title || copy.provisionalTitle,
    album?.credits.map((c) => (c.role === "artist" ? c.name : `${c.name} (${c.role})`)),
    album?.originalYear,
    album?.genres,
    album?.languages,
    copy.pressingYear,
    copy.label,
    copy.catalogNumber,
    copy.country,
    copy.discCount,
    STATUS_ES[copy.reviewStatus],
    copy.investigateValue ? "sí" : "no",
    copy.notes,
    album?.externalIds.musicbrainzReleaseGroupId
      ? `https://musicbrainz.org/release-group/${album.externalIds.musicbrainzReleaseGroupId}`
      : "",
    copy.createdAt,
  ]);
  return toCsv(header, rows);
}
