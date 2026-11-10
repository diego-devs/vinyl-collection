"use client";

import { useThumbnailUrl } from "./hooks";

export function CoverThumb({ photoId, alt, className = "" }: { photoId: string | null; alt: string; className?: string }) {
  const url = useThumbnailUrl(photoId);
  return (
    <div className={`relative aspect-square overflow-hidden rounded-lg bg-line ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob URLs, no optimization needed
        <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div aria-hidden className="flex h-full w-full items-center justify-center">
          <div className="h-2/3 w-2/3 rounded-full border-[6px] border-ink/15" />
        </div>
      )}
    </div>
  );
}

const STATUS = {
  pendingReview: { text: "Pendiente", cls: "bg-warn/15 text-warn" },
  unidentified: { text: "Desconocido", cls: "bg-muted/15 text-muted" },
  confirmed: { text: "Confirmado", cls: "bg-ok/15 text-ok" },
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.text}</span>;
}
