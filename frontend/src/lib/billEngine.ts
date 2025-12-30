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
}

export interface Participant {
  id: string;
  name: string;
  phone?: string;
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

          if (numPeopleSharing > 1) {
            // Shared item: multiple people sharing, divide total price among them
            const itemQty = item.quantity || 1;
            const totalItemPrice = item.price * itemQty;
            subtotal += totalItemPrice / numPeopleSharing;
          } else {
            // Individual mode: this person has it alone
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
