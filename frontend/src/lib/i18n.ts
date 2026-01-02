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

    // Editor phone verification
    "phoneVerify.title": "Verifica tu número",
    "phoneVerify.subtitle": "Ingresa tu número de WhatsApp para continuar",
    "phoneVerify.phone": "Número de WhatsApp",
    "phoneVerify.phonePlaceholder": "+56 9 1234 5678",
    "phoneVerify.sendCode": "Enviar código",
    "phoneVerify.codeSent": "Te enviamos un código por WhatsApp",
    "phoneVerify.enterCode": "Ingresa el código",
    "phoneVerify.codePlaceholder": "123456",
    "phoneVerify.verifyCode": "Verificar",
    "phoneVerify.freeRemaining": "Te quedan {count} sesiones gratis",
    "phoneVerify.resendCode": "Reenviar código",
    "phoneVerify.invalidCode": "Código inválido",
    "phoneVerify.codeExpired": "Código expirado",

    // Paywall
    "paywall.title": "Sesiones gratis agotadas",
    "paywall.subtitle": "Has usado tus sesiones gratis",
    "paywall.packageName": "Pack Bill-e",
    "paywall.bestValue": "Mejor valor",
    "paywall.hostSessions": "20 sesiones como anfitrión",
    "paywall.editorSessions": "Ilimitado como invitado",
    "paywall.expiry": "Válido por 1 año",
    "paywall.pay": "Comprar pack",
    "paywall.comingSoon": "Próximamente",
    "paywall.later": "Quizás después",

    // Editor (participant view)
    "editor.hostVerifying": "El host está verificando la cuenta. Puedes ver los items mientras esperas.",
    "editor.hostReady": "El host terminó de verificar. ¡Puedes asignar items!",
    "editor.hostAssigning": "El host está asignando. Puedes asignar tus items mientras esperas.",
    "editor.hostFinalized": "El host finalizó. ¡Puedes ver los resultados!",
    "editor.waitingForHost": "Esperando al host...",
    "editor.noItemsYet": "Aún no hay items escaneados",
    "steps.goToAssign": "Ir a asignar items",
    "steps.viewResults": "Ver resultados",

    // Errors
    "error.noItems": "No hay items",
    "error.noParticipants": "Agrega personas primero",
    "error.sessionActiveElsewhere": "Este link es del anfitrión",
    "error.sessionActiveElsewhereDesc": "La sesión del anfitrión ya está en uso. Usa el link de invitado para unirte.",
    "error.joinAsGuest": "Unirme como invitado",
    "error.retry": "Reintentar",
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

    // Editor phone verification
    "phoneVerify.title": "Verify your number",
    "phoneVerify.subtitle": "Enter your WhatsApp number to continue",
    "phoneVerify.phone": "WhatsApp number",
    "phoneVerify.phonePlaceholder": "+1 234 567 8900",
    "phoneVerify.sendCode": "Send code",
    "phoneVerify.codeSent": "We sent you a code via WhatsApp",
    "phoneVerify.enterCode": "Enter the code",
    "phoneVerify.codePlaceholder": "123456",
    "phoneVerify.verifyCode": "Verify",
    "phoneVerify.freeRemaining": "You have {count} free sessions left",
    "phoneVerify.resendCode": "Resend code",
    "phoneVerify.invalidCode": "Invalid code",
    "phoneVerify.codeExpired": "Code expired",

    // Paywall
    "paywall.title": "Free sessions used up",
    "paywall.subtitle": "You've used your free sessions",
    "paywall.packageName": "Bill-e Pack",
    "paywall.bestValue": "Best value",
    "paywall.hostSessions": "20 sessions as host",
    "paywall.editorSessions": "Unlimited as guest",
    "paywall.expiry": "Valid for 1 year",
    "paywall.pay": "Buy pack",
    "paywall.comingSoon": "Coming soon",
    "paywall.later": "Maybe later",

    // Editor (participant view)
    "editor.hostVerifying": "The host is verifying the bill. You can see the items while you wait.",
    "editor.hostReady": "The host finished verifying. You can assign items!",
    "editor.hostAssigning": "The host is assigning. You can assign your items while you wait.",
    "editor.hostFinalized": "The host has finalized. You can view the results!",
    "editor.waitingForHost": "Waiting for host...",
    "editor.noItemsYet": "No items scanned yet",
    "steps.goToAssign": "Go to assign items",
    "steps.viewResults": "View results",

    // Errors
    "error.noItems": "No items",
    "error.noParticipants": "Add people first",
    "error.sessionActiveElsewhere": "This is the host link",
    "error.sessionActiveElsewhereDesc": "The host session is already in use. Use the guest link to join.",
    "error.joinAsGuest": "Join as guest",
    "error.retry": "Retry",
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
