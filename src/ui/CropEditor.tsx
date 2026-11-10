"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clampRect } from "@/domain/geometry";
import type { NormalizedRect, Rotation } from "@/domain/types";
import { cropStoredPhoto } from "@/imaging/process";
import { useObjectUrl } from "./hooks";

const DEFAULT_RECT: NormalizedRect = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };
const MIN = 0.05;

type Handle = "move" | "nw" | "ne" | "sw" | "se";

export function CropEditor({
  source,
  busy,
  onConfirm,
}: {
  source: Blob;
  busy: boolean;
  onConfirm: (rotation: Rotation, rect: NormalizedRect) => void;
}) {
  const [rotation, setRotation] = useState<Rotation>(0);
  const [rotated, setRotated] = useState<{ rotation: Rotation; blob: Blob } | null>(null);
  const [rect, setRect] = useState<NormalizedRect>(DEFAULT_RECT);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ handle: Handle; startX: number; startY: number; start: NormalizedRect } | null>(
    null,
  );
  const preview = rotation === 0 ? source : rotated?.rotation === rotation ? rotated.blob : null;
  const url = useObjectUrl(preview);

  useEffect(() => {
    if (rotation === 0) return;
    let cancelled = false;
    cropStoredPhoto(source, rotation, { x: 0, y: 0, width: 1, height: 1 }).then((r) => {
      if (!cancelled) setRotated({ rotation, blob: r.image.blob });
    });
    return () => {
      cancelled = true;
    };
  }, [rotation, source]);

  function rotate(delta: 90 | 270) {
    setRotation((r) => ((r + delta) % 360) as Rotation);
    setRect(DEFAULT_RECT);
  }

  function onPointerDown(handle: Handle) {
    return (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDrag({ handle, startX: e.clientX, startY: e.clientY, start: rect });
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag;
    const box = containerRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.startX) / box.width;
    const dy = (e.clientY - d.startY) / box.height;
    const s = d.start;
    let next: NormalizedRect;
    switch (d.handle) {
      case "move":
        next = {
          ...s,
          x: Math.min(Math.max(0, s.x + dx), 1 - s.width),
          y: Math.min(Math.max(0, s.y + dy), 1 - s.height),
        };
        break;
      case "nw":
        next = { x: s.x + dx, y: s.y + dy, width: s.width - dx, height: s.height - dy };
        break;
      case "ne":
        next = { x: s.x, y: s.y + dy, width: s.width + dx, height: s.height - dy };
        break;
      case "sw":
        next = { x: s.x + dx, y: s.y, width: s.width - dx, height: s.height + dy };
        break;
      case "se":
        next = { x: s.x, y: s.y, width: s.width + dx, height: s.height + dy };
        break;
    }
    const clamped = clampRect(next, MIN);
    if (clamped) setRect(clamped);
  }

  function endDrag() {
    setDrag(null);
  }

  function nudge(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    setRect((r) => ({
      ...r,
      x: Math.min(Math.max(0, r.x + delta[0]), 1 - r.width),
      y: Math.min(Math.max(0, r.y + delta[1]), 1 - r.height),
    }));
  }

  const pct = (v: number) => `${v * 100}%`;
  const handleCls = "absolute h-9 w-9 rounded-full border-2 border-white bg-accent/80 touch-none";

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative mx-auto w-full max-w-md touch-none select-none overflow-hidden rounded-xl bg-ink/80"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL
          <img src={url} alt="Foto original para recortar" className="block h-auto w-full" draggable={false} />
        )}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Área de recorte de la portada; usa las flechas para moverla"
          aria-valuetext={`x ${Math.round(rect.x * 100)}%, y ${Math.round(rect.y * 100)}%`}
          aria-valuenow={Math.round(rect.x * 100)}
          onKeyDown={nudge}
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.width), height: pct(rect.height) }}
          onPointerDown={onPointerDown("move")}
        >
          {(
            [
              ["nw", "0%", "0%"],
              ["ne", "100%", "0%"],
              ["sw", "0%", "100%"],
              ["se", "100%", "100%"],
            ] as const
          ).map(([h, left, top]) => (
            <span
              key={h}
              aria-hidden
              className={handleCls}
              style={{ left, top, transform: "translate(-50%, -50%)" }}
              onPointerDown={onPointerDown(h)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn" onClick={() => rotate(270)}>
          ↺ Girar
        </button>
        <button type="button" className="btn" onClick={() => rotate(90)}>
          ↻ Girar
        </button>
        <button type="button" className="btn" onClick={() => setRect({ x: 0, y: 0, width: 1, height: 1 })}>
          Foto completa
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !url} onClick={() => onConfirm(rotation, rect)}>
          {busy ? "Recortando…" : "Usar este recorte"}
        </button>
      </div>
      <p className="text-center text-xs text-muted">
        Arrastra el recuadro o sus esquinas. La corrección de perspectiva aún no está disponible: si la portada salió muy
        inclinada, repite la foto de frente.
      </p>
    </div>
  );
}
