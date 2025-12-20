# Task: Translate Bill-e UI to Arabic (ar) and Bengali (bn)

**Your task**: Using the Spanish JSON as source, generate 2 complete translation files for Arabic and Bengali. Read the full context below to understand what each text means and where it appears in the UI.

**Output**: 2 separate JSON files, clearly labeled:
- `=== ar.json ===` (Arabic - Right-to-Left language)
- `=== bn.json ===` (Bengali)

---

# Bill-e Translation Context

## What is Bill-e?

Bill-e is a mobile-first web app for splitting restaurant bills among friends. The flow is:

1. **Host** scans a receipt photo via WhatsApp or web
2. OCR extracts items and prices automatically
3. Host shares a link with friends
4. **Participants** join the session and claim their items
5. App calculates each person's share including tip
6. Host closes the bill and shares summary via WhatsApp

## User Roles

- **Host/Anfitrion**: The person who created the session. Has full control (edit items, add participants, close bill)
- **Participant/Editor**: Friends who join via link. Can only assign items to themselves and others

## Key Concepts

- **Boleta/Receipt**: The restaurant bill/check that was scanned
- **Individual mode**: One person pays for the entire item
- **Grupal mode**: Item is split among multiple people
- **"Entre todos" (All together)**: Everyone shares the item equally
- **"Por unidad" (Per unit)**: For items with qty>1, assign each unit separately (e.g., 3 beers, each to a different person)

---

# Translation Keys with Context

## selection.* - Join/Selection Screen
These appear when a participant opens the shared link and needs to identify themselves.

| Key | Spanish | Context |
|-----|---------|---------|
| `whoAreYou` | ¿Quién eres? | Main heading when participant opens link |
| `selectFromList` | Selecciona tu nombre de la lista | Subheading - asking to pick from existing names |
| `notInList` | + No estoy en la lista | Button to create new participant |
| `hello` | Hola, {{name}} | Greeting after selecting name. {{name}} = participant name |
| `confirmPhone` | Confirma tu teléfono para continuar | Ask for phone verification |
| `phonePlaceholder` | Tu Teléfono (requerido) | Input placeholder for phone field |
| `phoneRequired` | * Teléfono requerido (min. 8 dígitos) | Validation hint below phone input |
| `confirmAndEnter` | Confirmar y Entrar | Button to confirm and join session |
| `entering` | Entrando... | Loading state while joining |
| `back` | ← Volver | Back button |
| `newParticipant` | Nuevo Participante | Heading for new participant form |
| `enterDetails` | Ingresa tus datos para unirte | Subheading for new participant form |
| `namePlaceholder` | Tu Nombre | Placeholder for name input |
| `joining` | Uniendo... | Loading state while creating participant |
| `joinTable` | Unirme a la mesa | Button to join as new participant |

## header.* - Top Header Bar
Always visible at top of main screen.

| Key | Spanish | Context |
|-----|---------|---------|
| `host` | Host | Badge shown next to the session creator's avatar |
| `you` | Tú | Label shown instead of name for current user's avatar |
| `addParticipant` | Agregar Participante | Modal title when adding someone |

## items.* - Item List & Editing
The main list of consumed items from the receipt.

| Key | Spanish | Context |
|-----|---------|---------|
| `consumption` | Consumo | Section heading for item list |
| `individual` | Individual | Toggle option - one person pays full item |
| `grupal` | Grupal | Toggle option - item shared among people |
| `allTogether` | Entre todos | Sub-option in Grupal - split equally among all assigned |
| `perUnit` | Por unidad | Sub-option in Grupal - assign each unit separately |
| `unit` | Unidad {{num}} | Label for each unit. {{num}} = 1, 2, 3... |
| `qty` | Cant. | Column header for quantity (abbreviated) |
| `itemName` | Nombre del Item | Column header for item name |
| `unitPrice` | Precio Unit. | Column header for unit price (abbreviated) |
| `deleteItem` | Eliminar item | Tooltip/aria-label for delete button |
| `total` | Total | Label for total price |
| `perUnitSuffix` | c/u | Suffix meaning "each" (e.g., "$5.000 c/u" = $5,000 each) |
| `newItem` | Nuevo Consumo | Modal title for adding manual item |
| `name` | Nombre | Generic "Name" label |
| `price` | Precio ($) | Price input label with currency hint |
| `add` | Agregar | Add button |
| `addManualItem` | + Agregar Item Manual | Button to add item not on receipt |

## validation.* - Balance Validation (Host Only)
Shows whether the bill "balances" - all items assigned, totals match.

| Key | Spanish | Context |
|-----|---------|---------|
| `balanced` | Cuenta Cuadrada | Success message - everything balances |
| `reviewTotals` | Revisar Totales | Warning - something doesn't add up |
| `totalItems` | Total Items | Sum of all items |
| `totalAssigned` | Total Asignado | Sum of all assigned amounts |
| `totalBill` | Total Boleta | Receipt total from OCR |
| `subtotalItems` | Subtotal Items | Subtotal of items (before tip) |
| `subtotalBill` | Subtotal Boleta | Receipt subtotal from OCR |
| `subtotalAssigned` | Subtotal Asignado | Subtotal of assigned amounts |
| `itemsSum` | Suma Items | Alternative label for items sum |
| `missingToAssign` | Faltan {{amount}} por asignar | Warning: {{amount}} left to assign |
| `overAssigned` | Sobrepasado por {{amount}} | Warning: over-assigned by {{amount}} |

## tip.* - Tip/Gratuity Section

| Key | Spanish | Context |
|-----|---------|---------|
| `title` | Propina | Section heading |
| `titleWithPercent` | Propina ({{percent}}%) | Heading with percentage shown |
| `titleFixed` | Propina (fija) | Heading when using fixed amount |
| `percent` | Porcentaje | Toggle for percentage mode |
| `fixed` | Fija | Toggle for fixed amount mode |

## totals.* - Bottom Sheet Totals

| Key | Spanish | Context |
|-----|---------|---------|
| `tableTotal` | Total Mesa | Total for entire table (host view) |
| `yourConsumption` | TU CONSUMO | Heading for participant's breakdown |
| `subtotal` | Subtotal | Before tip |
| `tipLabel` | Propina | Tip line item |
| `total` | TOTAL | Final total (all caps for emphasis) |
| `tapForDetails` | Toca para ver detalle | Hint to expand bottom sheet |
| `selectItemsAbove` | Selecciona items arriba | Shown when user hasn't selected anything |

## finalized.* - Closed Bill State

| Key | Spanish | Context |
|-----|---------|---------|
| `billClosed` | Cuenta Cerrada | Status message when bill is finalized |
| `billOpen` | Asignando items... | Status message when bill is still open/being assigned |
| `closeBill` | Cerrar Cuenta | Button to finalize the bill |
| `reopenTable` | Reabrir Mesa | Button to reopen for editing |
| `shareWhatsApp` | Compartir por WhatsApp | Button to share summary |

## modals.* - Confirmation Dialogs

| Key | Spanish | Context |
|-----|---------|---------|
| `confirmClose` | ¿Cerrar la cuenta? Los participantes ya no podrán editar. | Confirm before closing bill |
| `confirmDelete` | ¿Eliminar este item? | Confirm before deleting item |
| `confirmReopen` | ¿Reabrir la mesa para editar? Los totales se recalcularán al cerrar de nuevo. | Confirm before reopening |
| `cancel` | Cancelar | Cancel button |
| `close` | Cerrar | Close/confirm button |
| `delete` | Eliminar | Delete button |
| `reopen` | Reabrir | Reopen button |

## participant.* - Participant Management

| Key | Spanish | Context |
|-----|---------|---------|
| `editParticipant` | Editar Participante | Modal title |
| `save` | Guardar | Save button |
| `whatDidTheyOrder` | ¿Qué pidieron? | Placeholder for item name input |

## errors.* - Error Messages

| Key | Spanish | Context |
|-----|---------|---------|
| `sessionNotFound` | Sesión no encontrada o expirada | When link is invalid or expired |
| `connectionError` | Error de conexión | Network error |
| `createItemError` | Error de conexión al crear item | Failed to create item |
| `invalidPrice` | Por favor ingresa un precio válido mayor a 0 | Price validation error |

## time.* - Timer

| Key | Spanish | Context |
|-----|---------|---------|
| `timer` | ⏱️ {{time}} | Session countdown. {{time}} = "1h 30m" or "45m" |

---

# Base Spanish JSON (Source of Truth)

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

# Translation Instructions

## Target Languages
1. `ar` - Arabic (Modern Standard Arabic - RTL language)
2. `bn` - Bengali (Bangla)

## Language-Specific Notes

### Arabic (ar)
- Right-to-Left (RTL) language
- Use Modern Standard Arabic (فصحى) with some colloquial touches for friendliness
- Use casual "أنت" (anta/anti) form
- For tip/gratuity, use "بقشيش" (bakhshish) which is common in Arabic-speaking countries
- Keep the arrow in `back` as `← رجوع` (arrow stays on left, text follows)

### Bengali (bn)
- Use casual "তুমি" (tumi) form for a friendly tone (not formal "আপনি")
- For tip, use "টিপ" (tip - borrowed word commonly used)
- Use colloquial Bangla where appropriate for a young, casual audience

## Rules

1. **Keep variables exactly as-is**: `{{name}}`, `{{num}}`, `{{amount}}`, `{{percent}}`, `{{time}}`
2. **Keep JSON keys in English** (e.g., `"whoAreYou"`, `"selectFromList"`)
3. **Keep special characters**: `←`, `+`, `⏱️`, `$`
4. **Tone**: Casual, friendly (app for friends splitting dinner)
5. **Brevity**: Mobile UI has limited space. Keep translations concise.
6. **Currency**: Keep `($)` as-is - app handles currency display separately
7. **Avoid unnecessary anglicisms** - use native words when natural equivalents exist

## Output Format

Generate one complete JSON file per language:

```
=== ar.json ===
{ ... complete JSON ... }

=== bn.json ===
{ ... complete JSON ... }
```

---

# Reference: English Translation (for comparison)

```json
{
  "selection": {
    "whoAreYou": "Who are you?",
    "selectFromList": "Select your name from the list",
    "notInList": "+ I'm not on the list",
    "hello": "Hi, {{name}}",
    "confirmPhone": "Confirm your phone to continue",
    "phonePlaceholder": "Your Phone (required)",
    "phoneRequired": "* Phone required (min. 8 digits)",
    "confirmAndEnter": "Confirm & Enter",
    "entering": "Entering...",
    "back": "← Back",
    "newParticipant": "New Participant",
    "enterDetails": "Enter your details to join",
    "namePlaceholder": "Your Name",
    "joining": "Joining...",
    "joinTable": "Join the table"
  },
  "header": {
    "host": "Host",
    "you": "You",
    "addParticipant": "Add Participant"
  },
  "items": {
    "consumption": "Items",
    "individual": "Individual",
    "grupal": "Group",
    "allTogether": "All together",
    "perUnit": "Per unit",
    "unit": "Unit {{num}}",
    "qty": "Qty",
    "itemName": "Item name",
    "unitPrice": "Unit price",
    "deleteItem": "Delete item",
    "total": "Total",
    "perUnitSuffix": "ea",
    "newItem": "New Item",
    "name": "Name",
    "price": "Price ($)",
    "add": "Add",
    "addManualItem": "+ Add Item Manually"
  },
  "validation": {
    "balanced": "All Balanced",
    "reviewTotals": "Review Totals",
    "totalItems": "Total Items",
    "totalAssigned": "Total Assigned",
    "totalBill": "Receipt Total",
    "subtotalItems": "Items Subtotal",
    "subtotalBill": "Receipt Subtotal",
    "subtotalAssigned": "Assigned Subtotal",
    "itemsSum": "Items Sum",
    "missingToAssign": "{{amount}} left to assign",
    "overAssigned": "Over by {{amount}}"
  },
  "tip": {
    "title": "Tip",
    "titleWithPercent": "Tip ({{percent}}%)",
    "titleFixed": "Tip (fixed)",
    "percent": "Percent",
    "fixed": "Fixed"
  },
  "totals": {
    "tableTotal": "Table Total",
    "yourConsumption": "YOUR TOTAL",
    "subtotal": "Subtotal",
    "tipLabel": "Tip",
    "total": "TOTAL",
    "tapForDetails": "Tap to see details",
    "selectItemsAbove": "Select items above"
  },
  "finalized": {
    "billClosed": "Bill Closed",
    "billOpen": "Assigning items...",
    "closeBill": "Close Bill",
    "reopenTable": "Reopen Table",
    "shareWhatsApp": "Share on WhatsApp"
  },
  "modals": {
    "confirmClose": "Close the bill? Participants won't be able to edit anymore.",
    "confirmDelete": "Delete this item?",
    "confirmReopen": "Reopen the table to edit? Totals will be recalculated when you close again.",
    "cancel": "Cancel",
    "close": "Close",
    "delete": "Delete",
    "reopen": "Reopen"
  },
  "participant": {
    "editParticipant": "Edit Participant",
    "save": "Save",
    "whatDidTheyOrder": "What did they order?"
  },
  "errors": {
    "sessionNotFound": "Session not found or expired",
    "connectionError": "Connection error",
    "createItemError": "Connection error while creating item",
    "invalidPrice": "Please enter a valid price greater than 0"
  },
  "time": {
    "timer": "⏱️ {{time}}"
  }
}
```
