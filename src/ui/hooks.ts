"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { getDb } from "@/persistence/db";
import { getPhoto, getThumbnail } from "@/persistence/repository";

/** Object URL for a blob, revoked on change/unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs are an external resource that must be revoked
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return entry && entry.blob === blob ? entry.url : null;
}

export function useThumbnailUrl(photoId: string | null | undefined): string | null {
  const thumb = useLiveQuery(() => (photoId ? getThumbnail(photoId) : undefined), [photoId]);
  return useObjectUrl(thumb?.blob);
}

export function usePhotoUrl(photoId: string | null | undefined): string | null {
  const photo = useLiveQuery(() => (photoId ? getPhoto(photoId) : undefined), [photoId]);
  return useObjectUrl(photo?.blob);
}

export function useSettings() {
  return useLiveQuery(() => getDb().settings.get("app"), []);
}
