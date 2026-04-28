# Bill-e — Instrucciones para Claude

## Idioma de comunicación

Responde al usuario en **español latinoamericano neutro**:
- Sin voseo argentino/chileno (no "tenés", "podés", "andá")
- Sin modismos regionales ni slang
- Sin vocabulario peninsular (no "vosotros", no "ordenador" → preferir "computadora", etc.)
- Cuando hay alternativas, elegir la forma más universalmente entendida en LATAM

El usuario es chileno y a veces escribe con voseo, pero las respuestas de Claude deben mantenerse en registro neutro consistentemente.

## i18n del producto

Las strings de UI (en `frontend/src/lib/i18n.ts`) siguen la misma regla de neutralidad para los 12 idiomas. Detalles: ver memoria `feedback_i18n_neutral.md`.
