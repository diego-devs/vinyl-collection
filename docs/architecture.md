# Arquitectura — Archivo LP

## Capas

| Capa | Carpeta | Responsabilidad |
|---|---|---|
| Dominio | `src/domain` | Tipos (`Collection`, `Album`, `Copy`, `PhotoAsset`, `CaptureBatch`), geometría de recorte, normalización para búsqueda/duplicados, CSV seguro. Sin dependencias de navegador. |
| Imagen | `src/imaging` | Detección de formato por *magic bytes*, decodificación (incluye HEIC cuando Safari lo soporta), corrección EXIF, reescalado, recorte/rotación, miniaturas, SHA-256, eliminación de metadatos JPEG. |
| Persistencia | `src/persistence` | Dexie/IndexedDB (`db.ts`, esquema versionado) y operaciones de alto nivel (`repository.ts`). |
| Respaldo | `src/backup` | ZIP versionado con manifiesto y checksums (fflate), restauración validada e idempotente, CSV. |
| Visión | `src/vision`, `src/server` | Contrato Zod (`contract.ts`), interfaz `VisionProvider`, adaptador Gemini (solo servidor), mock determinista, handler HTTP con validaciones. |
| UI | `src/ui`, `src/app` | Next.js App Router, páginas estáticas cliente; rutas `/api/vision/*` dinámicas. |

## Modelo de datos (IndexedDB, versión 1)

- `collections`, `albums` (obra), `copies` (ejemplar físico, con estado `draft/pending/confirmed/unknown`, borrado lógico `deletedAt`), `captureBatches`.
- `photos`: metadatos + `bytes: ArrayBuffer`. Las fotos originales importadas se conservan como `source`; los recortes guardan `sourcePhotoId` y `region` (coordenadas normalizadas sobre la imagen orientada) para poder recortar de nuevo.
- `thumbnails`: miniatura JPEG por foto, también como `ArrayBuffer`.
- Hash SHA-256 de la foto original para avisar de importaciones repetidas; normalización título/artista para avisar de posibles duplicados (nunca se fusiona automáticamente).

### Decisión: bytes como `ArrayBuffer`, no `Blob`

En las pruebas E2E con WebKit (Playwright, Windows), `put()` de un objeto con `Blob` falló con un error de transacción nulo, mientras que `ArrayBuffer` funcionó. Safari tiene historial de problemas con `Blob` en IndexedDB. Guardar `ArrayBuffer` es portable y el coste es convertir al leer (`photoFromRecord`). **Pendiente verificar en un iPhone real.**

Regla para Dexie: nunca esperar promesas que no sean de IndexedDB (p. ej. `blob.arrayBuffer()`) dentro de una transacción; se convierten antes (`buildRecords`).

## Respaldo

`.zip` con `manifest.json` (formato, versión, esquema, conteos, SHA-256 y tamaño por archivo), `data.json`, `photos/` y `thumbs/`. La restauración valida: ZIP real, versión no superior, rutas sin *traversal*, checksums y esquema Zod; muestra vista previa y es idempotente (no duplica registros existentes). No incluye secretos (no hay secretos en el cliente).

## Reconocimiento (seguridad)

- La clave Gemini solo existe en el servidor/CLI (`GEMINI_API_KEY`); nunca en el cliente ni en el respaldo.
- `VISION_PROVIDER=disabled|mock|gemini`. **Un proveedor real no se expone por HTTP hasta que exista autenticación del propietario (Fase 2)**: `/api/vision/identify` responde 401 en ese caso. En Fase 0 la prueba real se hace con la CLI `npm run vision:probe`.
- El handler comprueba origen, tamaño, formato por *magic bytes*, elimina EXIF/GPS, aplica límite por minuto y concurrencia (en memoria, **por instancia**: insuficiente en serverless con varias instancias; aceptable para un solo usuario) y mapea errores (cuota, timeout, seguridad) a mensajes en español.
- Las respuestas del modelo se validan con Zod; nada se confirma sin revisión humana.

## Diferido

- Service worker / modo offline completo: Fase 4 (Serwist). Hoy es PWA instalable (manifest + iconos) y los datos ya viven localmente.
- Corrección de perspectiva, detección de varias portadas en una foto, autenticación, sincronización: fases posteriores.
