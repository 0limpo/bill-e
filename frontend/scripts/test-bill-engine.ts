/**
 * test-bill-engine.ts
 *
 * Standalone smoke test for billEngine — no test framework, no jest.
 * Run with:  npx tsx scripts/test-bill-engine.ts
 *
 * The strong invariants we care about:
 *   I1. SUM of per-person subtotals == expected assigned subtotal.
 *   I2. SUM of per-person totals    == expected (subtotal + charges).
 *   I3. Per-person subtotal matches the expected formula for that scenario.
 *
 * I1+I2 alone are not enough — the bug we just fixed satisfied both
 * because Lu over-paid exactly what Diego under-paid. So I3 is the one
 * that catches per-person miscalculations.
 */

import {
  calculateParticipantTotal,
  calculateTotalAssigned,
  calculateTotalItems,
  type Session,
  type Item,
  type Charge,
  type Participant,
  type Assignment,
} from "../src/lib/billEngine";

// ---------- helpers ----------

const EPS = 0.01;
const close = (a: number, b: number) => Math.abs(a - b) < EPS;

let passes = 0;
let failures = 0;
const failedScenarios: string[] = [];

function scenario(name: string, fn: () => void) {
  try {
    fn();
    passes++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    failedScenarios.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${(e as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertClose(actual: number, expected: number, label: string) {
  if (!close(actual, expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual} (diff ${actual - expected})`);
  }
}

// Build a session with sane defaults.
function makeSession(args: {
  items: Item[];
  assignments: Record<string, Assignment[]>;
  charges?: Charge[];
  participants: Participant[];
}): Session {
  return {
    items: args.items,
    assignments: args.assignments,
    charges: args.charges ?? [],
    participants: args.participants,
  };
}

// Compute per-person totals for everyone.
function computeAll(s: Session) {
  const map: Record<string, ReturnType<typeof calculateParticipantTotal>> = {};
  for (const p of s.participants) {
    map[p.id] = calculateParticipantTotal(p.id, s);
  }
  return map;
}

// Sum per-person totals.
function sumPersonTotals(s: Session): { sub: number; tot: number } {
  const map = computeAll(s);
  let sub = 0,
    tot = 0;
  for (const p of s.participants) {
    sub += map[p.id].subtotal;
    tot += map[p.id].total;
  }
  return { sub, tot };
}

// ---------- shared participants ----------

const A: Participant = { id: "A", name: "Ana" };
const B: Participant = { id: "B", name: "Bruno" };
const C: Participant = { id: "C", name: "Carla" };

// ============================================================================
// Scenarios
// ============================================================================

console.log("\n=== Bill engine smoke test ===\n");

// --- S1: trivial — one item, one owner, no charges ---
scenario("S1 · single item qty=1, single owner, no charges", () => {
  const items: Item[] = [{ id: "i1", name: "Café", price: 1500, quantity: 1 }];
  const s = makeSession({
    items,
    assignments: { i1: [{ participant_id: "A", quantity: 1 }] },
    participants: [A],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 1500, "A subtotal");
  assertClose(r.A.total, 1500, "A total");
});

// --- S2: qty > 1, single owner ---
scenario("S2 · item qty=3, single owner, no charges", () => {
  const items: Item[] = [{ id: "i1", name: "Empanada", price: 2000, quantity: 3 }];
  const s = makeSession({
    items,
    assignments: { i1: [{ participant_id: "A", quantity: 3 }] },
    participants: [A],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 6000, "A subtotal");
});

// --- S3: two items, two participants, no sharing ---
scenario("S3 · two items, two participants, no sharing", () => {
  const items: Item[] = [
    { id: "i1", name: "Pizza", price: 8000, quantity: 1 },
    { id: "i2", name: "Cerveza", price: 3000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    participants: [A, B],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 8000, "A");
  assertClose(r.B.subtotal, 3000, "B");
});

// --- S4: qty=2 split EQUALLY (1+1), individual mode ---
scenario("S4 · qty=2 split 1+1 individual mode", () => {
  const items: Item[] = [
    { id: "i1", name: "Papas fritas", price: 1500, quantity: 2, mode: "individual" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
      ],
    },
    participants: [A, B],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 1500, "A");
  assertClose(r.B.subtotal, 1500, "B");
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 3000, "sum subtotals == line total");
});

// --- S5: qty=3 split UNEQUALLY (1+2), individual mode — THE bug we just fixed ---
scenario("S5 · qty=3 split 1+2 individual mode (regression case)", () => {
  const items: Item[] = [
    { id: "i1", name: "Alt+F4", price: 4900, quantity: 3, mode: "individual" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 2 },
      ],
    },
    participants: [A, B],
  });
  const r = computeAll(s);
  // The bug used to give A=B=7350. Correct:
  assertClose(r.A.subtotal, 4900, "A: 1 unit @ 4900");
  assertClose(r.B.subtotal, 9800, "B: 2 units @ 4900");
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 14700, "sum subtotals == 3×4900");
});

// --- S6: qty=1 grupal split among 3 people (typical "compartimos una pizza") ---
scenario("S6 · qty=1 grupal mode shared by 3", () => {
  const items: Item[] = [
    { id: "i1", name: "Pizza grande", price: 12000, quantity: 1, mode: "grupal" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 1 },
      ],
    },
    participants: [A, B, C],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 4000, "A: 12000/3");
  assertClose(r.B.subtotal, 4000, "B");
  assertClose(r.C.subtotal, 4000, "C");
});

// --- S7: qty=2 grupal mode shared by 3 (line total is 24000, split among 3) ---
scenario("S7 · qty=2 grupal mode shared by 3", () => {
  const items: Item[] = [
    { id: "i1", name: "Bandeja", price: 12000, quantity: 2, mode: "grupal" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 1 },
      ],
    },
    participants: [A, B, C],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 8000, "A: 12000*2/3");
  assertClose(r.B.subtotal, 8000, "B");
  assertClose(r.C.subtotal, 8000, "C");
});

// --- S8: percent charge, proportional distribution (typical propina 10%) ---
scenario("S8 · percent charge, proportional", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 8000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 12000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "c1", name: "Propina", value: 10, valueType: "percent", isDiscount: false, distribution: "proportional" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // Total subtotal = 20000. Tip = 2000. Proportional: A pays 800 (8000/20000 * 2000), B pays 1200.
  assertClose(r.A.subtotal, 8000, "A subtotal");
  assertClose(r.B.subtotal, 12000, "B subtotal");
  assertClose(r.A.chargesTotal, 800, "A tip");
  assertClose(r.B.chargesTotal, 1200, "B tip");
  assertClose(r.A.total, 8800, "A total");
  assertClose(r.B.total, 13200, "B total");
  const sums = sumPersonTotals(s);
  assertClose(sums.tot, 22000, "sum totals == 20000 + 2000");
});

// --- S9: fixed charge, proportional distribution ---
scenario("S9 · fixed charge, proportional", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 8000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 12000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "c1", name: "Cubierto", value: 1000, valueType: "fixed", isDiscount: false, distribution: "proportional" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // Charge = 1000. A ratio = 8000/20000 = 0.4 → 400. B ratio = 0.6 → 600.
  assertClose(r.A.chargesTotal, 400, "A");
  assertClose(r.B.chargesTotal, 600, "B");
  const sums = sumPersonTotals(s);
  assertClose(sums.tot, 21000, "sum");
});

// --- S10: fixed charge, per_person distribution (split equally) ---
scenario("S10 · fixed charge, per_person", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 8000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 12000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "c1", name: "Servicio", value: 1000, valueType: "fixed", isDiscount: false, distribution: "per_person" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // 1000 split among 2 = 500 each.
  assertClose(r.A.chargesTotal, 500, "A");
  assertClose(r.B.chargesTotal, 500, "B");
});

// --- S11: fixed charge, fixed_per_person (each pays full amount) ---
scenario("S11 · fixed charge, fixed_per_person", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 8000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 12000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "c1", name: "Cubierto fijo", value: 1500, valueType: "fixed", isDiscount: false, distribution: "fixed_per_person" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // Each pays 1500.
  assertClose(r.A.chargesTotal, 1500, "A");
  assertClose(r.B.chargesTotal, 1500, "B");
});

// --- S12: discount (negative charge) ---
scenario("S12 · discount (10% off, proportional)", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 10000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 10000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "c1", name: "Desc app", value: 10, valueType: "percent", isDiscount: true, distribution: "proportional" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // Total 20000, descuento 2000, A y B 1000 cada uno (50/50).
  assertClose(r.A.chargesTotal, -1000, "A discount");
  assertClose(r.B.chargesTotal, -1000, "B discount");
  assertClose(r.A.total, 9000, "A total");
  assertClose(r.B.total, 9000, "B total");
});

// --- S13a: multiple charges, cubierto = fixed_per_person (cada uno paga 2000) ---
scenario("S13a · propina 10% + cubierto 2000 (fixed_per_person) + descuento 5%", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 10000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 10000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "tip", name: "Propina", value: 10, valueType: "percent", isDiscount: false, distribution: "proportional" },
      { id: "cub", name: "Cubierto", value: 2000, valueType: "fixed", isDiscount: false, distribution: "fixed_per_person" },
      { id: "dsc", name: "Desc", value: 5, valueType: "percent", isDiscount: true, distribution: "proportional" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // A: subtotal 10000 → propina 1000, cubierto 2000, desc -500. Net +2500. Total 12500.
  assertClose(r.A.chargesTotal, 2500, "A charges");
  assertClose(r.A.total, 12500, "A total");
  const sums = sumPersonTotals(s);
  // Sum: 20000 (items) + 2000 (tip) + 4000 (cubierto x2 personas) - 1000 (desc) = 25000.
  assertClose(sums.tot, 25000, "sum totals");
});

// --- S13b: same combo but cubierto as per_person (split 2000 between 2 = 1000 c/u) ---
scenario("S13b · propina 10% + cubierto 2000 (per_person, dividido) + descuento 5%", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 10000, quantity: 1 },
    { id: "i2", name: "Plato B", price: 10000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
    },
    charges: [
      { id: "tip", name: "Propina", value: 10, valueType: "percent", isDiscount: false, distribution: "proportional" },
      { id: "cub", name: "Cubierto", value: 2000, valueType: "fixed", isDiscount: false, distribution: "per_person" },
      { id: "dsc", name: "Desc", value: 5, valueType: "percent", isDiscount: true, distribution: "proportional" },
    ],
    participants: [A, B],
  });
  const r = computeAll(s);
  // A: 10000 + 1000 (tip) + 1000 (cubierto/2) - 500 (desc) = 11500.
  assertClose(r.A.total, 11500, "A total");
  const sums = sumPersonTotals(s);
  // Sum: 20000 + 2000 + 2000 - 1000 = 23000.
  assertClose(sums.tot, 23000, "sum totals");
});

// --- S14: unit-specific assignment (_unit_N IDs) ---
scenario("S14 · unit-specific assignment shared by 2", () => {
  const items: Item[] = [
    { id: "i1", name: "Botella vino", price: 18000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    // Imagine the user split unit 0 of i1 among 2 people via the _unit_0 mechanism.
    assignments: {
      "i1_unit_0": [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
      ],
    },
    participants: [A, B],
  });
  const r = computeAll(s);
  // 18000 / 2 sharers = 9000 each.
  assertClose(r.A.subtotal, 9000, "A");
  assertClose(r.B.subtotal, 9000, "B");
});

// --- S15: replicate the user's actual Sakura sushi bill ---
scenario("S15 · Sakura sushi bill (Lu+Diego split Alt+F4 1+2)", () => {
  const items: Item[] = [
    { id: "item_0", name: "Alt+F4", price: 4300, quantity: 1, mode: "individual" },
    { id: "item_0_e1_db57a4", name: "Alt+F4", price: 4900, quantity: 3, mode: "individual" },
    { id: "item_1", name: "Kolsch", price: 4900, quantity: 1, mode: "individual" },
    { id: "item_2", name: "Gianluigi vegano", price: 6000, quantity: 1, mode: "individual" },
    { id: "item_3", name: "CON papas fritas", price: 1500, quantity: 2, mode: "individual" },
    { id: "item_4", name: "Gianluigi carne", price: 5500, quantity: 1, mode: "individual" },
    { id: "item_5", name: "Apicdate de mi DOBLE", price: 13400, quantity: 1, mode: "individual" },
  ];
  const Gon: Participant = { id: "0b657666", name: "Gon" };
  const Lu: Participant = { id: "7e294fbe", name: "Lu" };
  const Diego: Participant = { id: "078c4601", name: "Diego" };
  const s = makeSession({
    items,
    assignments: {
      item_0: [{ participant_id: "7e294fbe", quantity: 1 }],
      item_0_e1_db57a4: [
        { participant_id: "7e294fbe", quantity: 1 },
        { participant_id: "078c4601", quantity: 2 },
      ],
      item_1: [{ participant_id: "0b657666", quantity: 1 }],
      item_2: [{ participant_id: "7e294fbe", quantity: 1 }],
      item_3: [
        { participant_id: "7e294fbe", quantity: 1 },
        { participant_id: "078c4601", quantity: 1 },
      ],
      item_4: [{ participant_id: "078c4601", quantity: 1 }],
      item_5: [{ participant_id: "0b657666", quantity: 1 }],
    },
    charges: [
      { id: "charge_0", name: "PROPINA SUGERIDA 10", value: 10, valueType: "percent", isDiscount: false, distribution: "proportional" },
    ],
    participants: [Gon, Lu, Diego],
  });
  const r = computeAll(s);

  // Per-person expected:
  //   Gon  = 4900 (Kolsch) + 13400 (Apicdate) = 18300, +10% = 20130
  //   Lu   = 4300 (item_0) + 4900 (1 of e1) + 6000 (vegano) + 1500 (papas) = 16700, +10% = 18370
  //   Diego = 9800 (2 of e1) + 1500 (papas) + 5500 (carne) = 16800, +10% = 18480
  assertClose(r["0b657666"].subtotal, 18300, "Gon subtotal");
  assertClose(r["7e294fbe"].subtotal, 16700, "Lu subtotal");
  assertClose(r["078c4601"].subtotal, 16800, "Diego subtotal");

  assertClose(r["0b657666"].total, 20130, "Gon total");
  assertClose(r["7e294fbe"].total, 18370, "Lu total");
  assertClose(r["078c4601"].total, 18480, "Diego total");

  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 51800, "sum subtotals == 51800 (suma de items)");
  assertClose(sums.tot, 56980, "sum totals == 56980 (boleta total)");
});

// --- S16: invariant — total assigned equals sum of items when all assigned ---
scenario("S16 · invariant: totalAssigned == totalItems when fully assigned", () => {
  const items: Item[] = [
    { id: "i1", name: "A", price: 1000, quantity: 2 },
    { id: "i2", name: "B", price: 500, quantity: 4 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 2 }],
      i2: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 3 },
      ],
    },
    participants: [A, B],
  });
  const totalItems = calculateTotalItems(items);
  const totalAssigned = calculateTotalAssigned(s);
  assertClose(totalAssigned, totalItems, "totalAssigned == totalItems");
  assertClose(totalItems, 4000, "totalItems == 4000");
});

// --- S17: partial assignment doesn't double-count or leak ---
scenario("S17 · partial assignment: 2 of 3 units assigned", () => {
  const items: Item[] = [{ id: "i1", name: "X", price: 1000, quantity: 3 }];
  const s = makeSession({
    items,
    assignments: { i1: [{ participant_id: "A", quantity: 2 }] },
    participants: [A, B],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 2000, "A: 2 units");
  assertClose(r.B.subtotal, 0, "B: nothing");
  // Note: 1 unit unassigned ($1000 missing). Engine doesn't pretend it's there.
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 2000, "sum reflects only what was assigned");
});

// --- S18: charges with no items assigned (edge case) ---
scenario("S18 · charge with no items: equal split fallback", () => {
  const s = makeSession({
    items: [{ id: "i1", name: "X", price: 1000, quantity: 1 }],
    assignments: {},
    charges: [
      { id: "c1", name: "Servicio", value: 600, valueType: "fixed", isDiscount: false, distribution: "proportional" },
    ],
    participants: [A, B, C],
  });
  const r = computeAll(s);
  // No assigned items → ratio = 1/numParticipants. So each pays 600/3 = 200.
  assertClose(r.A.chargesTotal, 200, "A");
  assertClose(r.B.chargesTotal, 200, "B");
  assertClose(r.C.chargesTotal, 200, "C");
});

// ============================================================================
// Extra scenarios (variedad de N participantes, qty altas, modos mixtos)
// ============================================================================

const D: Participant = { id: "D", name: "Diana" };
const E: Participant = { id: "E", name: "Eli" };

// --- S19: 4 participantes, items distintos sin sharing ---
scenario("S19 · 4 participantes, sin sharing", () => {
  const items: Item[] = [
    { id: "i1", name: "P1", price: 5000, quantity: 1 },
    { id: "i2", name: "P2", price: 7000, quantity: 1 },
    { id: "i3", name: "P3", price: 9000, quantity: 1 },
    { id: "i4", name: "P4", price: 11000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [{ participant_id: "B", quantity: 1 }],
      i3: [{ participant_id: "C", quantity: 1 }],
      i4: [{ participant_id: "D", quantity: 1 }],
    },
    participants: [A, B, C, D],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 5000, "A");
  assertClose(r.D.subtotal, 11000, "D");
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 32000, "sum");
});

// --- S20: 5 personas comparten qty=10 con cantidades muy desiguales ---
scenario("S20 · 5 personas reparten qty=10 (1+1+2+3+3) individual", () => {
  const items: Item[] = [
    { id: "i1", name: "Cerveza", price: 3500, quantity: 10, mode: "individual" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 2 },
        { participant_id: "D", quantity: 3 },
        { participant_id: "E", quantity: 3 },
      ],
    },
    participants: [A, B, C, D, E],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 3500, "A: 1");
  assertClose(r.B.subtotal, 3500, "B: 1");
  assertClose(r.C.subtotal, 7000, "C: 2");
  assertClose(r.D.subtotal, 10500, "D: 3");
  assertClose(r.E.subtotal, 10500, "E: 3");
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 35000, "sum == 10*3500");
});

// --- S21: grupal compartido entre TODOS (4 personas) ---
scenario("S21 · grupal qty=1 compartido por 4", () => {
  const items: Item[] = [
    { id: "i1", name: "Pizza familiar", price: 18000, quantity: 1, mode: "grupal" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 1 },
        { participant_id: "D", quantity: 1 },
      ],
    },
    participants: [A, B, C, D],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 4500, "A: 18000/4");
  assertClose(r.B.subtotal, 4500, "B");
  assertClose(r.C.subtotal, 4500, "C");
  assertClose(r.D.subtotal, 4500, "D");
});

// --- S22: per-unit shared by 3 ---
scenario("S22 · _unit_N compartido por 3", () => {
  const items: Item[] = [
    { id: "i1", name: "Botellón", price: 30000, quantity: 1 },
  ];
  const s = makeSession({
    items,
    assignments: {
      "i1_unit_0": [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 1 },
      ],
    },
    participants: [A, B, C],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 10000, "A: 30000/3");
  assertClose(r.B.subtotal, 10000, "B");
  assertClose(r.C.subtotal, 10000, "C");
});

// --- S23: per-unit con DOS units distintas, cada una compartida diferente ---
scenario("S23 · 2 unidades, cada una compartida con personas distintas", () => {
  const items: Item[] = [
    { id: "i1", name: "Cerveza grande", price: 6000, quantity: 2 },
  ];
  const s = makeSession({
    items,
    assignments: {
      "i1_unit_0": [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
      ],
      "i1_unit_1": [
        { participant_id: "C", quantity: 1 },
      ],
    },
    participants: [A, B, C],
  });
  const r = computeAll(s);
  assertClose(r.A.subtotal, 3000, "A: unit0/2");
  assertClose(r.B.subtotal, 3000, "B: unit0/2");
  assertClose(r.C.subtotal, 6000, "C: unit1 entera");
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 12000, "sum == 2 unidades × 6000");
});

// --- S24: mezcla individual + grupal en la misma boleta ---
scenario("S24 · mezcla individual + grupal", () => {
  const items: Item[] = [
    { id: "i1", name: "Plato A", price: 8000, quantity: 1, mode: "individual" },
    { id: "i2", name: "Postre compartido", price: 6000, quantity: 1, mode: "grupal" },
    { id: "i3", name: "Cervezas", price: 3000, quantity: 4, mode: "individual" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 1 }],
      i2: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
      ],
      i3: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 3 },
      ],
    },
    participants: [A, B],
  });
  const r = computeAll(s);
  // A: 8000 (plato) + 3000 (postre/2) + 3000 (1 cerveza) = 14000
  // B: 0 + 3000 (postre/2) + 9000 (3 cervezas) = 12000
  assertClose(r.A.subtotal, 14000, "A");
  assertClose(r.B.subtotal, 12000, "B");
  const sums = sumPersonTotals(s);
  assertClose(sums.sub, 26000, "sum == 8000 + 6000 + 12000");
});

// --- S25: mismo item asignado al MISMO participante via base Y _unit_N (no debe doble-contar) ---
scenario("S25 · item con asignación base + unit, no doble-conteo", () => {
  const items: Item[] = [
    { id: "i1", name: "Botella", price: 10000, quantity: 2 },
  ];
  // Hay asignación a la unidad 0; debe ignorar la asignación base de i1.
  const s = makeSession({
    items,
    assignments: {
      i1: [{ participant_id: "A", quantity: 2 }],   // ESTA debe ignorarse
      "i1_unit_0": [{ participant_id: "B", quantity: 1 }],
    },
    participants: [A, B],
  });
  const r = computeAll(s);
  // Solo cuenta la asignación de unit_0.
  assertClose(r.A.subtotal, 0, "A: la base se ignora");
  assertClose(r.B.subtotal, 10000, "B: 1 unidad completa");
});

// --- S26: 6 personas con cargos múltiples, todos los modos ---
scenario("S26 · 6 personas, propina + cubierto fijo + descuento", () => {
  const F: Participant = { id: "F", name: "Fer" };
  const items: Item[] = [
    { id: "i1", name: "Plato", price: 10000, quantity: 6, mode: "individual" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 1 },
        { participant_id: "D", quantity: 1 },
        { participant_id: "E", quantity: 1 },
        { participant_id: "F", quantity: 1 },
      ],
    },
    charges: [
      { id: "tip", name: "Propina", value: 10, valueType: "percent", isDiscount: false, distribution: "proportional" },
      { id: "cub", name: "Cubierto", value: 1500, valueType: "fixed", isDiscount: false, distribution: "fixed_per_person" },
      { id: "dsc", name: "Promo", value: 6000, valueType: "fixed", isDiscount: true, distribution: "per_person" },
    ],
    participants: [A, B, C, D, E, F],
  });
  const r = computeAll(s);
  // Cada uno: 10000 + 1000 (tip 10%) + 1500 (cubierto fijo) - 1000 (promo 6000/6) = 11500.
  for (const p of ["A", "B", "C", "D", "E", "F"]) {
    assertClose(r[p].total, 11500, `${p} total`);
  }
  const sums = sumPersonTotals(s);
  assertClose(sums.tot, 69000, "sum == 60000 + 6000 (tip) + 9000 (cubierto x6) - 6000 (promo)");
});

// --- S27: invariante general — sum(totals) == subtotal + sum_charges ---
scenario("S27 · invariante general en escenario complejo", () => {
  const items: Item[] = [
    { id: "i1", name: "X", price: 1234, quantity: 5, mode: "individual" },
    { id: "i2", name: "Y", price: 5678, quantity: 1, mode: "grupal" },
  ];
  const s = makeSession({
    items,
    assignments: {
      i1: [
        { participant_id: "A", quantity: 2 },
        { participant_id: "B", quantity: 3 },
      ],
      i2: [
        { participant_id: "A", quantity: 1 },
        { participant_id: "B", quantity: 1 },
        { participant_id: "C", quantity: 1 },
      ],
    },
    charges: [
      { id: "t", name: "Tip", value: 7, valueType: "percent", isDiscount: false, distribution: "proportional" },
    ],
    participants: [A, B, C],
  });
  const sums = sumPersonTotals(s);
  // expected subtotal: i1 (5*1234=6170) + i2 (5678) = 11848
  // expected charges: 7% × 11848 = 829.36
  // expected total: 12677.36
  assertClose(sums.sub, 11848, "sum subtotal == sum items");
  assertClose(sums.tot, 12677.36, "sum total == subtotal + 7%");
});

// ============================================================================
// Summary
// ============================================================================
console.log(`\n=== Result: ${passes} passed, ${failures} failed ===\n`);
if (failures > 0) {
  console.log("Failed scenarios:");
  for (const n of failedScenarios) console.log(`  - ${n}`);
  process.exit(1);
}
