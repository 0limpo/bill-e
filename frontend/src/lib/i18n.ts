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
    "items.addManualItem": "Agregar item",
    "items.deleteItem": "Eliminar",

    // Charges
    "charges.addCharge": "Agregar cargo/descuento",
    "charges.tip": "Propina",
    "charges.tax": "Impuesto",
    "charges.discount": "Descuento",
    "charges.service": "Servicio",
    "charges.charge": "Cargo",
    "charges.percent": "%",
    "charges.fixed": "$",
    "charges.proportional": "Proporcional",
    "charges.perPerson": "Por persona",
    "charges.splitEqual": "Dividido igual",

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
    "items.addManualItem": "Add item",
    "items.deleteItem": "Delete",

    // Charges
    "charges.addCharge": "Add charge/discount",
    "charges.tip": "Tip",
    "charges.tax": "Tax",
    "charges.discount": "Discount",
    "charges.service": "Service",
    "charges.charge": "Charge",
    "charges.percent": "%",
    "charges.fixed": "$",
    "charges.proportional": "Proportional",
    "charges.perPerson": "Per person",
    "charges.splitEqual": "Split equal",

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
