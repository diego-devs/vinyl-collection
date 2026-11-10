"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ensureDefaults } from "@/persistence/repository";

const NAV = [
  { href: "/", label: "Colección" },
  { href: "/agregar", label: "Agregar" },
  { href: "/pendientes", label: "Pendientes" },
  { href: "/ajustes", label: "Ajustes" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let problemText: string | null = null;
    if (!window.isSecureContext || !globalThis.crypto?.subtle) {
      problemText =
        "Abre la app mediante HTTPS (o localhost): sin conexión segura el navegador no permite guardar fotos de forma fiable.";
    } else if (!("indexedDB" in window)) {
      problemText = "Este navegador no ofrece almacenamiento local (IndexedDB). Desactiva el modo privado.";
    }
    if (problemText) {
      // Browser capabilities are only known after hydration.
      queueMicrotask(() => setProblem(problemText));
      return;
    }
    ensureDefaults().catch(() => setProblem("No se pudo abrir la base de datos local."));
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <main className="safe-top flex-1 px-4 pb-28 pt-4">
        {problem && (
          <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {problem}
          </p>
        )}
        {children}
      </main>
      <nav
        aria-label="Navegación principal"
        className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur"
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-4">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 items-center justify-center text-sm font-semibold ${
                    active ? "text-accent" : "text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
