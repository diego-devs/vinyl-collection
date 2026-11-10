# Costes y límites

Fuentes consultadas el **2026-11-10**. Los precios y cuotas cambian: vuelve a verificar antes de cualquier uso real.

| Fuente | Dato relevante |
|---|---|
| https://ai.google.dev/gemini-api/docs/pricing | `gemini-3.5-flash-lite`: nivel gratuito disponible (entrada/salida gratis). Nivel de pago: ~USD 0,30 / 1M tokens de entrada, ~USD 2,50 / 1M de salida. En el nivel gratuito **el contenido puede usarse para mejorar productos de Google y puede ser revisado por personas**. |
| https://ai.google.dev/gemini-api/docs/rate-limits | Los límites RPM/RPD del nivel gratuito por modelo se consultan en AI Studio (no publicados con cifra fija). La app usa por defecto 5 RPM y concurrencia 1. |
| https://vercel.com/docs/plans/hobby | Hobby: gratis, uso no comercial; cuerpo de petición de funciones ≤ 4,5 MB (la app limita subidas a 3,5 MB). |
| MusicBrainz API | Gratis, ≤ 1 petición/s con User-Agent identificable (para fases posteriores). |

## Estimación para 3.000 discos (solo si se pasara a pago)

Supuestos: 1 llamada por portada, ~1.500 tokens de entrada (imagen reducida + instrucciones) y ~400 de salida; 50 % de reintentos/reprocesos.

- Entrada: 3.000 × 1,5 × 1.500 = 6,75 M tokens → ~USD 2,0
- Salida: 3.000 × 1,5 × 400 = 1,8 M tokens → ~USD 4,5
- **Total aproximado: USD 6–7** (orden de magnitud; no medido).

Con el nivel gratuito el coste es USD 0, a cambio de cuotas diarias (procesar por lotes en varios días) y de la cesión de uso de datos indicada arriba.

## Reglas del proyecto

- No se ha creado ninguna cuenta, clave, proyecto con facturación ni despliegue.
- Usa una clave de AI Studio de un proyecto **sin facturación vinculada**; compruébalo en AI Studio → Billing antes de usarla.
- Alternativas gratuitas: registro manual (siempre disponible), modo `disabled`, y búsqueda en MusicBrainz/Discogs con datos tecleados.
