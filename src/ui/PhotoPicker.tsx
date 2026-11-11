"use client";

import { useRef } from "react";
import { importImageFile, ImageImportError } from "@/imaging/process";
import type { StorePhotoInput } from "@/persistence/repository";

export type UploadKind = "cover" | "back" | "label";

export const PHOTO_KIND_LABEL = { cover: "Portada", back: "Contraportada", label: "Etiqueta", source: "Foto original" } as const;

const UPLOAD_KINDS: UploadKind[] = ["cover", "back", "label"];

/** Validates and re-encodes a picked image (orientation fixed, metadata stripped). */
export async function photoInputFromFile(file: File, kind: UploadKind): Promise<StorePhotoInput> {
  const img = await importImageFile(file);
  return {
    kind,
    image: img.work,
    thumbnail: img.thumbnail,
    sha256: img.workSha256,
    originalFileSha256: img.originalFileSha256,
    originalFileName: img.originalFileName,
  };
}

export function importErrorMessage(e: unknown, fileName: string): string {
  return `${fileName}: ${e instanceof ImageImportError ? e.message : "no se pudo leer la imagen."}`;
}

/** One button per photo kind; on iPhone the picker offers camera or photo library. */
export function PhotoPicker({ disabled, onPick }: { disabled?: boolean; onPick: (files: File[], kind: UploadKind) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<UploadKind>("cover");
  return (
    <div className="grid grid-cols-3 gap-2">
      {UPLOAD_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className="btn text-sm"
          disabled={disabled}
          onClick={() => {
            kindRef.current = k;
            inputRef.current?.click();
          }}
        >
          + {PHOTO_KIND_LABEL[k]}
        </button>
      ))}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,image/*"
        multiple
        className="hidden"
        data-testid="photo-picker-input"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length) onPick(files, kindRef.current);
        }}
      />
    </div>
  );
}
