"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, type Item, type Charge } from "@/lib/billEngine";

interface InlineInputProps {
  type: "text" | "number";
  value: string | number;
  onSave: (value: string | number) => void;
  className?: string;
  placeholder?: string;
}

function InlineInput({ type, value, onSave, className = "", placeholder }: InlineInputProps) {
  const [localVal, setLocalVal] = useState(String(value ?? ""));

  const handleBlur = () => {
    const parsed = type === "number"
      ? (parseFloat(localVal) || 0)
      : (localVal.trim() || "Item");
    if (parsed !== value) {
      onSave(parsed);
    }
  };

  return (
    <input
      type={type}
      value={localVal}
      className={`inline-edit ${className}`}
      onChange={(e) => setLocalVal(e.target.value)}
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
      name: "Nuevo Cargo",
      value: 10,
      valueType: "percent",
      isDiscount: false,
    };
    onChargesChange([...charges, newCharge]);
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
            <div
              key={charge.id}
              className={`breakdown-row charge ${charge.isDiscount ? "discount" : ""}`}
            >
              <span className="flex items-center gap-2">
                {charge.name}
                {charge.valueType === "percent" && (
                  <span className="text-xs opacity-70">({charge.value}%)</span>
                )}
              </span>
              <span className="font-semibold">
                {charge.isDiscount ? "-" : "+"}
                {fmt(amount)}
              </span>
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
