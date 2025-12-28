"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
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
  onItemsChange: (items: Item[]) => void;
  onChargesChange: (charges: Charge[]) => void;
  onNext: () => void;
  t: (key: string) => string;
}

export function StepReview({
  items,
  charges,
  onItemsChange,
  onChargesChange,
  onNext,
  t,
}: StepReviewProps) {
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
    const newCharge: Charge = {
      id: String(Date.now()),
      name: t("charges.charge"),
      value: 10,
      valueType: "percent",
      isDiscount: false,
      distribution: "proportional",
    };
    onChargesChange([...charges, newCharge]);
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
              <div className="relative">
                <InlineInput
                  type="number"
                  value={unitPrice}
                  className="edit-price"
                  onSave={(val) => updateItem(itemId, { price: Math.max(0, Number(val)) })}
                />
                <button
                  className="row-delete"
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

        {/* Subtotal */}
        <div className="breakdown-row subtotal">
          <span>{t("totals.subtotal")}</span>
          <span>{fmt(subtotal)}</span>
        </div>

        {/* Charges */}
        {charges.map((charge) => {
          const amount = charge.valueType === "percent"
            ? (subtotal * charge.value) / 100
            : charge.value;

          return (
            <div key={charge.id} className="bg-secondary/30 rounded-xl p-3 mb-2">
              {/* Row 1: Name + Value + Delete */}
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={charge.name}
                  onChange={(e) => updateCharge(charge.id, { name: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-medium outline-none"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={charge.value}
                    onChange={(e) => updateCharge(charge.id, { value: parseFloat(e.target.value) || 0 })}
                    className="w-16 text-right bg-background rounded-lg px-2 py-1 text-sm outline-none"
                  />
                  <button
                    onClick={() => updateCharge(charge.id, { valueType: charge.valueType === "percent" ? "fixed" : "percent" })}
                    className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      charge.valueType === "percent" ? "bg-primary text-white" : "bg-background"
                    }`}
                  >
                    %
                  </button>
                  <button
                    onClick={() => updateCharge(charge.id, { valueType: charge.valueType === "fixed" ? "percent" : "fixed" })}
                    className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      charge.valueType === "fixed" ? "bg-primary text-white" : "bg-background"
                    }`}
                  >
                    $
                  </button>
                </div>
                <button
                  onClick={() => deleteCharge(charge.id)}
                  className="text-destructive hover:bg-destructive/10 rounded-full w-6 h-6 flex items-center justify-center"
                >
                  ×
                </button>
              </div>

              {/* Row 2: Charge/Discount + Distribution */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => updateCharge(charge.id, { isDiscount: false })}
                  className={`px-2 py-1 rounded-lg ${!charge.isDiscount ? "bg-primary text-white" : "bg-background"}`}
                >
                  +{t("charges.charge")}
                </button>
                <button
                  onClick={() => updateCharge(charge.id, { isDiscount: true })}
                  className={`px-2 py-1 rounded-lg ${charge.isDiscount ? "bg-destructive text-white" : "bg-background"}`}
                >
                  -{t("charges.discount")}
                </button>
                <span className="text-muted-foreground mx-1">|</span>
                <button
                  onClick={() => updateCharge(charge.id, { distribution: "proportional" })}
                  className={`px-2 py-1 rounded-lg ${charge.distribution === "proportional" ? "bg-primary text-white" : "bg-background"}`}
                >
                  {t("charges.proportional")}
                </button>
                <button
                  onClick={() => updateCharge(charge.id, { distribution: "per_person" })}
                  className={`px-2 py-1 rounded-lg ${charge.distribution === "per_person" ? "bg-primary text-white" : "bg-background"}`}
                >
                  {t("charges.perPerson")}
                </button>
                <button
                  onClick={() => updateCharge(charge.id, { distribution: "fixed_per_person" })}
                  className={`px-2 py-1 rounded-lg ${charge.distribution === "fixed_per_person" ? "bg-primary text-white" : "bg-background"}`}
                >
                  {t("charges.splitEqual")}
                </button>
              </div>

              {/* Calculated amount */}
              <div className="text-right text-sm font-semibold mt-2">
                <span className={charge.isDiscount ? "text-destructive" : "text-primary"}>
                  {charge.isDiscount ? "-" : "+"}{fmt(amount)}
                </span>
              </div>
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
