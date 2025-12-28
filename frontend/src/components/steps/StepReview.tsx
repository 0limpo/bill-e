"use client";

import { useState, useEffect } from "react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber, type Item, type Charge } from "@/lib/billEngine";

interface InlineInputProps {
  type: "text" | "number";
  value: string | number;
  onSave: (value: string | number) => void;
  className?: string;
  placeholder?: string;
}

function InlineInput({ type, value, onSave, className = "", placeholder }: InlineInputProps) {
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
    ? formatNumber(Number(value) || 0)
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
  onItemsChange: (items: Item[]) => void;
  onChargesChange: (charges: Charge[]) => void;
  onNext: () => void;
  t: (key: string) => string;
}

export function StepReview({
  items,
  charges,
  originalSubtotal,
  onItemsChange,
  onChargesChange,
  onNext,
  t,
}: StepReviewProps) {
  const [expandedCharge, setExpandedCharge] = useState<string | null>(null);

  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0);

  const chargesAmount = charges.reduce((sum, charge) => {
    const amount = charge.valueType === "percent"
      ? (subtotal * charge.value) / 100
      : charge.value;
    return sum + (charge.isDiscount ? -amount : amount);
  }, 0);

  const total = subtotal + chargesAmount;

  // Item handlers
  const updateItem = (id: string, updates: Partial<Item>) => {
    onItemsChange(items.map((item) =>
      (item.id || item.name) === id ? { ...item, ...updates } : item
    ));
  };

  const deleteItem = (id: string) => {
    onItemsChange(items.filter((item) => (item.id || item.name) !== id));
  };

  const addItem = () => {
    const newItem: Item = {
      id: String(Date.now()),
      name: "Nuevo Item",
      quantity: 1,
      price: 0,
    };
    onItemsChange([...items, newItem]);
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

  const fmt = (amount: number) => formatCurrency(amount);

  return (
    <div className="step-animate">
      {/* Items List */}
      <div className="space-y-0">
        {items.map((item) => {
          const itemId = item.id || item.name;
          const qty = item.quantity || 1;
          const unitPrice = item.price || 0;

          return (
            <div key={itemId} className="breakdown-row group">
              {/* Left: Qty + Name */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <InlineInput
                  type="number"
                  value={qty}
                  className="edit-qty"
                  onSave={(val) => updateItem(itemId, { quantity: Math.max(1, Math.round(Number(val))) })}
                />
                <InlineInput
                  type="text"
                  value={item.name}
                  className="edit-name"
                  onSave={(val) => updateItem(itemId, { name: String(val) })}
                  placeholder="Nombre del item"
                />
              </div>

              {/* Right: Price + Delete */}
              <div className="flex items-center gap-2">
                <InlineInput
                  type="number"
                  value={unitPrice}
                  className="edit-price"
                  onSave={(val) => updateItem(itemId, { price: Math.max(0, Number(val)) })}
                />
                <button
                  className="w-6 h-6 hidden group-hover:flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  onClick={() => deleteItem(itemId)}
                  title={t("items.deleteItem")}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        {/* Add Item Button */}
        <button className="breakdown-add-btn" onClick={addItem}>
          <Plus className="w-4 h-4" />
          {t("items.addManualItem")}
        </button>

        {/* Subtotal with verification */}
        <div className="breakdown-row subtotal">
          <span>{t("totals.subtotal")}</span>
          <span>{fmt(subtotal)}</span>
        </div>

        {/* Verification indicator */}
        {originalSubtotal !== undefined && originalSubtotal > 0 && (
          Math.abs(subtotal - originalSubtotal) < 1 ? (
            <div className="flex items-center gap-2 py-2 px-3 bg-green-500/10 rounded-lg text-green-600 text-sm">
              <span className="text-base">✓</span>
              <span>{t("verify.match")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 bg-orange-500/10 rounded-lg text-orange-500 text-sm">
              <span className="text-base">≠</span>
              <span>{t("verify.mismatch")} ({fmt(originalSubtotal)})</span>
            </div>
          )
        )}

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
                onClick={() => setExpandedCharge(isExpanded ? null : charge.id)}
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
                <div className="bg-secondary/30 rounded-xl p-3 mb-2">
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
        <button className="breakdown-add-btn pt-2" onClick={addCharge}>
          <Plus className="w-4 h-4" />
          {t("charges.addCharge")}
        </button>

        {/* Total Final */}
        <div className="breakdown-row total-final">
          <span>{t("totals.total")}</span>
          <span className="text-primary">{fmt(total)}</span>
        </div>
      </div>

      {/* Next Button */}
      <div className="mt-8">
        <Button size="lg" className="w-full h-12 text-base font-semibold" onClick={onNext}>
          {t("steps.continue")}
        </Button>
      </div>
    </div>
  );
}
