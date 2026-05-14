"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, ChevronDown, ChevronRight, Camera, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepGateModal, type StepGateChecklistItem } from "@/components/ui/StepGateModal";
import { formatCurrency, formatNumber, parseFlexibleNumber, detectDecimals, type Item, type Charge } from "@/lib/billEngine";
import { playCelebrationSound } from "@/lib/sounds";

interface InlineInputProps {
  type: "text" | "number";
  value: string | number;
  onSave: (value: string | number) => void;
  className?: string;
  placeholder?: string;
  decimals?: number;  // For consistent decimal formatting
}

// Numeric input that holds a local value while focused to avoid the
// thousand-separator formatter fighting the user's keystrokes. Commits
// on blur or Enter.
function PriceInput({
  value,
  decimals,
  onSave,
}: {
  value: number;
  decimals: number;
  onSave: (val: number) => void;
}) {
  const [localVal, setLocalVal] = useState(formatNumber(value, decimals));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setLocalVal(formatNumber(value, decimals));
  }, [value, decimals, isFocused]);

  const commit = () => {
    setIsFocused(false);
    const num = parseFlexibleNumber(localVal);
    if (!isNaN(num)) {
      const clamped = Math.max(0, num);
      if (clamped !== value) onSave(clamped);
    } else {
      setLocalVal(formatNumber(value, decimals));
    }
  };

  return (
    <input
      type="text"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onFocus={() => {
        setIsFocused(true);
        // Show raw value on focus so the user can edit without fighting
        // the formatter. Empty string when value is 0 to avoid leading 0.
        setLocalVal(value === 0 ? "" : String(value));
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

function InlineInput({ type, value, onSave, className = "", placeholder, decimals = 0 }: InlineInputProps) {
  const [localVal, setLocalVal] = useState(String(value ?? ""));
  const [isFocused, setIsFocused] = useState(false);

  // Update local value when prop changes (from server sync)
  useEffect(() => {
    if (!isFocused) {
      setLocalVal(String(value ?? ""));
    }
  }, [value, isFocused]);

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = type === "number"
      ? (parseFlexibleNumber(localVal) || 0)
      : (localVal.trim() || "Item");
    if (parsed !== value) {
      onSave(parsed);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    // Show raw number when focused for easy editing
    if (type === "number") {
      setLocalVal(String(value ?? ""));
    }
  };

  // Display formatted when not focused, raw when focused
  const displayValue = !isFocused && type === "number"
    ? formatNumber(Number(value) || 0, decimals)
    : localVal;

  return (
    <input
      type="text"
      inputMode={type === "number" ? "decimal" : "text"}
      value={displayValue}
      className={`inline-edit ${className}`}
      onChange={(e) => setLocalVal(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      placeholder={placeholder}
    />
  );
}

interface StepReviewProps {
  items: Item[];
  charges: Charge[];
  originalSubtotal?: number;
  originalTotal?: number;
  // Cuando true, los precios de items ya incluyen los cargos referenciados
  // (típico boleta UE/LATAM con IVA incluido). En ese caso ocultamos del
  // listado los cargos `included_in_items`, escondemos la fila "Subtotal"
  // (porque sería confusa: items_sum != subtotal_impreso pre-tax) y solo
  // evaluamos el match del total para el gate modal.
  itemsIncludeCharges?: boolean;
  priceMode?: "unitario" | "total_linea";
  onOriginalSubtotalChange?: (value: number) => void;
  onOriginalTotalChange?: (value: number) => void;
  onItemsChange: (items: Item[]) => void;
  onChargesChange: (charges: Charge[]) => void;
  onNext: () => void;
  t: (key: string) => string;
  billName?: string;
  onBillNameChange?: (name: string) => void;
  onRescan?: () => void;
  onRegroup?: (mode: "group" | "expand") => Promise<boolean | void> | boolean | void;
  // Optional override — see StepAssign for the rationale.
  decimals?: number;
}

export function StepReview({
  items,
  charges,
  originalSubtotal,
  originalTotal,
  itemsIncludeCharges = false,
  priceMode = "unitario",
  onOriginalSubtotalChange,
  onOriginalTotalChange,
  onItemsChange,
  onChargesChange,
  onNext,
  t,
  billName,
  onBillNameChange,
  onRescan,
  onRegroup,
  decimals: decimalsProp,
}: StepReviewProps) {
  const [expandedCharge, setExpandedCharge] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  // "Agrupar items" toggle. Default ON: items are merged by (name, price).
  // OFF: each unit shown as its own row, in receipt order, at unit price.
  const [grouped, setGrouped] = useState(true);
  const [regrouping, setRegrouping] = useState(false);
  // Persistent step-gate modal state.
  // closed  = no modal showing
  // success = totals match: summary + Avanzar
  // error   = totals do not match: diagnostic + Volver a editar
  const [gateState, setGateState] = useState<"closed" | "success" | "error">("closed");
  // Snackbar state for undo after item delete (Rec 4).
  const [lastDeleted, setLastDeleted] = useState<{ item: Item; index: number } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMatchRef = useRef<boolean | null>(null);
  const initialEvaluationRef = useRef(false);
  // Tracks whether the user has dismissed the gate modal for the current
  // match state. Reset only when totals flip mismatch → match (re-celebration).
  const gateAcknowledgedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clear selection when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditingItemId(null);
        setExpandedCharge(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle back button to clear selection instead of navigating away
  const selectionStateRef = useRef<boolean>(false);

  useEffect(() => {
    const hasSelection = editingItemId !== null || expandedCharge !== null;

    // Push history state when selection opens (only once)
    if (hasSelection && !selectionStateRef.current) {
      window.history.pushState({ selectionOpen: true }, "");
      selectionStateRef.current = true;
    } else if (!hasSelection && selectionStateRef.current) {
      selectionStateRef.current = false;
    }
  }, [editingItemId, expandedCharge]);

  useEffect(() => {
    const handlePopState = () => {
      if (selectionStateRef.current) {
        setEditingItemId(null);
        setExpandedCharge(null);
        selectionStateRef.current = false;
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Los cargos `included_in_items` se MUESTRAN en la lista (transparencia para
  // el usuario: "esta boleta tenía IVA 21% incluido"), pero NO suman al total
  // (sus montos ya están dentro de items.price — sumarlos sería doble conteo).
  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0);

  const chargesAmount = charges.reduce((sum, charge) => {
    if (charge.included_in_items) return sum; // ya está dentro de items
    if (charge.is_suggested) return sum; // sugerencia, no cobrado
    const amount = charge.valueType === "percent"
      ? (subtotal * charge.value) / 100
      : charge.value;
    return sum + (charge.isDiscount ? -amount : amount);
  }, 0);

  const total = subtotal + chargesAmount;

  // Match logic. Replicamos R1 del backend en el frontend:
  // - Si hay tax incluido en items, originalSubtotal del backend es pre-tax
  //   (no coincide con sum(items) que ya tiene tax adentro).
  // - Si hay descuentos globales, distinguimos dos casos:
  //   (a) POST-subtotal (la mayoría): la boleta muestra Subtotal = items_sum
  //       y el descuento se aplica después. items_sum ≈ originalSubtotal.
  //   (b) PRE-subtotal (edge case): la boleta muestra Subtotal = items_sum −
  //       descuento. items_sum − descuentos ≈ originalSubtotal.
  //   Cuando es (b) mostramos una segunda fila "Subtotal con descuento" y la
  //   comparamos con originalSubtotal en lugar del items_sum directo.
  const discountsAmount = charges.reduce((sum, c) => {
    if (!c.isDiscount) return sum;
    const amt = c.valueType === "percent" ? (subtotal * c.value) / 100 : c.value;
    return sum + amt;
  }, 0);
  const subtotalAfterDiscounts = subtotal - discountsAmount;
  const subtotalRawMatches = originalSubtotal !== undefined && originalSubtotal > 0
    && Math.abs(subtotal - originalSubtotal) < 1;
  const subtotalAfterDiscMatches = originalSubtotal !== undefined && originalSubtotal > 0
    && Math.abs(subtotalAfterDiscounts - originalSubtotal) < 1;
  // Pre-subtotal: items_sum no cuadra pero items_sum−desc sí. Solo aplica
  // si efectivamente hay descuentos visibles (no included_in_items).
  const discountIsPreSubtotal = discountsAmount > 0 && !subtotalRawMatches && subtotalAfterDiscMatches;
  const subtotalMatches = subtotalRawMatches || subtotalAfterDiscMatches;
  const totalMatches = originalTotal !== undefined && originalTotal > 0 && Math.abs(total - originalTotal) < 1;
  const hasVerificationData = itemsIncludeCharges
    ? (originalTotal !== undefined && originalTotal > 0)
    : (originalSubtotal !== undefined && originalSubtotal > 0) || (originalTotal !== undefined && originalTotal > 0);
  // Match: solo exigir los valores que la boleta efectivamente imprimió.
  // - Si la boleta no tiene subtotal, no lo exigimos en el match.
  // - Si la boleta no tiene total, idem.
  // - Si tiene ambos, ambos deben matchear.
  const subRequired = originalSubtotal !== undefined && originalSubtotal > 0;
  const totRequired = originalTotal !== undefined && originalTotal > 0;
  const isMatch = itemsIncludeCharges
    ? totalMatches
    : (!subRequired || subtotalMatches) && (!totRequired || totalMatches);

  // Auto-open the gate modal once after the OCR result lands.
  // success when totals match, error when they do not. Skips when there
  // is no verification reference (no original subtotal/total scanned).
  // Wait until verification data is available before consuming the one-shot
  // ref — items can land before subtotal/total in the session payload.
  useEffect(() => {
    if (initialEvaluationRef.current) return;
    if (items.length === 0) return;
    if (!hasVerificationData) return;
    const tmr = setTimeout(() => {
      // Set the ref INSIDE the timer so that if React StrictMode (dev) does
      // mount → unmount → mount, the cleanup cancels this timer and the ref
      // is still false on remount, allowing the second run to re-schedule.
      if (initialEvaluationRef.current) return;
      initialEvaluationRef.current = true;
      if (isMatch) {
        setGateState("success");
        playCelebrationSound();
      } else {
        setGateState("error");
      }
      prevMatchRef.current = isMatch;
    }, 900);
    return () => clearTimeout(tmr);
  }, [items.length, hasVerificationData, isMatch]);

  // Re-celebrate when the user fixes a mismatch and totals match again.
  useEffect(() => {
    if (!initialEvaluationRef.current) return;
    if (isMatch && prevMatchRef.current === false && gateState === "closed") {
      gateAcknowledgedRef.current = false;
      setGateState("success");
      playCelebrationSound();
    }
    prevMatchRef.current = isMatch;
  }, [isMatch, gateState]);

  // Bottom Continuar button gate. If the user already dismissed the modal
  // for the current match state, just advance without re-opening it.
  const handleContinue = () => {
    if (!hasVerificationData) {
      onNext();
      return;
    }
    if (gateAcknowledgedRef.current) {
      onNext();
      return;
    }
    setGateState(isMatch ? "success" : "error");
  };

  // Item handlers
  const updateItem = (id: string, updates: Partial<Item>) => {
    onItemsChange(items.map((item) =>
      (item.id || item.name) === id ? { ...item, ...updates } : item
    ));
  };

  const deleteItem = (id: string) => {
    const idx = items.findIndex((it) => (it.id || it.name) === id);
    if (idx < 0) return;
    const removed = items[idx];
    onItemsChange(items.filter((_, i) => i !== idx));
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDeleted({ item: removed, index: idx });
    undoTimerRef.current = setTimeout(() => setLastDeleted(null), 5000);
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    const next = [...items];
    const insertAt = Math.min(lastDeleted.index, next.length);
    next.splice(insertAt, 0, lastDeleted.item);
    onItemsChange(next);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDeleted(null);
  };

  const addItem = () => {
    const newId = String(Date.now());
    const newItem: Item = {
      id: newId,
      name: t("items.newItem"),
      quantity: 1,
      price: 0,
    };
    onItemsChange([...items, newItem]);
    setEditingItemId(newId);
    setExpandedCharge(null);
  };

  // Charge handlers
  const addCharge = () => {
    const newId = String(Date.now());
    const newCharge: Charge = {
      id: newId,
      name: t("charges.charge"),
      value: 10,
      valueType: "percent",
      isDiscount: false,
      distribution: "proportional",
    };
    onChargesChange([...charges, newCharge]);
    setExpandedCharge(newId); // Auto-expand new charge
  };

  const updateCharge = (id: string, updates: Partial<Charge>) => {
    onChargesChange(charges.map((c) => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteCharge = (id: string) => {
    onChargesChange(charges.filter((c) => c.id !== id));
  };

  // Prefer explicit decimals from parent (which knows session.decimal_places),
  // fall back to item-level detection.
  const decimals = decimalsProp ?? detectDecimals(items);
  const fmt = (amount: number) => formatCurrency(amount, decimals);

  // Clear selections when clicking on background
  const handleBackgroundClick = (e: React.MouseEvent) => {
    // Only clear if clicking directly on the container, not on child elements
    if (e.target === e.currentTarget) {
      setEditingItemId(null);
      setExpandedCharge(null);
    }
  };

  return (
    <div className="step-animate" ref={containerRef} onClick={handleBackgroundClick}>
      {/* Bill Name Card */}
      {onBillNameChange && (
        <div className="bg-card rounded-2xl p-3.5 mb-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </div>
          <input
            type="text"
            value={billName || ""}
            onChange={(e) => onBillNameChange(e.target.value)}
            onBlur={(e) => onBillNameChange(e.target.value.trim())}
            placeholder={t("bills.billName")}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[0.9375rem] font-medium text-foreground placeholder:text-muted-foreground/40"
          />
          {billName && (
            <span className="text-[0.6875rem] text-muted-foreground/60 flex-shrink-0">
              {t("bills.fromOcr")}
            </span>
          )}
        </div>
      )}

      {/* Items Section - Gray Box */}
      <div className="bg-card rounded-2xl p-4 mb-4">
        {items.length === 0 ? (
          /* Empty state — Rec 4 */
          <div className="items-empty">
            <div className="items-empty-icon">
              <Camera className="w-5 h-5" />
            </div>
            <p className="items-empty-title">{t("items.empty.title")}</p>
            <p className="items-empty-sub">{t("items.empty.subtitle")}</p>
            {onRescan && (
              <Button size="lg" className="w-full h-11 mb-2" onClick={onRescan}>
                {t("items.empty.rescan")}
              </Button>
            )}
            <button className="add-row-btn" onClick={addItem}>
              <Plus className="w-4 h-4" />
              {t("items.empty.addManual")}
            </button>
          </div>
        ) : (
          <>
            {/* Group toggle — lets the user split each unit onto its own
                row to compare 1:1 with a non-deduplicated receipt. */}
            {onRegroup && (
              <div className="flex items-center justify-end gap-2 mb-3 px-1">
                <span className="text-xs text-muted-foreground">
                  {t("items.groupToggle")}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={grouped}
                  disabled={regrouping}
                  onClick={async () => {
                    const next = !grouped;
                    // Optimistic flip: move the toggle before awaiting
                    // the round-trip so the gesture feels instant. The
                    // disabled flag prevents a second click landing
                    // mid-flight; if the request fails we roll back.
                    setGrouped(next);
                    setEditingItemId(null);
                    setRegrouping(true);
                    try {
                      const ok = await onRegroup(next ? "group" : "expand");
                      if (ok === false) setGrouped(!next);
                    } catch {
                      setGrouped(!next);
                    } finally {
                      setRegrouping(false);
                    }
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    grouped ? "bg-primary" : "bg-muted"
                  } ${regrouping ? "opacity-60" : ""}`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      grouped ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            )}

            {items.map((item) => {
              const itemId = item.id || item.name;
              const qty = item.quantity || 1;
              const unitPrice = item.price || 0;
              const lineTotal = unitPrice * qty;
              // Display the literal value the receipt printed for this
              // line (price_as_shown) when bill-e captured it. Falls back
              // to the priceMode-based calculation for items added
              // manually or where the OCR didn't preserve the raw value.
              // This keeps the "as printed on the item line" helper text
              // accurate even when Gemini misclassifies precio_modo.
              const displayPrice =
                item.price_as_shown != null
                  ? item.price_as_shown
                  : priceMode === "total_linea"
                  ? lineTotal
                  : unitPrice;
              const isEditing = editingItemId === itemId;

              const handlePriceSave = (val: string | number) => {
                const newValue = Math.max(0, Number(val));
                // The user is editing the value as it appears on the
                // receipt line, so newValue IS the new price_as_shown.
                // The internal unit price is derived: divide by qty when
                // we know the line was a line total.
                const isLineTotal =
                  priceMode === "total_linea" ||
                  (item.price_as_shown != null && qty > 1 && item.price_as_shown !== unitPrice);
                const newUnitPrice = isLineTotal && qty > 0 ? newValue / qty : newValue;
                updateItem(itemId, { price: newUnitPrice, price_as_shown: newValue });
              };

              return (
                <div key={itemId}>
                  {/* Collapsed row — Rec 2: chip ×N + name + $ price */}
                  <div
                    className="item-row"
                    onClick={() => {
                      setEditingItemId(isEditing ? null : itemId);
                      setExpandedCharge(null);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span className="item-row-qty">×{qty}</span>
                      <span className="item-row-name">{item.name}</span>
                    </div>
                    <span className="item-row-price">
                      <span className="sym">$</span>
                      <span className="val">{formatNumber(displayPrice, decimals)}</span>
                    </span>
                  </div>

                  {/* Expanded editor — Rec 3 */}
                  {isEditing && (
                    <div className="item-editor" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        className="item-editor-name"
                        value={item.name}
                        onChange={(e) => updateItem(itemId, { name: e.target.value })}
                        placeholder={t("items.editorNamePlaceholder")}
                      />
                      <div className="item-editor-grid">
                        <span className="item-editor-label">{t("items.editorQuantity")}</span>
                        <div className="item-editor-stepper">
                          <button
                            type="button"
                            aria-label="−"
                            onClick={() => updateItem(itemId, { quantity: Math.max(1, qty - 1) })}
                          >−</button>
                          <span className="item-editor-stepper-value">{qty}</span>
                          <button
                            type="button"
                            aria-label="+"
                            onClick={() => updateItem(itemId, { quantity: qty + 1 })}
                          >+</button>
                        </div>

                        <span className="item-editor-label">{t("items.editorValue")}</span>
                        <div className="item-editor-price">
                          <span className="sym">$</span>
                          <PriceInput
                            value={displayPrice}
                            decimals={decimals}
                            onSave={handlePriceSave}
                          />
                        </div>

                        <p className="item-editor-helper">{t("items.editorValueHelper")}</p>
                      </div>
                      <div className="item-editor-actions">
                        <button
                          type="button"
                          className="item-editor-delete"
                          onClick={() => { deleteItem(itemId); setEditingItemId(null); }}
                        >
                          {t("items.deleteItem")}
                        </button>
                        <button
                          type="button"
                          className="item-editor-done"
                          onClick={() => setEditingItemId(null)}
                        >
                          {t("items.editorDone")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add Item Button — outline 44px (Rec 4-style) */}
            <button className="add-row-btn" onClick={addItem}>
              <Plus className="w-4 h-4" />
              {t("items.addManualItem")}
            </button>

{/* Subtotal — oculto cuando los items ya incluyen tax (sería confuso
                vs el subtotal pre-tax que viene de la boleta). */}
            {!itemsIncludeCharges && (
              <div className="breakdown-row subtotal" onClick={() => { setEditingItemId(null); setExpandedCharge(null); }}>
                <span>{t("totals.subtotal")}</span>
                <span>{fmt(subtotal)}</span>
              </div>
            )}
            {/* Subtotal post-descuento — solo cuando la boleta aplica el
                descuento ANTES del subtotal (edge case). Mostramos ambas
                filas: la base (items_sum) y la post-descuento, que es la
                que la boleta imprime. */}
            {!itemsIncludeCharges && discountIsPreSubtotal && (
              <div className="breakdown-row subtotal" onClick={() => { setEditingItemId(null); setExpandedCharge(null); }}>
                <span>{t("totals.subtotalAfterDiscount")}</span>
                <span>{fmt(subtotalAfterDiscounts)}</span>
              </div>
            )}
          </>
        )}

      </div>

      {/* Charges Section - Gray Box */}
      <div className="bg-card rounded-2xl p-4 mb-4">
        <div className="mb-2">
          <span className="text-xs text-foreground uppercase tracking-wide">{t("charges.sectionTitle")}</span>
        </div>

        {/* Charges. Los `included_in_items` se muestran como info (sin "+"
            ni edición, ya están dentro de los precios de items). */}
        {charges.map((charge) => {
          const amount = charge.valueType === "percent"
            ? (subtotal * charge.value) / 100
            : charge.value;
          const isExpanded = expandedCharge === charge.id;
          const isIncluded = !!charge.included_in_items;

          // Cargo "incluido en items" (ej. IVA UE): info pura, no editable
          // (su monto ya esta dentro de items.price). El badge informa al
          // usuario por que aparece pero no suma al total.
          if (isIncluded) {
            return (
              <div key={charge.id} className="breakdown-row charge opacity-60 cursor-default">
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">{charge.name}</span>
                  <span className="text-xs opacity-70 shrink-0">
                    ({charge.value}{charge.valueType === "percent" ? "%" : "$"} · {t("charges.includedInItems")})
                  </span>
                </span>
                <span className="font-medium shrink-0 ml-2">
                  {fmt(amount)}
                </span>
              </div>
            );
          }

          const isSuggested = !!charge.is_suggested;
          return (
            <div key={charge.id}>
              {/* Collapsed view - click to expand */}
              <button
                className={`breakdown-row charge w-full ${charge.isDiscount ? "discount" : ""}`}
                onClick={() => {
                  setExpandedCharge(isExpanded ? null : charge.id);
                  setEditingItemId(null); // Clear item selection when clicking charge
                }}
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  {isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                  <span className="truncate">{charge.name}</span>
                  <span className="text-xs opacity-70 shrink-0">
                    ({charge.value}{charge.valueType === "percent" ? "%" : "$"})
                  </span>
                </span>
                <span className="font-semibold shrink-0 ml-2">
                  {isSuggested ? "" : (charge.isDiscount ? "-" : "+")}{fmt(amount)}
                </span>
              </button>

              {/* Expanded options */}
              {isExpanded && (
                <div className="bg-card rounded-xl p-3 mb-2">
                  {/* Name + Value */}
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      value={charge.name}
                      onChange={(e) => updateCharge(charge.id, { name: e.target.value })}
                      className="flex-1 min-w-0 bg-background rounded-lg px-3 py-2 text-sm outline-none"
                      placeholder={t("charges.charge")}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={charge.value}
                      onChange={(e) => updateCharge(charge.id, { value: parseFlexibleNumber(e.target.value) || 0 })}
                      className="w-16 shrink-0 text-right bg-background rounded-lg px-3 py-2 text-sm outline-none"
                    />
                  </div>

                  {/* Type: % or $ */}
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => updateCharge(charge.id, { valueType: "percent" })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        charge.valueType === "percent" ? "bg-primary/20 text-primary" : "bg-background text-muted-foreground"
                      }`}
                    >
                      %
                    </button>
                    <button
                      onClick={() => updateCharge(charge.id, { valueType: "fixed" })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        charge.valueType === "fixed" ? "bg-primary/20 text-primary" : "bg-background text-muted-foreground"
                      }`}
                    >
                      $
                    </button>
                  </div>

                  {/* Charge or Discount */}
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => updateCharge(charge.id, { isDiscount: false })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        !charge.isDiscount ? "bg-primary/20 text-primary" : "bg-background text-muted-foreground"
                      }`}
                    >
                      +{t("charges.charge")}
                    </button>
                    <button
                      onClick={() => updateCharge(charge.id, { isDiscount: true })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        charge.isDiscount ? "bg-green-600/20 text-green-600" : "bg-background text-muted-foreground"
                      }`}
                    >
                      -{t("charges.discount")}
                    </button>
                  </div>

                  {/* Distribution - only show for fixed amounts */}
                  {charge.valueType === "fixed" && (
                    <div className="space-y-2 mb-3">
                      <p className="text-xs text-muted-foreground">{t("charges.howToSplit")}</p>
                      <div className="space-y-1">
                        <button
                          onClick={() => updateCharge(charge.id, { distribution: "proportional" })}
                          className={`w-full py-2 px-3 rounded-lg text-left transition-colors ${
                            charge.distribution === "proportional" ? "bg-primary/20" : "bg-background"
                          }`}
                        >
                          <span className={`text-sm font-medium ${charge.distribution === "proportional" ? "text-primary" : ""}`}>{t("charges.proportional")}</span>
                          <span className="block text-xs text-muted-foreground">{t("charges.proportionalDesc")}</span>
                        </button>
                        <button
                          onClick={() => updateCharge(charge.id, { distribution: "per_person" })}
                          className={`w-full py-2 px-3 rounded-lg text-left transition-colors ${
                            charge.distribution === "per_person" ? "bg-primary/20" : "bg-background"
                          }`}
                        >
                          <span className={`text-sm font-medium ${charge.distribution === "per_person" ? "text-primary" : ""}`}>{t("charges.perPerson")}</span>
                          <span className="block text-xs text-muted-foreground">{t("charges.perPersonDesc")}</span>
                        </button>
                        <button
                          onClick={() => updateCharge(charge.id, { distribution: "fixed_per_person" })}
                          className={`w-full py-2 px-3 rounded-lg text-left transition-colors ${
                            charge.distribution === "fixed_per_person" ? "bg-primary/20" : "bg-background"
                          }`}
                        >
                          <span className={`text-sm font-medium ${charge.distribution === "fixed_per_person" ? "text-primary" : ""}`}>{t("charges.splitEqual")}</span>
                          <span className="block text-xs text-muted-foreground">{t("charges.splitEqualDesc")}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delete */}
                  <button
                    onClick={() => {
                      deleteCharge(charge.id);
                      setExpandedCharge(null);
                    }}
                    className="w-full py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  >
                    {t("items.deleteItem")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Add Charge Button */}
        <button className="breakdown-add-btn" onClick={() => { addCharge(); setEditingItemId(null); }}>
          <Plus className="w-4 h-4" />
          {t("charges.addCharge")}
        </button>
      </div>

      {/* Verification — Rec 5 Versión 2: compact 2-col table comparing calc vs receipt */}
      {hasVerificationData && (
        <div className="rounded-2xl p-4 mb-4 bg-card">
          <div className="verify-table">
            <div className="head first"></div>
            <div className="head">{t("verify.calc")}</div>
            <div className="head">{t("verify.scanned")}</div>

            {!itemsIncludeCharges && originalSubtotal !== undefined && originalSubtotal > 0 && (
              <>
                <div className="row-label">
                  {subtotalMatches ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3"><polyline points="5 13 9 17 19 7"/></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="3"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  )}
                  <span>{discountIsPreSubtotal ? t("totals.subtotalAfterDiscount") : t("totals.subtotal")}</span>
                </div>
                <div className="row-val">{fmt(discountIsPreSubtotal ? subtotalAfterDiscounts : subtotal)}</div>
                <div className={`row-val editable ${subtotalMatches ? "" : "warn"}`}>
                  <PriceInput
                    value={originalSubtotal}
                    decimals={decimals}
                    onSave={(v) => onOriginalSubtotalChange?.(v)}
                  />
                </div>
              </>
            )}

            {originalTotal !== undefined && originalTotal > 0 && (
              <>
                <div className="row-label">
                  {totalMatches ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3"><polyline points="5 13 9 17 19 7"/></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="3"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  )}
                  <span>{t("totals.total")}</span>
                </div>
                <div className="row-val">{fmt(total)}</div>
                <div className={`row-val editable ${totalMatches ? "" : "warn"}`}>
                  <PriceInput
                    value={originalTotal}
                    decimals={decimals}
                    onSave={(v) => onOriginalTotalChange?.(v)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Total Final - Outside boxes, prominent */}
      <div className="flex items-center justify-between py-4 px-2">
        <span className="text-lg font-bold">{t("totals.total")}</span>
        <span className="text-2xl font-bold text-primary">{fmt(total)}</span>
      </div>

      {/* Next Button */}
      <div className="mt-8">
        <Button size="lg" className="w-full h-12 text-base font-semibold" onClick={handleContinue}>
          {t("steps.continue")}
        </Button>
      </div>

      {/* Persistent step-gate modal */}
      <StepGateModal
        open={gateState !== "closed"}
        mode={gateState === "error" ? "error" : "success"}
        celebration="subtle"
        title={gateState === "error" ? t("gate.review.errorTitle") : t("gate.review.successTitle")}
        subtitle={gateState === "error"
          ? buildErrorSubtitle({ subtotal, total, originalSubtotal, originalTotal, fmt, t })
          : t("gate.review.successSubtitle")}
        checklist={gateState === "success" ? buildSuccessChecklist({ items, subtotal, total, originalSubtotal, originalTotal, subtotalMatches, totalMatches, itemsIncludeCharges, fmt, t }) : undefined}
        compare={gateState === "error" ? buildCompareBlock({ subtotal, total, originalSubtotal, originalTotal, fmt, t }) : undefined}
        hintsHeader={gateState === "error" ? t("gate.review.hintsHeader") : undefined}
        hints={gateState === "error" ? [
          { text: t("gate.review.hint1") },
          { text: t("gate.review.hint2") },
          { text: t("gate.review.hint3") },
          { text: t("gate.review.hint4"), example: t("gate.review.hint4Example") },
          { text: t("gate.review.hint5"), example: t("gate.review.hint5Example") },
        ] : undefined}
        primaryLabel={gateState === "success" ? t("gate.review.primaryAdvance") : undefined}
        onPrimary={gateState === "success" ? () => { setGateState("closed"); onNext(); } : undefined}
        secondaryLabel={gateState === "error" ? t("gate.review.secondaryFix") : t("gate.review.secondaryKeepEditing")}
        onSecondary={() => {
          gateAcknowledgedRef.current = true;
          setGateState("closed");
        }}
      />

      {/* Undo snackbar — Rec 4 */}
      {lastDeleted && (
        <div className="undo-snackbar" role="status" aria-live="polite">
          <span>{t("items.deleted")}</span>
          <button onClick={undoDelete}>{t("items.undo")}</button>
        </div>
      )}
    </div>
  );
}

/** Show the diff for the worst-cased value (subtotal or total). */
function buildErrorSubtitle(args: {
  subtotal: number;
  total: number;
  originalSubtotal?: number;
  originalTotal?: number;
  fmt: (n: number) => string;
  t: (key: string) => string;
}): string {
  const { subtotal, total, originalSubtotal, originalTotal, fmt, t } = args;
  const subDiff = originalSubtotal !== undefined && originalSubtotal > 0 ? Math.abs(subtotal - originalSubtotal) : 0;
  const totDiff = originalTotal !== undefined && originalTotal > 0 ? Math.abs(total - originalTotal) : 0;
  const diff = totDiff > 0 ? totDiff : subDiff;
  return t("gate.review.errorSubtitle").replace("{diff}", fmt(diff));
}

/** Items / receipt / diff comparison block. Prefers totals when present. */
function buildCompareBlock(args: {
  subtotal: number;
  total: number;
  originalSubtotal?: number;
  originalTotal?: number;
  fmt: (n: number) => string;
  t: (key: string) => string;
}) {
  const { subtotal, total, originalSubtotal, originalTotal, fmt, t } = args;
  const useTotal = originalTotal !== undefined && originalTotal > 0;
  const a = useTotal ? total : subtotal;
  const b = useTotal ? (originalTotal as number) : (originalSubtotal ?? 0);
  const diff = Math.abs(a - b);
  return {
    rowA: { label: useTotal ? t("gate.review.compareItemsTotal") : t("gate.review.compareItemsSubtotal"), value: fmt(a) },
    rowB: { label: useTotal ? t("gate.review.compareReceiptTotal") : t("gate.review.compareReceiptSubtotal"), value: fmt(b) },
    diff: { label: t("gate.review.compareDiff"), value: fmt(diff) },
  };
}

/** Three confirmations shown in the success modal. */
function buildSuccessChecklist(args: {
  items: Item[];
  subtotal: number;
  total: number;
  originalSubtotal?: number;
  originalTotal?: number;
  subtotalMatches: boolean;
  totalMatches: boolean;
  itemsIncludeCharges?: boolean;
  fmt: (n: number) => string;
  t: (key: string) => string;
}): StepGateChecklistItem[] {
  const { items, subtotal, total, originalSubtotal, originalTotal, subtotalMatches, totalMatches, itemsIncludeCharges, fmt, t } = args;
  const list: StepGateChecklistItem[] = [];
  list.push({ ok: true, label: t("gate.review.itemsLabel").replace("{count}", String(items.length)), detail: fmt(subtotal) });
  // Si los items ya incluyen tax, omitimos el check de subtotal — el subtotal
  // pre-tax de la boleta no coincide con la suma de items y confunde al usuario.
  if (!itemsIncludeCharges && originalSubtotal !== undefined && originalSubtotal > 0) {
    list.push({ ok: subtotalMatches, label: t("gate.review.subtotalOk"), detail: fmt(subtotal) });
  }
  if (originalTotal !== undefined && originalTotal > 0) {
    list.push({ ok: totalMatches, label: t("gate.review.totalOk"), detail: fmt(total) });
  }
  return list;
}
