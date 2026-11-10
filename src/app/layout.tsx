import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/ui/AppShell";

export const metadata: Metadata = {
  title: "Archivo LP",
  description: "Inventario personal de una colección de discos LP.",
  applicationName: "Archivo LP",
  appleWebApp: { capable: true, title: "Archivo LP", statusBarStyle: "default" },
  robots: { index: false, follow: false },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f5efe4",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
