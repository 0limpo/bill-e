/**
 * billEngine.js
 * Lógica matemática pura para cálculos de Bill-e
 * Sin dependencias de React - funciones puras
 */

// --- FORMATEO ---

/**
 * Formatea un número como moneda
 * @param {number} amount - Cantidad a formatear
 * @param {number} decimals - Decimales a mostrar (default 0)
 * @param {object} numberFormat - Formato { thousands: ',', decimal: '.' }
 * @returns {string} Cantidad formateada con símbolo $
 */
export const formatCurrency = (amount, decimals = 0, numberFormat = null) => {
  const fmt = numberFormat || { thousands: ',', decimal: '.' };
  const num = decimals > 0 ? Number(amount).toFixed(decimals) : Math.round(amount).toString();

  const [intPart, decPart] = num.split('.');
  const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, fmt.thousands);

  if (decPart !== undefined) {
    return `$${intWithSep}${fmt.decimal}${decPart}`;
  }
  return `$${intWithSep}`;
};

// --- AVATARES ---

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'
];

/**
 * Genera un color consistente basado en el nombre
 * @param {string} name - Nombre del participante
 * @returns {string} Color hex
 */
export const getAvatarColor = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

/**
 * Obtiene las iniciales de un nombre
 * @param {string} name - Nombre completo
 * @returns {string} Iniciales (2 caracteres)
 */
export const getInitials = (name) => name ? name.substring(0, 2).toUpperCase() : '??';

// --- CÁLCULOS DE TOTALES ---

/**
 * Detecta qué items tienen asignaciones por unidad (para evitar doble conteo)
 * @param {object} assignments - Objeto de asignaciones { itemId: [{ participant_id, quantity }] }
 * @returns {Set} Set de IDs de items con unit assignments
 */
export const getItemsWithUnitAssignments = (assignments) => {
  const itemsWithUnits = new Set();
  Object.entries(assignments || {}).forEach(([key, assigns]) => {
    const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
    if (unitMatch && assigns && assigns.length > 0) {
      itemsWithUnits.add(unitMatch[1]);
    }
  });
  return itemsWithUnits;
};

/**
 * Calcula el subtotal de un participante basado en sus asignaciones
 * @param {string} participantId - ID del participante
 * @param {object} session - Datos de la sesión { items, assignments }
 * @param {Set} itemsWithUnitAssignments - Items que tienen unit assignments
 * @returns {number} Subtotal del participante
 */
export const calculateSubtotal = (participantId, session, itemsWithUnitAssignments) => {
  let subtotal = 0;

  Object.entries(session.assignments || {}).forEach(([assignmentKey, assigns]) => {
    const assignment = assigns.find(a => a.participant_id === participantId);
    if (assignment) {
      const unitMatch = assignmentKey.match(/^(.+)_unit_(\d+)$/);

      if (unitMatch) {
        // Es una asignación de unidad específica
        const baseItemId = unitMatch[1];
        const item = session.items.find(i => (i.id || i.name) === baseItemId);
        if (item) {
          subtotal += item.price * (assignment.quantity || 0);
        }
      } else {
        // Es una asignación de item completo - saltar si tiene unit assignments
        if (itemsWithUnitAssignments.has(assignmentKey)) {
          return;
        }
        const item = session.items.find(i => (i.id || i.name) === assignmentKey);
        if (item) {
          subtotal += item.price * (assignment.quantity || 0);
        }
      }
    }
  });

  return subtotal;
};

/**
 * Calcula el subtotal total de todos los participantes
 * @param {object} session - Datos de la sesión
 * @param {Set} itemsWithUnitAssignments - Items con unit assignments
 * @returns {number} Subtotal total
 */
export const calculateTotalSubtotal = (session, itemsWithUnitAssignments) => {
  let totalSubtotal = 0;

  session.participants?.forEach(p => {
    totalSubtotal += calculateSubtotal(p.id, session, itemsWithUnitAssignments);
  });

  return totalSubtotal;
};

/**
 * Calcula los cargos para un participante
 * @param {number} subtotal - Subtotal del participante
 * @param {number} totalSubtotal - Subtotal total de todos
 * @param {array} charges - Lista de cargos de la sesión
 * @param {number} numParticipants - Número de participantes
 * @returns {object} { chargesTotal, charges: [{ id, name, amount }] }
 */
export const calculateCharges = (subtotal, totalSubtotal, charges, numParticipants) => {
  const ratio = totalSubtotal > 0 ? subtotal / totalSubtotal : 1 / numParticipants;
  let chargesTotal = 0;
  const participantCharges = [];

  (charges || []).forEach(charge => {
    const value = charge.value || 0;
    const valueType = charge.valueType || 'fixed';
    const isDiscount = charge.isDiscount || false;
    const distribution = charge.distribution || 'proportional';

    // Calcular monto base del cargo
    let chargeAmount = valueType === 'percent' ? totalSubtotal * (value / 100) : value;

    // Aplicar distribución
    let participantCharge;
    if (distribution === 'fixed_per_person') {
      participantCharge = chargeAmount; // Cada persona paga el monto completo
    } else if (distribution === 'per_person') {
      participantCharge = chargeAmount / numParticipants; // Dividido igual
    } else {
      participantCharge = chargeAmount * ratio; // Proporcional al consumo
    }

    // Aplicar signo (descuento = negativo)
    if (isDiscount) {
      participantCharge = -participantCharge;
    }

    participantCharges.push({
      id: charge.id,
      name: charge.name,
      amount: participantCharge
    });
    chargesTotal += participantCharge;
  });

  return { chargesTotal, charges: participantCharges };
};

/**
 * Calcula el total completo para un participante
 * @param {string} participantId - ID del participante
 * @param {object} session - Datos completos de la sesión
 * @returns {object} { subtotal, total, chargesTotal, charges }
 */
export const calculateParticipantTotal = (participantId, session) => {
  if (!session) return { subtotal: 0, total: 0, chargesTotal: 0, charges: [] };

  const numParticipants = session.participants?.length || 1;
  const itemsWithUnitAssignments = getItemsWithUnitAssignments(session.assignments);

  // Calcular subtotal del participante
  const subtotal = calculateSubtotal(participantId, session, itemsWithUnitAssignments);

  // Calcular subtotal total para ratio
  const totalSubtotal = calculateTotalSubtotal(session, itemsWithUnitAssignments);

  // Calcular cargos
  const { chargesTotal, charges } = calculateCharges(
    subtotal,
    totalSubtotal,
    session.charges,
    numParticipants
  );

  // Total = subtotal + cargos
  const total = subtotal + chargesTotal;

  return { subtotal, total, chargesTotal, charges };
};

// --- VALIDACIONES ---

/**
 * Calcula el total de items de la sesión
 * @param {array} items - Lista de items
 * @returns {number} Total de items
 */
export const calculateTotalItems = (items) => {
  return (items || []).reduce((sum, item) => {
    return sum + (item.price || 0) * (item.quantity || 1);
  }, 0);
};

/**
 * Calcula el total asignado en la sesión
 * @param {object} session - Datos de la sesión
 * @returns {number} Total asignado
 */
export const calculateTotalAssigned = (session) => {
  if (!session) return 0;

  const itemsWithUnitAssignments = getItemsWithUnitAssignments(session.assignments);
  let totalAssigned = 0;

  session.participants?.forEach(p => {
    totalAssigned += calculateSubtotal(p.id, session, itemsWithUnitAssignments);
  });

  return totalAssigned;
};

/**
 * Valida si los totales están balanceados
 * @param {number} totalItems - Total de items
 * @param {number} totalAssigned - Total asignado
 * @param {number} billTotal - Total de la boleta (subtotal OCR)
 * @param {number} tolerance - Tolerancia en porcentaje (default 1%)
 * @returns {object} { isBalanced, itemsMatch, assignedMatch }
 */
export const validateTotals = (totalItems, totalAssigned, billTotal, tolerance = 0.01) => {
  const itemsDiff = Math.abs(totalItems - billTotal);
  const assignedDiff = Math.abs(totalAssigned - totalItems);

  const itemsMatch = billTotal === 0 || itemsDiff <= billTotal * tolerance;
  const assignedMatch = totalItems === 0 || assignedDiff <= totalItems * tolerance;
  const isBalanced = itemsMatch && assignedMatch;

  return { isBalanced, itemsMatch, assignedMatch };
};
