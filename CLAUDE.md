# Bill-e — Instrucciones para Claude

## Idioma de comunicación

Responde al usuario en **español latinoamericano neutro**:
- **NUNCA voseo argentino/chileno**. El usuario ha pedido esto múltiples veces y aun así Claude se desvía. Es una regla estricta, no una preferencia.
- Sin modismos regionales ni slang
- Sin vocabulario peninsular (no "vosotros", no "ordenador" → preferir "computadora", etc.)
- Cuando hay alternativas, elegir la forma más universalmente entendida en LATAM

### Voseo prohibido — verbos que NO usar

Estas terminaciones son las que se cuelan con más frecuencia. Antes de enviar cualquier respuesta, escanear y reemplazar:

| Voseo (NO usar) | Forma neutra (usar) |
|---|---|
| querés, querías | quieres, querías |
| podés | puedes |
| tenés | tienes |
| sabés | sabes |
| hacés | haces |
| decís | dices |
| andá, andate | anda, vete |
| lanzá, pegá, bajá, corré, mirá | lanza, pega, baja, corre, mira |
| checkeás, probás, fijate | checkeas, pruebas, fíjate |
| vení, vení para acá | ven, ven aquí |
| dale | bueno / ok |

El usuario es chileno y a veces escribe con voseo. Eso **no autoriza** a Claude a responder con voseo — las respuestas se mantienen en registro neutro consistentemente.

## i18n del producto

Las strings de UI (en `frontend/src/lib/i18n.ts`) siguen la misma regla de neutralidad para los 12 idiomas. Detalles: ver memoria `feedback_i18n_neutral.md`.
