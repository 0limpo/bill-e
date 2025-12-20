# Task: Translate Bill-e to Arabic (ar) and Bengali (bn)

Translate ALL strings for the Bill-e app into **Arabic (ar)** and **Bengali (bn)**. This includes both the **Frontend UI** and **WhatsApp bot messages**.

**Output format**: Two separate JSON sections:
1. `=== ar_frontend.json ===` and `=== ar_whatsapp.json ===`
2. `=== bn_frontend.json ===` and `=== bn_whatsapp.json ===`

---

# What is Bill-e?

Bill-e is a mobile-first web app for splitting restaurant bills among friends.

**The flow:**
1. **Host** takes a photo of a restaurant receipt and sends it via WhatsApp
2. Bill-e's OCR extracts items and prices automatically
3. Host receives two links: one for themselves (host link) and one to share with friends
4. **Participants** open the shared link on their phones and claim which items they consumed
5. App calculates each person's share including tip
6. Host closes the bill and can share a summary via WhatsApp

**User roles:**
- **Host (المضيف / হোস্ট)**: Created the session. Can edit items, add participants, close bill
- **Participant (مشارك / অংশগ্রহণকারী)**: Joins via link. Can only assign items to themselves

**Key concepts:**
- **Receipt/Boleta (الفاتورة / রসিদ)**: The restaurant bill that was scanned
- **Individual mode**: One person pays for the entire item
- **Group mode**: Item is split among multiple people
- **"All together"**: Everyone shares the item equally
- **"Per unit"**: For items with qty>1, assign each unit separately (e.g., 3 beers → each to a different person)

---

# PART 1: FRONTEND TRANSLATIONS

These appear in the React web app that users see when they open the bill-splitting link.

## 1.1 selection.* - Join Screen
When a participant opens the shared link, they see this screen to identify themselves.

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `whoAreYou` | ¿Quién eres? | Who are you? | Main heading asking user to identify themselves |
| `selectFromList` | Selecciona tu nombre de la lista | Select your name from the list | Instruction to pick from existing participant names |
| `notInList` | + No estoy en la lista | + I'm not on the list | Button to register as new participant |
| `hello` | Hola, {{name}} | Hi, {{name}} | Greeting after selecting name. `{{name}}` = their name |
| `confirmPhone` | Confirma tu teléfono para continuar | Confirm your phone to continue | Asking for phone verification |
| `phonePlaceholder` | Tu Teléfono (requerido) | Your Phone (required) | Placeholder text in phone input field |
| `phoneRequired` | * Teléfono requerido (min. 8 dígitos) | * Phone required (min. 8 digits) | Validation message below phone input |
| `confirmAndEnter` | Confirmar y Entrar | Confirm & Enter | Button to confirm identity and enter session |
| `entering` | Entrando... | Entering... | Loading state while joining |
| `back` | ← Volver | ← Back | Back navigation button |
| `newParticipant` | Nuevo Participante | New Participant | Heading for new participant registration form |
| `enterDetails` | Ingresa tus datos para unirte | Enter your details to join | Instruction for new participant form |
| `namePlaceholder` | Tu Nombre | Your Name | Placeholder in name input field |
| `joining` | Uniendo... | Joining... | Loading state while creating new participant |
| `joinTable` | Unirme a la mesa | Join the table | Button to join as new participant |

## 1.2 header.* - Top Header Bar
Always visible at the top of the main screen.

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `host` | Host | Host | Badge/label next to session creator's avatar |
| `you` | Tú | You | Label shown on current user's own avatar instead of their name |
| `addParticipant` | Agregar Participante | Add Participant | Button/modal title for adding someone to the session |

## 1.3 items.* - Item List & Editing
The main section showing all items from the receipt.

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `consumption` | Consumo | Items/Orders | Section heading for the list of items |
| `individual` | Individual | Individual | Toggle: one person pays for entire item |
| `grupal` | Grupal | Group | Toggle: item is shared among multiple people |
| `allTogether` | Entre todos | All together | Sub-option: split equally among all assigned people |
| `perUnit` | Por unidad | Per unit | Sub-option: assign each unit separately (for qty>1) |
| `unit` | Unidad {{num}} | Unit {{num}} | Label for each unit. `{{num}}` = 1, 2, 3... |
| `qty` | Cant. | Qty | Column header for quantity (abbreviated) |
| `itemName` | Nombre del Item | Item name | Column header for item name |
| `unitPrice` | Precio Unit. | Unit price | Column header for price per unit (abbreviated) |
| `deleteItem` | Eliminar item | Delete item | Tooltip/aria-label for delete button |
| `total` | Total | Total | Label for total price of an item |
| `perUnitSuffix` | c/u | ea | Suffix meaning "each" (e.g., "$5,000 c/u" = $5,000 each) |
| `newItem` | Nuevo Consumo | New Item | Modal title for adding an item manually |
| `name` | Nombre | Name | Generic "Name" label in forms |
| `price` | Precio ($) | Price ($) | Price input label. Keep `($)` as-is |
| `add` | Agregar | Add | Button to add something |
| `addManualItem` | + Agregar Item Manual | + Add Item Manually | Button to add an item not on the receipt |

## 1.4 validation.* - Balance Validation
Shows whether all items are assigned and totals match. Host sees this section.

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `balanced` | Cuenta Cuadrada | All Balanced | Success: everything adds up correctly |
| `reviewTotals` | Revisar Totales | Review Totals | Warning: something doesn't match |
| `totalItems` | Total Items | Total Items | Sum of all item prices |
| `totalAssigned` | Total Asignado | Total Assigned | Sum of all amounts assigned to people |
| `totalBill` | Total Boleta | Receipt Total | Total from the scanned receipt |
| `subtotalItems` | Subtotal Items | Items Subtotal | Items total before tip |
| `subtotalBill` | Subtotal Boleta | Receipt Subtotal | Receipt subtotal from OCR |
| `subtotalAssigned` | Subtotal Asignado | Assigned Subtotal | Assigned amounts subtotal |
| `itemsSum` | Suma Items | Items Sum | Alternative label for sum of items |
| `missingToAssign` | Faltan {{amount}} por asignar | {{amount}} left to assign | Warning: this amount hasn't been assigned yet |
| `overAssigned` | Sobrepasado por {{amount}} | Over by {{amount}} | Warning: assigned more than the total |

## 1.5 tip.* - Tip/Gratuity Section

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `title` | Propina | Tip | Section heading for tip |
| `titleWithPercent` | Propina ({{percent}}%) | Tip ({{percent}}%) | Heading showing percentage. `{{percent}}` = number |
| `titleFixed` | Propina (fija) | Tip (fixed) | Heading when using fixed amount instead of percentage |
| `percent` | Porcentaje | Percent | Toggle for percentage-based tip |
| `fixed` | Fija | Fixed | Toggle for fixed amount tip |

## 1.6 totals.* - Bottom Sheet with Totals
Expandable section at bottom showing user's total.

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `tableTotal` | Total Mesa | Table Total | Total for the entire table (host view) |
| `yourConsumption` | TU CONSUMO | YOUR TOTAL | Heading for participant's personal breakdown |
| `subtotal` | Subtotal | Subtotal | Amount before tip |
| `tipLabel` | Propina | Tip | Tip line item in breakdown |
| `total` | TOTAL | TOTAL | Final total (all caps for emphasis) |
| `tapForDetails` | Toca para ver detalle | Tap to see details | Hint to expand the bottom sheet |
| `selectItemsAbove` | Selecciona items arriba | Select items above | Shown when user hasn't claimed any items yet |

## 1.7 finalized.* - Bill Status

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `billClosed` | Cuenta Cerrada | Bill Closed | Status: bill is finalized, no more edits |
| `billOpen` | Asignando items... | Assigning items... | Status: bill is still open, people are assigning |
| `closeBill` | Cerrar Cuenta | Close Bill | Button for host to finalize the bill |
| `reopenTable` | Reabrir Mesa | Reopen Table | Button to reopen for more editing |
| `shareWhatsApp` | Compartir por WhatsApp | Share on WhatsApp | Button to share summary via WhatsApp |

## 1.8 modals.* - Confirmation Dialogs

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `confirmClose` | ¿Cerrar la cuenta? Los participantes ya no podrán editar. | Close the bill? Participants won't be able to edit anymore. | Confirmation before closing |
| `confirmDelete` | ¿Eliminar este item? | Delete this item? | Confirmation before deleting |
| `confirmReopen` | ¿Reabrir la mesa para editar? Los totales se recalcularán al cerrar de nuevo. | Reopen the table to edit? Totals will be recalculated when you close again. | Confirmation before reopening |
| `cancel` | Cancelar | Cancel | Cancel button |
| `close` | Cerrar | Close | Close/confirm button |
| `delete` | Eliminar | Delete | Delete button |
| `reopen` | Reabrir | Reopen | Reopen button |

## 1.9 participant.* - Participant Management

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `editParticipant` | Editar Participante | Edit Participant | Modal title for editing a participant |
| `save` | Guardar | Save | Save button |
| `whatDidTheyOrder` | ¿Qué pidieron? | What did they order? | Prompt when assigning items to someone |

## 1.10 errors.* - Error Messages

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `sessionNotFound` | Sesión no encontrada o expirada | Session not found or expired | When the link is invalid or session expired |
| `connectionError` | Error de conexión | Connection error | Network error |
| `createItemError` | Error de conexión al crear item | Connection error while creating item | Failed to create new item |
| `invalidPrice` | Por favor ingresa un precio válido mayor a 0 | Please enter a valid price greater than 0 | Price validation error |

## 1.11 time.* - Timer

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `timer` | ⏱️ {{time}} | ⏱️ {{time}} | Session countdown. `{{time}}` = "1h 30m" or "45m" |

---

# PART 2: WHATSAPP BOT TRANSLATIONS

These are messages sent by the WhatsApp bot when users interact with Bill-e.

## 2.1 Bot Responses

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `processing` | Procesando tu boleta... | Processing your receipt... | Sent immediately after user sends a receipt photo |
| `error_no_image` | No pude obtener la imagen. Intenta de nuevo. | Couldn't get the image. Please try again. | When bot can't retrieve the image |
| `error_download` | No pude descargar la imagen. | Couldn't download the image. | When image download fails |
| `error_ocr` | Error procesando la boleta: {error}\n\nPor favor intenta con una foto más clara. | Error processing receipt: {error}\n\nPlease try with a clearer photo. | OCR failed. `{error}` = error message |
| `error_general` | Algo salió mal. Por favor intenta de nuevo. | Something went wrong. Please try again. | Generic error |

## 2.2 Welcome & Help Messages

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `welcome` | (see below) | (see below) | First message when user starts chatting with bot |
| `help` | (see below) | (see below) | Detailed help message explaining how to use Bill-e |
| `default` | (see below) | (see below) | Response when bot doesn't understand the message |

**welcome** - First interaction message:
```
Hi! I'm Bill-e, your bill-splitting assistant.

*To start:*
1. Take a clear photo of your receipt
2. Send it to me here
3. I'll create a link to split it automatically

Type 'help' for more info.
```

**help** - Detailed instructions:
```
*How to use Bill-e:*

1. Take a photo of your restaurant receipt
2. Send it to me via WhatsApp
3. I'll automatically process items and prices
4. I'll give you a link to split the bill
5. Share the link with your friends!

*Tips for best results:*
- Good lighting
- Prices and names clearly visible
- Avoid shadows or glare

Ready? Send your receipt!
```

**default** - When user sends text instead of image:
```
To split a bill, send me a photo of your receipt.

Just take the photo and send it - I'll do the rest.
Type 'help' if you need more info.
```

## 2.3 Document Handling

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `document_received` | Recibí tu documento: {filename}\n\nPor ahora solo proceso imágenes.\n¿Puedes enviar una foto? | Received your document: {filename}\n\nRight now I can only process images.\nCan you send a photo instead? | When user sends PDF or other document instead of image |

## 2.4 Session Labels (used in WhatsApp message after processing)

| Key | Spanish | English | Context/Meaning |
|-----|---------|---------|-----------------|
| `receipt_processed` | ¡Boleta procesada! | Receipt processed! | Success message header |
| `session_verified` | Totales verificados | Totals verified | When OCR totals match |
| `session_review` | Revisar totales | Review totals | When OCR totals need review |
| `session_total` | Total | Total | Label for total amount |
| `session_subtotal` | Subtotal | Subtotal | Label for subtotal |
| `session_tip` | Propina | Tip | Label for tip amount |
| `session_items` | Items | Items | Label for number of items |
| `session_host_link` | Tu link de host (guárdalo) | Your host link (keep it) | Label for host's private link |
| `session_host_instruction` | Usa este link para ver totales y cerrar | Use this link to see totals and finalize | Instruction for host link |
| `session_share_link` | Link para compartir con amigos | Link to share with friends | Label for shareable link |
| `session_share_instruction` | Copia y envía este link al grupo | Copy and send this link to the group | Instruction for sharing |
| `session_expires` | La sesión expira en 24 horas | Session expires in 24 hours | Expiration notice |

---

# TRANSLATION RULES

## General Rules
1. **Keep variables exactly as-is**: `{{name}}`, `{{num}}`, `{{amount}}`, `{{percent}}`, `{{time}}`, `{error}`, `{filename}`
2. **Keep JSON keys in English** (e.g., `"whoAreYou"`, `"selectFromList"`)
3. **Keep special characters**: `←`, `+`, `⏱️`, `$`, `*` (for WhatsApp bold)
4. **Keep newlines `\n`** in WhatsApp messages exactly as they appear
5. **Tone**: Casual, friendly - this is an app for friends splitting dinner, not a formal business tool
6. **Brevity**: Mobile UI has limited space. Keep translations concise.
7. **Currency**: Keep `($)` as-is - the app handles currency display separately

## Arabic (ar) Specific Rules
- Use **Modern Standard Arabic** with casual touches (not too formal)
- Use informal "أنت" (you) form for friendliness
- For "tip/gratuity", use **"بقشيش"** (bakhshish) - common in Arab countries
- **RTL note**: The app handles RTL layout. Keep `←` arrow as-is in `back` key
- Avoid English loanwords when Arabic equivalents exist, but common tech terms are OK
- Numbers and `{{variables}}` stay in their original form

## Bengali (bn) Specific Rules
- Use casual **"তুমি"** (tumi) form, not formal "আপনি" (apni) - app is for friends
- For "tip", use **"টিপ"** (tip) - the English loanword is commonly used
- Use colloquial Bangla where natural for a young, casual audience
- Mix of Bengali and English tech terms is acceptable (common in Bangladesh/West Bengal)

---

# OUTPUT FORMAT

Generate 4 JSON files:

```
=== ar_frontend.json ===
{
  "selection": { ... },
  "header": { ... },
  "items": { ... },
  "validation": { ... },
  "tip": { ... },
  "totals": { ... },
  "finalized": { ... },
  "modals": { ... },
  "participant": { ... },
  "errors": { ... },
  "time": { ... }
}

=== ar_whatsapp.json ===
{
  "processing": "...",
  "error_no_image": "...",
  "error_download": "...",
  "error_ocr": "...",
  "error_general": "...",
  "welcome": "...",
  "help": "...",
  "default": "...",
  "document_received": "...",
  "receipt_processed": "...",
  "session_verified": "...",
  "session_review": "...",
  "session_total": "...",
  "session_subtotal": "...",
  "session_tip": "...",
  "session_items": "...",
  "session_host_link": "...",
  "session_host_instruction": "...",
  "session_share_link": "...",
  "session_share_instruction": "...",
  "session_expires": "..."
}

=== bn_frontend.json ===
{ ... same structure as ar_frontend.json ... }

=== bn_whatsapp.json ===
{ ... same structure as ar_whatsapp.json ... }
```

---

# REFERENCE: Spanish Source (Frontend)

```json
{
  "selection": {
    "whoAreYou": "¿Quién eres?",
    "selectFromList": "Selecciona tu nombre de la lista",
    "notInList": "+ No estoy en la lista",
    "hello": "Hola, {{name}}",
    "confirmPhone": "Confirma tu teléfono para continuar",
    "phonePlaceholder": "Tu Teléfono (requerido)",
    "phoneRequired": "* Teléfono requerido (min. 8 dígitos)",
    "confirmAndEnter": "Confirmar y Entrar",
    "entering": "Entrando...",
    "back": "← Volver",
    "newParticipant": "Nuevo Participante",
    "enterDetails": "Ingresa tus datos para unirte",
    "namePlaceholder": "Tu Nombre",
    "joining": "Uniendo...",
    "joinTable": "Unirme a la mesa"
  },
  "header": {
    "host": "Host",
    "you": "Tú",
    "addParticipant": "Agregar Participante"
  },
  "items": {
    "consumption": "Consumo",
    "individual": "Individual",
    "grupal": "Grupal",
    "allTogether": "Entre todos",
    "perUnit": "Por unidad",
    "unit": "Unidad {{num}}",
    "qty": "Cant.",
    "itemName": "Nombre del Item",
    "unitPrice": "Precio Unit.",
    "deleteItem": "Eliminar item",
    "total": "Total",
    "perUnitSuffix": "c/u",
    "newItem": "Nuevo Consumo",
    "name": "Nombre",
    "price": "Precio ($)",
    "add": "Agregar",
    "addManualItem": "+ Agregar Item Manual"
  },
  "validation": {
    "balanced": "Cuenta Cuadrada",
    "reviewTotals": "Revisar Totales",
    "totalItems": "Total Items",
    "totalAssigned": "Total Asignado",
    "totalBill": "Total Boleta",
    "subtotalItems": "Subtotal Items",
    "subtotalBill": "Subtotal Boleta",
    "subtotalAssigned": "Subtotal Asignado",
    "itemsSum": "Suma Items",
    "missingToAssign": "Faltan {{amount}} por asignar",
    "overAssigned": "Sobrepasado por {{amount}}"
  },
  "tip": {
    "title": "Propina",
    "titleWithPercent": "Propina ({{percent}}%)",
    "titleFixed": "Propina (fija)",
    "percent": "Porcentaje",
    "fixed": "Fija"
  },
  "totals": {
    "tableTotal": "Total Mesa",
    "yourConsumption": "TU CONSUMO",
    "subtotal": "Subtotal",
    "tipLabel": "Propina",
    "total": "TOTAL",
    "tapForDetails": "Toca para ver detalle",
    "selectItemsAbove": "Selecciona items arriba"
  },
  "finalized": {
    "billClosed": "Cuenta Cerrada",
    "billOpen": "Asignando items...",
    "closeBill": "Cerrar Cuenta",
    "reopenTable": "Reabrir Mesa",
    "shareWhatsApp": "Compartir por WhatsApp"
  },
  "modals": {
    "confirmClose": "¿Cerrar la cuenta? Los participantes ya no podrán editar.",
    "confirmDelete": "¿Eliminar este item?",
    "confirmReopen": "¿Reabrir la mesa para editar? Los totales se recalcularán al cerrar de nuevo.",
    "cancel": "Cancelar",
    "close": "Cerrar",
    "delete": "Eliminar",
    "reopen": "Reabrir"
  },
  "participant": {
    "editParticipant": "Editar Participante",
    "save": "Guardar",
    "whatDidTheyOrder": "¿Qué pidieron?"
  },
  "errors": {
    "sessionNotFound": "Sesión no encontrada o expirada",
    "connectionError": "Error de conexión",
    "createItemError": "Error de conexión al crear item",
    "invalidPrice": "Por favor ingresa un precio válido mayor a 0"
  },
  "time": {
    "timer": "⏱️ {{time}}"
  }
}
```

---

# REFERENCE: English WhatsApp Messages

```json
{
  "processing": "Processing your receipt...",
  "error_no_image": "Couldn't get the image. Please try again.",
  "error_download": "Couldn't download the image.",
  "error_ocr": "Error processing receipt: {error}\n\nPlease try with a clearer photo.",
  "error_general": "Something went wrong. Please try again.",
  "welcome": "Hi! I'm Bill-e, your bill-splitting assistant.\n\n*To start:*\n1. Take a clear photo of your receipt\n2. Send it to me here\n3. I'll create a link to split it automatically\n\nType 'help' for more info.",
  "help": "*How to use Bill-e:*\n\n1. Take a photo of your restaurant receipt\n2. Send it to me via WhatsApp\n3. I'll automatically process items and prices\n4. I'll give you a link to split the bill\n5. Share the link with your friends!\n\n*Tips for best results:*\n- Good lighting\n- Prices and names clearly visible\n- Avoid shadows or glare\n\nReady? Send your receipt!",
  "default": "To split a bill, send me a photo of your receipt.\n\nJust take the photo and send it - I'll do the rest.\nType 'help' if you need more info.",
  "document_received": "Received your document: {filename}\n\nRight now I can only process images.\nCan you send a photo instead?",
  "receipt_processed": "Receipt processed!",
  "session_verified": "Totals verified",
  "session_review": "Review totals",
  "session_total": "Total",
  "session_subtotal": "Subtotal",
  "session_tip": "Tip",
  "session_items": "Items",
  "session_host_link": "Your host link (keep it)",
  "session_host_instruction": "Use this link to see totals and finalize",
  "session_share_link": "Link to share with friends",
  "session_share_instruction": "Copy and send this link to the group",
  "session_expires": "Session expires in 24 hours"
}
```
