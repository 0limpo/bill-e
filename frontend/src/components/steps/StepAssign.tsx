"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  getAvatarColor,
  getInitials,
  type Item,
  type Participant,
  type Assignment,
} from "@/lib/billEngine";

interface StepAssignProps {
  items: Item[];
  participants: Participant[];
  assignments: Record<string, Assignment[]>;
  onUpdateQty: (itemId: string, participantId: string, delta: number) => void;
  onBack: () => void;
  onNext: () => void;
  t: (key: string) => string;
  // New props for participant management
  isOwner?: boolean;
  showAddParticipant?: boolean;
  newParticipantName?: string;
  onNewParticipantNameChange?: (name: string) => void;
  onAddParticipant?: () => void;
  onToggleAddParticipant?: (show: boolean) => void;
  onRemoveParticipant?: (participantId: string) => void;
  addingParticipant?: boolean;
}

export function StepAssign({
  items,
  participants,
  assignments,
  onUpdateQty,
  onBack,
  onNext,
  t,
  isOwner = false,
  showAddParticipant = false,
  newParticipantName = "",
  onNewParticipantNameChange,
  onAddParticipant,
  onToggleAddParticipant,
  onRemoveParticipant,
  addingParticipant = false,
}: StepAssignProps) {
  const [itemModes, setItemModes] = useState<Record<string, "individual" | "grupal">>({});

  const fmt = (amount: number) => formatCurrency(amount);

  // Toggle mode for an item (local UI state only)
  const toggleMode = (itemId: string) => {
    const currentMode = itemModes[itemId] || "individual";
    const newMode = currentMode === "individual" ? "grupal" : "individual";
    setItemModes({ ...itemModes, [itemId]: newMode });
  };

  // Assign all participants to an item (1 unit each)
  const assignAll = (itemId: string) => {
    participants.forEach((p) => {
      const currentQty = (assignments[itemId] || []).find((a) => a.participant_id === p.id)?.quantity || 0;
      if (currentQty === 0) {
        onUpdateQty(itemId, p.id, 1);
      }
    });
  };

  // Get total assigned quantity for an item
  const getTotalAssigned = (itemId: string) => {
    return (assignments[itemId] || []).reduce((sum, a) => sum + (a.quantity || 0), 0);
  };

  return (
    <div className="step-animate">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">{t("steps.assignTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("steps.assignSubtitle")}</p>
      </div>

      {/* Participants Bar */}
      <div className="flex gap-3 overflow-x-auto pb-4 mb-6 scrollbar-hide items-start">
        {/* Add Participant Button (circle) - only for owner */}
        {isOwner && (
          <div className="flex flex-col items-center gap-1 min-w-14 shrink-0">
            {showAddParticipant ? (
              <div className="flex flex-col items-center gap-2">
                <input
                  type="text"
                  value={newParticipantName}
                  onChange={(e) => onNewParticipantNameChange?.(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onAddParticipant?.()}
                  placeholder={t("participants.name")}
                  className="w-24 px-2 py-1 text-xs bg-secondary rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                  disabled={addingParticipant}
                />
                <div className="flex gap-1">
                  <button
                    onClick={onAddParticipant}
                    disabled={!newParticipantName.trim() || addingParticipant}
                    className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-50"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onToggleAddParticipant?.(false)}
                    className="w-6 h-6 rounded-full bg-secondary text-muted-foreground flex items-center justify-center hover:bg-secondary/80"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => onToggleAddParticipant?.(true)}
                className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Participants */}
        {participants.map((p) => (
          <div key={p.id} className="participant-chip relative group shrink-0">
            <div
              className="participant-avatar"
              style={{ backgroundColor: getAvatarColor(p.name) }}
            >
              {getInitials(p.name)}
            </div>
            <span className="participant-name">{p.name}</span>

            {/* Delete button (only for owner, hidden on hover) */}
            {isOwner && onRemoveParticipant && (
              <button
                onClick={() => onRemoveParticipant(p.id)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Items List */}
      <div className="space-y-3">
        {items.map((item) => {
          const itemId = item.id || item.name;
          const itemQty = item.quantity || 1;
          const totalPrice = itemQty * (item.price || 0);
          const itemAssignments = assignments[itemId] || [];
          const mode = itemModes[itemId] || "individual";
          const totalAssigned = getTotalAssigned(itemId);
          const remaining = itemQty - totalAssigned;

          return (
            <div key={itemId} className="item-card">
              {/* Item Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="qty-badge">{itemQty}x</span>
                  <span className="font-medium">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {remaining > 0 && totalAssigned > 0 && (
                    <span className="text-xs text-warning">{remaining} sin asignar</span>
                  )}
                  <span className="font-semibold tabular-nums">{fmt(totalPrice)}</span>
                </div>
              </div>

              {/* Mode Toggle */}
              <div className="flex gap-2 mb-3">
                <button
                  className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-lg transition-colors ${
                    mode === "individual"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                  onClick={() => toggleMode(itemId)}
                >
                  {t("items.individual")}
                </button>
                <button
                  className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-lg transition-colors ${
                    mode === "grupal"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                  onClick={() => toggleMode(itemId)}
                >
                  {t("items.grupal")}
                </button>
              </div>

              {/* Quick Actions for Grupal */}
              {mode === "grupal" && (
                <button
                  className="w-full py-2 mb-3 text-xs font-medium text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
                  onClick={() => assignAll(itemId)}
                >
                  {t("items.allTogether")}
                </button>
              )}

              {/* Participants Assignment */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {participants.map((p) => {
                  const assign = itemAssignments.find((a) => a.participant_id === p.id);
                  const qty = assign?.quantity || 0;
                  const isAssigned = qty > 0;
                  const canAdd = remaining > 0 || mode === "grupal";

                  return (
                    <div key={p.id} className="flex flex-col items-center gap-1 min-w-14">
                      {/* Avatar with click to add */}
                      <button
                        className="relative"
                        onClick={() => canAdd && onUpdateQty(itemId, p.id, 1)}
                        disabled={!canAdd && !isAssigned}
                      >
                        <div
                          className={`participant-avatar ${isAssigned ? "selected" : canAdd ? "opacity-40" : "opacity-20"}`}
                          style={{ backgroundColor: getAvatarColor(p.name) }}
                        >
                          {getInitials(p.name)}
                        </div>
                        {/* Quantity badge */}
                        {qty > 0 && (
                          <span className="absolute -bottom-1 -right-1 min-w-5 h-5 px-1 bg-primary rounded-full flex items-center justify-center text-[11px] text-white font-bold">
                            {qty}
                          </span>
                        )}
                      </button>

                      {/* Minus button (only show when assigned) */}
                      {qty > 0 && (
                        <button
                          className="w-6 h-6 rounded-full bg-destructive/20 text-destructive flex items-center justify-center hover:bg-destructive/30 transition-colors"
                          onClick={() => onUpdateQty(itemId, p.id, -1)}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Buttons */}
      <div className="flex gap-3 mt-8">
        <Button variant="outline" size="lg" className="flex-1 h-12" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          {t("steps.back")}
        </Button>
        <Button size="lg" className="flex-1 h-12 font-semibold" onClick={onNext}>
          {t("steps.continue")}
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
