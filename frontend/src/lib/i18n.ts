/**
 * i18n.ts
 * Simple internationalization for Bill-e
 */

export type Language = 'es' | 'en';

export const translations: Record<Language, Record<string, string>> = {
  es: {
    // App
    "app.title": "Bill-e",
    "app.subtitle": "Divide cuentas fácilmente",

    // Steps
    "steps.review": "Verificar",
    "steps.assign": "Asignar",
    "steps.share": "Compartir",
    "steps.back": "Atrás",
    "steps.continue": "Continuar",
    "steps.reviewTitle": "Revisa tu cuenta",
    "steps.reviewSubtitle": "Verifica y ajusta los items detectados",
    "steps.assignTitle": "Asigna los items",
    "steps.assignSubtitle": "Selecciona quién consumió cada item",

    // Items
    "items.name": "Nombre",
    "items.quantity": "Cant.",
    "items.price": "Precio",
    "items.total": "Total",
    "items.individual": "Individual",
    "items.grupal": "Grupal",
    "items.allTogether": "Todos juntos",
    "items.perUnit": "Por unidad",
    "items.unit": "Unidad",
    "items.addManualItem": "Agregar item",
    "items.deleteItem": "Eliminar",

    // Charges
    "charges.sectionTitle": "Cargos y descuentos",
    "charges.addCharge": "Agregar cargo/descuento",
    "charges.tip": "Propina",
    "charges.tax": "Impuesto",
    "charges.discount": "Descuento",
    "charges.service": "Servicio",
    "charges.charge": "Cargo",
    "charges.percent": "%",
    "charges.fixed": "$",
    "charges.howToSplit": "¿Cómo dividir?",
    "charges.proportional": "Proporcional",
    "charges.proportionalDesc": "Según lo que consumió cada uno",
    "charges.perPerson": "Por persona",
    "charges.perPersonDesc": "Multiplicar por cantidad de personas",
    "charges.splitEqual": "Dividido igual",
    "charges.splitEqualDesc": "Mismo monto para todos",

    // Totals
    "totals.subtotal": "Subtotal",
    "totals.total": "Total",
    "totals.tableTotal": "Total de la mesa",
    "totals.perPerson": "Por persona",

    // Participants
    "participants.add": "Agregar persona",
    "participants.addShort": "Agregar",
    "participants.name": "Nombre",

    // Finalized
    "finalized.billClosed": "Cuenta cerrada",
    "finalized.shareWhatsApp": "Compartir",
    "finalized.breakdown": "Desglose",

    // Verification
    "verify.title": "Verificación",
    "verify.subtitle": "Compara la boleta con la suma de items + cargos y descuentos",
    "verify.receiptSubtotal": "Subtotal boleta",
    "verify.receiptTotal": "Total boleta",
    "verify.match": "Los valores coinciden",
    "verify.mismatch": "Hay diferencias",
    "verify.scannedCorrectly": "Boleta leída correctamente",

    // Assignment
    "assign.remaining": "Falta por asignar",
    "assign.allAssigned": "Todo asignado",

    // Join screen
    "join.title": "Únete a la sesión",
    "join.selectExisting": "¿Eres uno de ellos?",
    "join.or": "o",
    "join.newName": "Únete con otro nombre",
    "join.joinNew": "Unirme",

    // Editor (participant view)
    "editor.hostVerifying": "El host está verificando la cuenta. Puedes ver los items mientras esperas.",
    "editor.hostReady": "El host terminó de verificar. ¡Puedes asignar items!",
    "editor.waitingForHost": "Esperando al host...",
    "editor.noItemsYet": "Aún no hay items escaneados",
    "steps.goToAssign": "Ir a asignar items",

    // Errors
    "error.noItems": "No hay items",
    "error.noParticipants": "Agrega personas primero",
  },
  en: {
    // App
    "app.title": "Bill-e",
    "app.subtitle": "Split bills easily",

    // Steps
    "steps.review": "Review",
    "steps.assign": "Assign",
    "steps.share": "Share",
    "steps.back": "Back",
    "steps.continue": "Continue",
    "steps.reviewTitle": "Review your bill",
    "steps.reviewSubtitle": "Verify and adjust detected items",
    "steps.assignTitle": "Assign items",
    "steps.assignSubtitle": "Select who consumed each item",

    // Items
    "items.name": "Name",
    "items.quantity": "Qty",
    "items.price": "Price",
    "items.total": "Total",
    "items.individual": "Individual",
    "items.grupal": "Shared",
    "items.allTogether": "Everyone",
    "items.perUnit": "Per unit",
    "items.unit": "Unit",
    "items.addManualItem": "Add item",
    "items.deleteItem": "Delete",

    // Charges
    "charges.sectionTitle": "Charges & discounts",
    "charges.addCharge": "Add charge/discount",
    "charges.tip": "Tip",
    "charges.tax": "Tax",
    "charges.discount": "Discount",
    "charges.service": "Service",
    "charges.charge": "Charge",
    "charges.percent": "%",
    "charges.fixed": "$",
    "charges.howToSplit": "How to split?",
    "charges.proportional": "Proportional",
    "charges.proportionalDesc": "Based on what each person ordered",
    "charges.perPerson": "Per person",
    "charges.perPersonDesc": "Multiply by number of people",
    "charges.splitEqual": "Split equal",
    "charges.splitEqualDesc": "Same amount for everyone",

    // Totals
    "totals.subtotal": "Subtotal",
    "totals.total": "Total",
    "totals.tableTotal": "Table total",
    "totals.perPerson": "Per person",

    // Participants
    "participants.add": "Add person",
    "participants.addShort": "Add",
    "participants.name": "Name",

    // Finalized
    "finalized.billClosed": "Bill closed",
    "finalized.shareWhatsApp": "Share",
    "finalized.breakdown": "Breakdown",

    // Verification
    "verify.title": "Verification",
    "verify.subtitle": "Compare receipt with items + charges and discounts",
    "verify.receiptSubtotal": "Receipt subtotal",
    "verify.receiptTotal": "Receipt total",
    "verify.match": "Values match",
    "verify.mismatch": "There are differences",
    "verify.scannedCorrectly": "Receipt scanned correctly",

    // Assignment
    "assign.remaining": "Remaining to assign",
    "assign.allAssigned": "All assigned",

    // Join screen
    "join.title": "Join the session",
    "join.selectExisting": "Are you one of them?",
    "join.or": "or",
    "join.newName": "Join with a different name",
    "join.joinNew": "Join",

    // Editor (participant view)
    "editor.hostVerifying": "The host is verifying the bill. You can see the items while you wait.",
    "editor.hostReady": "The host finished verifying. You can assign items!",
    "editor.waitingForHost": "Waiting for host...",
    "editor.noItemsYet": "No items scanned yet",
    "steps.goToAssign": "Go to assign items",

    // Errors
    "error.noItems": "No items",
    "error.noParticipants": "Add people first",
  },
};

/**
 * Get a translation function for a specific language
 */
export const getTranslator = (lang: Language) => {
  return (key: string): string => {
    return translations[lang][key] || key;
  };
};

/**
 * Detect browser language
 */
export const detectLanguage = (): Language => {
  if (typeof navigator === 'undefined') return 'es';
  const browserLang = navigator.language.slice(0, 2);
  return browserLang === 'en' ? 'en' : 'es';
};
