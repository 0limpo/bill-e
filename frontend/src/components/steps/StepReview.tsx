"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, ChevronDown, ChevronRight, Camera, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepGateModal, type StepGateChecklistItem } from "@/components/ui/StepGateModal";
import { formatCurrency, formatNumber, detectDecimals, type Item, type Charge } from "@/lib/billEngine";
import { playCelebrationSound } from "@/lib/sounds";

interface InlineInputProps {
  type: "text" | "number";
  value: string | number;
  onSave: (value: string | number) => void;
  className?: string;
  placeholder?: string;
  decimals?: number;  // For consistent decimal formatting
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
      ? (parseFloat(localVal.replace(/[^\d.-]/g, "")) || 0)
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
}

export function StepReview({
  items,
  charges,
  originalSubtotal,
  originalTotal,
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
}: StepReviewProps) {
  const [expandedCharge, setExpandedCharge] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
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

  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0);

  const chargesAmount = charges.reduce((sum, charge) => {
    const amount = charge.valueType === "percent"
      ? (subtotal * charge.value) / 100
      : charge.value;
    return sum + (charge.isDiscount ? -amount : amount);
  }, 0);

  const total = subtotal + chargesAmount;

  // Check if values match for celebration
  const subtotalMatches = originalSubtotal !== undefined && originalSubtotal > 0 && Math.abs(subtotal - originalSubtotal) < 1;
  const totalMatches = originalTotal !== undefined && originalTotal > 0 && Math.abs(total - originalTotal) < 1;
  const hasVerificationData = (originalSubtotal !== undefined && originalSubtotal > 0) || (originalTotal !== undefined && originalTotal > 0);
  const isMatch = subtotalMatches && (originalTotal === undefined || originalTotal === 0 || totalMatches);

  // Auto-open the gate modal once after the OCR result lands.
  // success when totals match, error when they do not. Skips when there
  // is no verification reference (no original subtotal/total scanned).
  useEffect(() => {
    if (initialEvaluationRef.current) return;
    if (items.length === 0) return;
    initialEvaluationRef.current = true;
    const tmr = setTimeout(() => {
      if (hasVerificationData) {
        if (isMatch) {
          setGateState("success");
          playCelebrationSound();
        } else {
          setGateState("error");
        }
      }
      prevMatchRef.current = isMatch;
    }, 900);
    return () => clearTimeout(tmr);
  }, [items.length, hasVerificationData, isMatch]);

  // Re-celebrate when the user fixes a mismatch and totals match again.
  useEffect(() => {
    if (!initialEvaluationRef.current) return;
    if (isMatch && prevMatchRef.current === false && gateState === "closed") {
      setGateState("success");
      playCelebrationSound();
    }
    prevMatchRef.current = isMatch;
  }, [isMatch, gateState]);

  // Bottom Continuar button gate.
  const handleContinue = () => {
    if (!hasVerificationData) {
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

  // Detect decimals from items to match receipt format
  const decimals = detectDecimals(items);
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
            {items.map((item) => {
              const itemId = item.id || item.name;
              const qty = item.quantity || 1;
              const unitPrice = item.price || 0;
              const lineTotal = unitPrice * qty;
              // Display price reflects what bill-e detected from the receipt;
              // Rec 3: this is the "valor" the user verifies as-is (no calc).
              const displayPrice = priceMode === "total_linea" ? lineTotal : unitPrice;
              const isEditing = editingItemId === itemId;

              const handlePriceSave = (val: string | number) => {
                const newValue = Math.max(0, Number(val));
                if (priceMode === "total_linea") {
                  updateItem(itemId, { price: qty > 0 ? newValue / qty : newValue });
                } else {
                  updateItem(itemId, { price: newValue });
                }
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
                          <input
                            type="text"
                            inputMode={decimals > 0 ? "decimal" : "numeric"}
                            value={formatNumber(displayPrice, decimals)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
                              const num = parseFloat(raw);
                              if (!isNaN(num)) handlePriceSave(num);
                            }}
                          />
                        </div>

                        <p className="item-editor-helper">{t("items.editorValueHelper")}</p>
                      </div>
                      <button
                        type="button"
                        className="item-editor-delete"
                        onClick={() => { deleteItem(itemId); setEditingItemId(null); }}
                      >
                        {t("items.deleteItem")}
                      </button>
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

            {/* Subtotal */}
            <div className="breakdown-row subtotal" onClick={() => { setEditingItemId(null); setExpandedCharge(null); }}>
              <span>{t("totals.subtotal")}</span>
              <span>{fmt(subtotal)}</span>
            </div>
          </>
        )}

      </div>

      {/* Charges Section - Gray Box */}
      <div className="bg-card rounded-2xl p-4 mb-4">
        <div className="mb-2">
          <span className="text-xs text-foreground uppercase tracking-wide">{t("charges.sectionTitle")}</span>
        </div>

        {/* Charges */}
        {charges.map((charge) => {
          const amount = charge.valueType === "percent"
            ? (subtotal * charge.value) / 100
            : charge.value;
          const isExpanded = expandedCharge === charge.id;

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
                  {charge.isDiscount ? "-" : "+"}{fmt(amount)}
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
                      onChange={(e) => updateCharge(charge.id, { value: parseFloat(e.target.value) || 0 })}
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

            {originalSubtotal !== undefined && originalSubtotal > 0 && (
              <>
                <div className="row-label">
                  {subtotalMatches ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3"><polyline points="5 13 9 17 19 7"/></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="3"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  )}
                  <span>{t("totals.subtotal")}</span>
                </div>
                <div className="row-val">{fmt(subtotal)}</div>
                <div className={`row-val editable ${subtotalMatches ? "" : "warn"}`}>
                  <input
                    type="text"
                    inputMode={decimals > 0 ? "decimal" : "numeric"}
                    value={formatNumber(originalSubtotal, decimals)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
                      const num = parseFloat(raw);
                      if (!isNaN(num)) onOriginalSubtotalChange?.(Math.max(0, num));
                    }}
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
                  <input
                    type="text"
                    inputMode={decimals > 0 ? "decimal" : "numeric"}
                    value={formatNumber(originalTotal, decimals)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
                      const num = parseFloat(raw);
                      if (!isNaN(num)) onOriginalTotalChange?.(Math.max(0, num));
                    }}
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
        checklist={gateState === "success" ? buildSuccessChecklist({ items, subtotal, total, originalSubtotal, originalTotal, subtotalMatches, totalMatches, fmt, t }) : undefined}
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
        onSecondary={() => setGateState("closed")}
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
  fmt: (n: number) => string;
  t: (key: string) => string;
}): StepGateChecklistItem[] {
  const { items, subtotal, total, originalSubtotal, originalTotal, subtotalMatches, totalMatches, fmt, t } = args;
  const list: StepGateChecklistItem[] = [];
  list.push({ ok: true, label: t("gate.review.itemsLabel").replace("{count}", String(items.length)), detail: fmt(subtotal) });
  if (originalSubtotal !== undefined && originalSubtotal > 0) {
    list.push({ ok: subtotalMatches, label: t("gate.review.subtotalOk"), detail: fmt(subtotal) });
  }
  if (originalTotal !== undefined && originalTotal > 0) {
    list.push({ ok: totalMatches, label: t("gate.review.totalOk"), detail: fmt(total) });
  }
  return list;
}
