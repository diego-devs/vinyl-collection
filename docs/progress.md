# Progreso

Última actualización: 2026-11-10.

## Completado

### Fase 0 — Viabilidad y base
- Fuentes oficiales verificadas (Gemini precios/límites/términos, Vercel Hobby, MusicBrainz) → `docs/costs.md`.
- Proyecto Next.js 16 + React 19 + TypeScript estricto + Tailwind 4 + Dexie + Zod + fflate; Vitest y Playwright.
- Contrato de visión validado con Zod, interfaz `VisionProvider`, adaptador Gemini (solo servidor), mock determinista, handler con validación de origen/tamaño/formato, eliminación de EXIF/GPS, límites y mapeo de errores.
- Proveedor real bloqueado por HTTP hasta tener autenticación; CLI `npm run vision:probe` para la prueba real.

### Fase 1 — Primer incremento funcional (inventario local)
- Añadir desde cámara o galería (varias fotos), rechazo de no-imágenes, aviso de foto ya importada.
- Editor de recorte (arrastrar, esquinas, teclado, rotación, foto completa); original conservado para recortar de nuevo.
- Formulario de ejemplar: título, créditos con rol, años, géneros, idiomas/instrumental, edición física, notas; guardar como confirmado / desconocido / pendiente; aviso de posible duplicado.
- Colección con búsqueda, ficha con fotos y zoom, edición, borrado con deshacer, Pendientes por lote.
- Ajustes: respaldo ZIP completo o por ejemplar con checksums, CSV, restauración con vista previa e idempotente, estimación de almacenamiento y persistencia, estado del reconocimiento.
- PWA instalable (manifest, iconos).
- Bytes de imagen guardados como `ArrayBuffer` (fallo de `Blob` en IndexedDB con WebKit).

## Pruebas ejecutadas (2026-11-10)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | sin errores |
| `npx eslint` | sin errores |
| `npx vitest run` | 45/45 |
| `npm run build` | OK |
| `npx playwright test` | 8/8 (4 en chromium-mobile, 4 en webkit-iphone) |
| `npm run vision:probe -- tests\fixtures` (mock) | OK, omite el archivo que no es imagen |

## Bloqueos / pendiente de validar

- **Evaluación real de Gemini**: requiere clave sin facturación y 15–20 fotos reales del usuario.
- **iPhone real**: Safari/HEIC/cámara/almacenamiento solo probados con WebKit de Playwright en Windows.
- Aceptación de `["string","null"]` en el esquema JSON de Gemini sin comprobar.

## No incluido aún

Corrección de perspectiva, detección de varias portadas por foto, autenticación (Fase 2), reconocimiento desde la UI con modelo real, service worker offline (Fase 4), despliegue.

## Siguiente tarea concreta

1. Ejecutar `npm run vision:probe` con fotos reales y registrar resultados en `docs/recognition-evaluation.md`.
2. Fase 1 (siguiente incremento): detección de varias portadas en una foto con revisión por recorte.
3. Fase 2: autenticación del propietario para habilitar el reconocimiento real desde la app.
