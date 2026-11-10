# Evaluación del reconocimiento

**Estado: pendiente.** No se ha evaluado ningún modelo real: no hay clave de API ni fotos reales del usuario. El proveedor `mock` solo verifica el flujo y el contrato; **no es una validación de precisión**.

## Cómo ejecutarla (Fase 0)

1. Reúne 15–20 fotos reales hechas con el iPhone: portadas frontales, traseras, lomos, con reflejos, inclinadas, alguna con varias portadas y discos poco conocidos.
2. Crea `.env.local` con `VISION_PROVIDER=gemini`, `GEMINI_API_KEY=...` (proyecto sin facturación).
3. `npm run vision:probe -- C:\ruta\fotos` (añade `--detect` para probar detección de varias portadas).
4. Los resultados se guardan en `evaluation/` (ignorado por git). Anota aquí, por foto: esperado, devuelto, confianza, correcto/incorrecto, latencia.

## Criterios propuestos

- Título y artista correctos en ≥ 80 % de portadas frontales nítidas.
- Confianza calibrada: errores con confianza alta deben ser raros.
- "Desconocido" preferible a inventar.
- Sin fallos de esquema (salida validada con Zod).

## Riesgos abiertos

- No se ha comprobado que Gemini acepte `type: ["string","null"]` en `responseJsonSchema`; si falla, ajustar el esquema en `src/vision/gemini.ts`.

## Resultados

_(vacío hasta la primera ejecución real)_
