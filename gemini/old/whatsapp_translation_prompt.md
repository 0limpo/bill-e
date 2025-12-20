# Prompt para Traducción de Mensajes WhatsApp - Bill-e

## Contexto de Bill-e

Bill-e es una aplicación móvil/web para dividir cuentas de restaurante de forma colaborativa. El flujo es:

1. Usuario envía foto de boleta/recibo por WhatsApp
2. Bill-e procesa la imagen con OCR (Vision + Gemini)
3. Bill-e responde con 2 links:
   - **Link de anfitrión**: Para el que pagó, puede ver totales y cerrar la cuenta
   - **Link para compartir**: Para enviar al grupo de WhatsApp y que cada persona seleccione lo que consumió
4. Los participantes entran al link, seleccionan sus items, y ven cuánto deben pagar

## Audiencia

- **Edad**: 18-40 años
- **Contexto**: Amigos dividiendo cuenta en restaurante/bar
- **Tono**: Casual, amigable, directo (como un amigo útil, no un bot corporativo)
- **Restricciones WhatsApp**:
  - No usar markdown complejo (solo *bold* y _italic_)
  - Evitar URLs muy largas en el texto
  - Emojis son bienvenidos pero sin exceso

## Idiomas requeridos

Traduce a estos 11 idiomas (español ya está):
1. **en** - English (US casual)
2. **pt** - Portuguese (Brazilian casual)
3. **zh** - Chinese Simplified (informal)
4. **hi** - Hindi (conversational)
5. **fr** - French (tu form, casual)
6. **ar** - Arabic (Modern Standard, casual tone)
7. **bn** - Bengali (conversational, informal)
8. **ru** - Russian (ты form, informal)
9. **ja** - Japanese (casual polite, not keigo)
10. **de** - German (du form, casual)
11. **id** - Indonesian (casual)

## Mensajes a traducir

### 1. processing
Mensaje que aparece mientras se procesa la imagen.
```
Estoy procesando tu boleta...
```

### 2. error_no_image
Error cuando no se puede obtener la imagen.
```
No pude obtener la imagen. Intenta de nuevo.
```

### 3. error_download
Error al descargar la imagen.
```
No pude descargar la imagen.
```

### 4. error_ocr
Error durante el procesamiento OCR. {error} es un placeholder.
```
Error al procesar la boleta: {error}

Por favor intenta con una foto mas clara.
```

### 5. error_general
Error genérico.
```
Ocurrio un error. Por favor intenta de nuevo.
```

### 6. welcome
Mensaje de bienvenida cuando el usuario escribe "hola" o similar.
```
Hola! Soy Bill-e, tu asistente para dividir cuentas.

*Para empezar:*
1. Toma una foto clara de tu boleta
2. Enviamela por este chat
3. Te creare un link para dividir automaticamente

Escribe 'ayuda' para mas informacion.
```

### 7. help
Mensaje de ayuda detallado.
```
*Como usar Bill-e:*

1. Toma una foto de tu boleta de restaurante
2. Enviamela por WhatsApp
3. Procesare automaticamente los items y precios
4. Te dare un link para dividir la cuenta
5. Comparte el link con tus amigos!

*Tips para mejores resultados:*
- Asegurate de que la boleta este bien iluminada
- Que se vean claramente los precios y nombres
- Evita sombras o reflejos

Listo? Envia tu boleta!
```

### 8. default
Mensaje cuando el usuario escribe algo no reconocido.
```
Para dividir una cuenta, enviame una foto de tu boleta.

Solo toma la foto y enviamela - yo hare el resto.
Escribe 'ayuda' si necesitas mas informacion.
```

### 9. document_received
Cuando el usuario envía un PDF u otro documento. {filename} es placeholder.
```
Recibi tu documento: {filename}

Por ahora solo puedo procesar imagenes de boletas.
Puedes enviarme una foto de la boleta en su lugar?
```

### 10. Etiquetas cortas para el mensaje de sesión
Traduce estas etiquetas individuales:
- `session_verified`: "Totales verificados"
- `session_review`: "Revisar totales"
- `session_total`: "Total"
- `session_subtotal`: "Subtotal"
- `session_tip`: "Propina"
- `session_items`: "Items"
- `session_host_link`: "Tu link de anfitrion (guardalo)"
- `session_host_instruction`: "Usa este link para ver los totales y finalizar"
- `session_share_link`: "Link para compartir con tus amigos"
- `session_share_instruction`: "Copia y envia este link al grupo"
- `session_expires`: "La sesion expira en 24 horas"
- `receipt_processed`: "Boleta procesada!"

## Formato de respuesta

Responde en formato JSON estructurado así:

```json
{
  "processing": {
    "en": "...",
    "pt": "...",
    "zh": "...",
    "hi": "...",
    "fr": "...",
    "ru": "...",
    "ja": "...",
    "de": "...",
    "id": "..."
  },
  "error_no_image": { ... },
  ...
}
```

## Notas importantes

1. **NO uses caracteres especiales** que puedan causar problemas de encoding (evita tildes/acentos en idiomas que no los usan nativamente)
2. **Mantén el tono casual** - como un amigo, no como un banco
3. **Los placeholders {error} y {filename}** deben mantenerse exactamente igual
4. **Longitud similar** al original español - no expandas mucho
5. **Evita formalidades excesivas** - en japonés no uses keigo, en alemán usa "du", en francés usa "tu"
