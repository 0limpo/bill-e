/**
 * billEngine.ts
 * Pure business logic for Bill-e calculations
 * No React dependencies - pure functions
 */

// --- TYPES ---

export interface NumberFormat {
  thousands: string;
  decimal: string;
}

export interface Item {
  id?: string;
  name: string;
  price: number;
  price_as_shown?: number;  // Precio como aparece en la boleta
  quantity: number;
  mode?: 'individual' | 'grupal';
}

export interface Assignment {
  participant_id: string;
  quantity: number;
}

export interface Charge {
  id: string;
  name: string;
  value: number;
  valueType: 'percent' | 'fixed';
  isDiscount: boolean;
  distribution?: 'proportional' | 'per_person' | 'fixed_per_person';
  calculatedAmount?: number;
  // True cuando el cargo ya está dentro de los precios de items (ej. IVA UE).
  // El UI lo oculta del listado y excluye del cálculo de totales.
  included_in_items?: boolean;
  // True cuando el cargo es una sugerencia (propina sugerida) no cobrada.
  // Se muestra como info pero NO se suma a totales.
  is_suggested?: boolean;
}

export interface Participant {
  id: string;
  name: string;
  phone?: string;
  paid_at?: string | null;
}

export interface Session {
  items: Item[];
  assignments: Record<string, Assignment[]>;
  charges: Charge[];
  participants: Participant[];
  status?: 'active' | 'finalized';
  subtotal?: number;
}

export interface ParticipantCharge {
  id: string;
  name: string;
  amount: number;
}

export interface ParticipantTotals {
  subtotal: number;
  total: number;
  chargesTotal: number;
  charges: ParticipantCharge[];
}

// --- FORMATTING ---

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'
];

/**
 * Parse user-typed numeric input flexibly. Handles both decimal styles
 * (12.50 USD-style and 12,50 ES/CL-style) and thousand separators.
 *
 * Heuristic: the LAST punctuation mark (',' or '.') that has 1 or 2 digits
 * after it is the decimal separator. Anything else is a thousand separator.
 * Examples:
 *   "12.50"     -> 12.5    (dot decimal, 2 digits after)
 *   "12,50"     -> 12.5    (comma decimal, 2 digits after)
 *   "1.500"     -> 1500    (dot is thousand sep, 3 digits after)
 *   "1,500"     -> 1500    (comma is thousand sep, 3 digits after)
 *   "1.500,50"  -> 1500.5  (mixed: comma decimal)
 *   "1,500.50"  -> 1500.5  (mixed: dot decimal)
 */
export const parseFlexibleNumber = (input: string): number => {
  const cleaned = input.replace(/[^\d.,-]/g, "");
  if (!cleaned) return NaN;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let decimalSep: "," | "." | null = null;
  if (lastComma > lastDot) {
    if (cleaned.length - lastComma - 1 <= 2) decimalSep = ",";
  } else if (lastDot > lastComma) {
    if (cleaned.length - lastDot - 1 <= 2) decimalSep = ".";
  }
  let normalized = cleaned;
  if (decimalSep) {
    const otherSep = decimalSep === "." ? "," : ".";
    normalized = normalized.split(otherSep).join("");
    normalized = normalized.replace(decimalSep, ".");
  } else {
    normalized = normalized.replace(/[.,]/g, "");
  }
  return parseFloat(normalized);
};

/**
 * Format a number with thousand separators (no currency symbol)
 */
export const formatNumber = (
  amount: number,
  decimals: number = 0,
  numberFormat: NumberFormat | null = null
): string => {
  const fmt = numberFormat || { thousands: '.', decimal: ',' };
  const num = decimals > 0 ? Number(amount).toFixed(decimals) : Math.round(amount).toString();

  const [intPart, decPart] = num.split('.');
  const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, fmt.thousands);

  if (decPart !== undefined) {
    return `${intWithSep}${fmt.decimal}${decPart}`;
  }
  return intWithSep;
};

/**
 * Format a number as currency (with $ symbol)
 */
export const formatCurrency = (
  amount: number,
  decimals: number = 0,
  numberFormat: NumberFormat | null = null
): string => {
  return `$${formatNumber(amount, decimals, numberFormat)}`;
};

/**
 * Detect whether the view should render 2 decimals.
 *
 * Mira ítems, charges (valor + amount calculado), y opcionalmente los
 * totales por participante calculados a partir de session. Devuelve 2 si
 * cualquier valor que se vaya a mostrar tiene parte fraccional > medio
 * centavo (tolerancia para residuo de punto flotante).
 *
 * Cubre el caso donde los ítems vienen enteros pero splits o cargos
 * porcentuales producen decimales en los totales por persona.
 */
export const detectDecimals = (
  items: Item[] | undefined,
  charges?: Charge[],
  session?: Session
): number => {
  const HALF_CENT = 0.005;
  const hasFraction = (n: number) => Math.abs(n - Math.round(n)) > HALF_CENT;

  if (items) {
    for (const item of items) {
      if (hasFraction(item.price)) return 2;
      if (item.price_as_shown != null && hasFraction(item.price_as_shown)) return 2;
    }
  }

  if (charges) {
    for (const c of charges) {
      if (hasFraction(c.value)) return 2;
      if (c.calculatedAmount != null && hasFraction(c.calculatedAmount)) return 2;
    }
  }

  if (session && session.participants) {
    for (const p of session.participants) {
      const { total, charges: pCharges } = calculateParticipantTotal(p.id, session);
      if (hasFraction(total)) return 2;
      for (const pc of pCharges) {
        if (hasFraction(pc.amount)) return 2;
      }
    }
  }

  return 0;
};

/**
 * Generate a consistent color based on index (preferred) or name fallback
 */
export const getAvatarColor = (name: string, index?: number): string => {
  // If index is provided, use it directly for guaranteed unique colors
  if (index !== undefined) {
    return AVATAR_COLORS[index % AVATAR_COLORS.length];
  }
  // Fallback to name-based hash
  let hash = 5381;
  const str = name.toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  hash = hash ^ (str.length * 7919);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

/**
 * Get initials from a name
 */
export const getInitials = (name: string): string =>
  name ? name.substring(0, 2).toUpperCase() : '??';

// --- CALCULATIONS ---

/**
 * Detect items with unit assignments (to avoid double counting)
 */
export const getItemsWithUnitAssignments = (
  assignments: Record<string, Assignment[]> | undefined
): Set<string> => {
  const itemsWithUnits = new Set<string>();
  Object.entries(assignments || {}).forEach(([key, assigns]) => {
    const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
    if (unitMatch && assigns && assigns.length > 0) {
      itemsWithUnits.add(unitMatch[1]);
    }
  });
  return itemsWithUnits;
};

/**
 * Calculate subtotal for a participant based on their assignments
 * Handles both individual mode (each person gets N units) and grupal mode (people share)
 */
export const calculateSubtotal = (
  participantId: string,
  session: Session,
  itemsWithUnitAssignments: Set<string>
): number => {
  let subtotal = 0;

  Object.entries(session.assignments || {}).forEach(([assignmentKey, assigns]) => {
    const assignment = assigns.find(a => a.participant_id === participantId);
    if (assignment && assignment.quantity > 0) {
      const unitMatch = assignmentKey.match(/^(.+)_unit_(\d+)$/);

      if (unitMatch) {
        // Unit-specific assignment - divide unit price among all assigned participants
        const baseItemId = unitMatch[1];
        const item = session.items.find(i => (i.id || i.name) === baseItemId);
        if (item) {
          const numPeopleSharing = assigns.filter(a => a.quantity > 0).length;
          subtotal += item.price / Math.max(1, numPeopleSharing);
        }
      } else {
        // Full item assignment - skip if has unit assignments
        if (itemsWithUnitAssignments.has(assignmentKey)) {
          return;
        }
        const item = session.items.find(i => (i.id || i.name) === assignmentKey);
        if (item) {
          const numPeopleSharing = assigns.filter(a => a.quantity > 0).length;
          const isGrupalMode = item.mode === "grupal";

          if (isGrupalMode && numPeopleSharing > 1) {
            // Grupal: people share equally regardless of who got how many.
            const itemQty = item.quantity || 1;
            const totalItemPrice = item.price * itemQty;
            subtotal += totalItemPrice / numPeopleSharing;
          } else {
            // Individual: each person pays for their assigned units, even
            // when several people split a multi-quantity line. Splitting
            // the whole line equally here was the cause of the per-person
            // subtotals being off in the share view (one over, one under,
            // sum stays correct).
            subtotal += item.price * (assignment.quantity || 0);
          }
        }
      }
    }
  });

  return subtotal;
};

/**
 * Calculate total subtotal for all participants
 */
export const calculateTotalSubtotal = (
  session: Session,
  itemsWithUnitAssignments: Set<string>
): number => {
  let totalSubtotal = 0;

  session.participants?.forEach(p => {
    totalSubtotal += calculateSubtotal(p.id, session, itemsWithUnitAssignments);
  });

  return totalSubtotal;
};

/**
 * Calculate charges for a participant
 */
export const calculateCharges = (
  subtotal: number,
  totalSubtotal: number,
  charges: Charge[] | undefined,
  numParticipants: number
): { chargesTotal: number; charges: ParticipantCharge[] } => {
  const ratio = totalSubtotal > 0 ? subtotal / totalSubtotal : 1 / numParticipants;
  let chargesTotal = 0;
  const participantCharges: ParticipantCharge[] = [];

  (charges || []).forEach(charge => {
    const value = charge.value || 0;
    const valueType = charge.valueType || 'fixed';
    const isDiscount = charge.isDiscount || false;
    const distribution = charge.distribution || 'proportional';

    // Calculate base charge amount
    let chargeAmount = valueType === 'percent' ? totalSubtotal * (value / 100) : value;

    // Apply distribution
    let participantCharge: number;
    if (distribution === 'fixed_per_person') {
      participantCharge = chargeAmount; // Each person pays full amount
    } else if (distribution === 'per_person') {
      participantCharge = chargeAmount / numParticipants; // Split equally
    } else {
      participantCharge = chargeAmount * ratio; // Proportional to consumption
    }

    // Apply sign (discount = negative)
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
 * Calculate complete total for a participant
 */
export const calculateParticipantTotal = (
  participantId: string,
  session: Session
): ParticipantTotals => {
  if (!session) return { subtotal: 0, total: 0, chargesTotal: 0, charges: [] };

  const numParticipants = session.participants?.length || 1;
  const itemsWithUnitAssignments = getItemsWithUnitAssignments(session.assignments);

  // Calculate participant subtotal
  const subtotal = calculateSubtotal(participantId, session, itemsWithUnitAssignments);

  // Calculate total subtotal for ratio
  const totalSubtotal = calculateTotalSubtotal(session, itemsWithUnitAssignments);

  // Calculate charges
  const { chargesTotal, charges } = calculateCharges(
    subtotal,
    totalSubtotal,
    session.charges,
    numParticipants
  );

  // Total = subtotal + charges
  const total = subtotal + chargesTotal;

  return { subtotal, total, chargesTotal, charges };
};

// --- VALIDATIONS ---

/**
 * Calculate total of items in session
 */
export const calculateTotalItems = (items: Item[] | undefined): number => {
  return (items || []).reduce((sum, item) => {
    return sum + (item.price || 0) * (item.quantity || 1);
  }, 0);
};

/**
 * Calculate total assigned in session
 */
export const calculateTotalAssigned = (session: Session): number => {
  if (!session) return 0;

  const itemsWithUnitAssignments = getItemsWithUnitAssignments(session.assignments);
  let totalAssigned = 0;

  session.participants?.forEach(p => {
    totalAssigned += calculateSubtotal(p.id, session, itemsWithUnitAssignments);
  });

  return totalAssigned;
};

/**
 * Validate if totals are balanced
 */
export const validateTotals = (
  totalItems: number,
  totalAssigned: number,
  billTotal: number,
  tolerance: number = 0.01
): { isBalanced: boolean; itemsMatch: boolean; assignedMatch: boolean } => {
  const itemsDiff = Math.abs(totalItems - billTotal);
  const assignedDiff = Math.abs(totalAssigned - totalItems);

  const itemsMatch = billTotal === 0 || itemsDiff <= billTotal * tolerance;
  const assignedMatch = totalItems === 0 || assignedDiff <= totalItems * tolerance;
  const isBalanced = itemsMatch && assignedMatch;

  return { isBalanced, itemsMatch, assignedMatch };
};
