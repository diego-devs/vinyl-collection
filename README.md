# Archivo LP

PWA personal para inventariar una colección de 2.000–3.000 LP desde el iPhone: fotografiar o importar portadas, recortarlas, guardar los datos localmente y (más adelante) identificarlas con un modelo de visión. Interfaz en español; datos en el dispositivo (IndexedDB).

Especificación: `Prompt_Copilot_Archivo_LP.md`. Avance: `docs/progress.md`.

## Requisitos (Windows)

- Node.js 22+ (probado con 26.1) y npm.
- `npm install`
- Para E2E: `npx playwright install chromium webkit`

## Uso local

```powershell
npm run dev          # http://localhost:3000
```

### Probar en el iPhone

La cámara, el almacenamiento persistente y la instalación como PWA requieren HTTPS:

```powershell
npm run dev:https    # certificado local autofirmado de Next.js
```

Abre `https://<IP-del-PC>:3000` desde Safari con el iPhone en la misma Wi-Fi (permite el puerto en el Firewall de Windows y acepta el aviso del certificado). Alternativa: un túnel HTTPS gratuito. Para instalar: Compartir → **Añadir a pantalla de inicio**.

> Las fotos y datos viven en el navegador de ese dispositivo. Safari puede borrar datos de sitios no instalados que no se usan: instala la app, pulsa "Solicitar almacenamiento persistente" en Ajustes y **exporta respaldos con frecuencia**.

## Respaldo y recuperación

Ajustes → **Exportar todo con fotos (.zip)** (también CSV del inventario). Para recuperar: Ajustes → Restaurar → elige el `.zip` → revisa la vista previa → Restaurar. Restaurar dos veces no duplica registros.

## Reconocimiento con IA (opcional)

Por defecto está **desactivado** y todo funciona manualmente. Copia `.env.example` a `.env.local` (ignorado por git):

- `VISION_PROVIDER=mock` — respuestas simuladas para probar el flujo (no es precisión real).
- `VISION_PROVIDER=gemini` + `GEMINI_API_KEY` — clave de Google AI Studio de un proyecto **sin facturación** (compruébalo en AI Studio). La clave nunca llega al navegador. Hasta tener autenticación (Fase 2) Gemini **no** se expone por HTTP; se prueba con:

```powershell
npm run vision:probe -- C:\ruta\a\fotos [--detect]
```

Ver `docs/costs.md` (precios, límites, uso de datos en el nivel gratuito) y `docs/recognition-evaluation.md`.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` / `dev:https` | Servidor de desarrollo |
| `npm run build` / `start` | Compilación y servidor de producción |
| `npm run typecheck` / `lint` | TypeScript estricto / ESLint |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:e2e` | E2E Playwright (Chromium móvil y WebKit iPhone) |
| `npm run assets` | Regenera iconos y fixtures |
| `npm run vision:probe` | Prueba del proveedor de visión con fotos locales |

Arquitectura: `docs/architecture.md`.
