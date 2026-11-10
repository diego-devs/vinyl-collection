import { Suspense } from "react";
import { DetailView } from "@/ui/DetailView";

export default function CopyPage() {
  return (
    <Suspense fallback={<p className="text-muted">Cargando…</p>}>
      <DetailView />
    </Suspense>
  );
}
