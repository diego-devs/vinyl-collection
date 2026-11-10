import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Archivo LP",
    short_name: "Archivo LP",
    description: "Inventario personal de una colección de discos LP.",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5efe4",
    theme_color: "#f5efe4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
