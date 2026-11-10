import { Suspense } from "react";
import { ReviewView } from "@/ui/ReviewView";

export default function ReviewPage() {
  return (
    <Suspense fallback={<p className="text-muted">Cargando…</p>}>
      <ReviewView />
    </Suspense>
  );
}
