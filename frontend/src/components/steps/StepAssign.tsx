"use client";

import { useState, useEffect, useRef } from "react";
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
  const [showCelebration, setShowCelebration] = useState(false);
  const prevAllAssignedRef = useRef<boolean | null>(null);

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

  // Calculate total amounts for progress indicator
  const totalAmount = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0);
  const assignedAmount = items.reduce((sum, item) => {
    const itemId = item.id || item.name;
    const assignedQty = getTotalAssigned(itemId);
    return sum + assignedQty * (item.price || 0);
  }, 0);
  const remainingAmount = totalAmount - assignedAmount;
  const progressPercent = totalAmount > 0 ? (assignedAmount / totalAmount) * 100 : 0;
  const isAllAssigned = remainingAmount <= 0 && totalAmount > 0;

  // Trigger celebration when all items become assigned
  useEffect(() => {
    if (isAllAssigned && prevAllAssignedRef.current === false) {
      // Transitioned from not-assigned to all-assigned - show celebration
      setShowCelebration(true);
      const timer = setTimeout(() => setShowCelebration(false), 4500);
      return () => clearTimeout(timer);
    }
    prevAllAssignedRef.current = isAllAssigned;
  }, [isAllAssigned]);

  return (
    <div className="step-animate">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">{t("steps.assignTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("steps.assignSubtitle")}</p>
      </div>

      {/* Add Participant Input (expanded) */}
      {isOwner && showAddParticipant && (
        <div className="mb-4 p-3 bg-secondary/50 rounded-xl">
          <div className="flex gap-2">
            <input
              type="text"
              value={newParticipantName}
              onChange={(e) => onNewParticipantNameChange?.(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onAddParticipant?.()}
              placeholder={t("participants.name")}
              className="flex-1 px-4 py-3 bg-background rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary text-base"
              autoFocus
              disabled={addingParticipant}
            />
            <button
              onClick={onAddParticipant}
              disabled={!newParticipantName.trim() || addingParticipant}
              className="px-4 py-3 rounded-xl bg-primary text-white font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={() => onToggleAddParticipant?.(false)}
              className="px-3 py-3 rounded-xl bg-secondary text-muted-foreground hover:bg-secondary/80"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Participants Bar */}
      <div className="flex gap-3 overflow-x-auto pb-4 mb-6 scrollbar-hide items-start">
        {/* Add Participant Button (circle) - only for owner */}
        {isOwner && !showAddParticipant && (
          <div className="flex flex-col items-center gap-1 min-w-14 shrink-0">
            <button
              onClick={() => onToggleAddParticipant?.(true)}
              className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors border-2 border-dashed border-primary/30"
            >
              <Plus className="w-6 h-6" />
            </button>
            <span className="text-xs text-muted-foreground">{t("participants.addShort")}</span>
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

            {/* Delete button (only for owner, visible on hover) */}
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

      {/* Progress Indicator */}
      {!isAllAssigned && (
        <div className="mb-4 py-3 px-4 bg-secondary/50 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">{t("assign.remaining")}</span>
            <span className="font-semibold text-foreground">{fmt(remainingAmount)}</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Floating celebration overlay */}
      {showCelebration && (
        <div className="verify-overlay">
          <div className="verify-checkmark">
            <svg viewBox="0 0 52 52" className="w-24 h-24">
              <circle className="verify-circle" cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="2"/>
              <path className="verify-check" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M14 27l8 8 16-16"/>
            </svg>
            <p className="verify-message">{t("assign.allAssigned")}</p>
          </div>
        </div>
      )}

      {/* Items List */}
      <div className="divide-y divide-border/50">
        {items.map((item) => {
          const itemId = item.id || item.name;
          const itemQty = item.quantity || 1;
          const totalPrice = itemQty * (item.price || 0);
          const itemAssignments = assignments[itemId] || [];
          const mode = itemModes[itemId] || "individual";
          const totalAssigned = getTotalAssigned(itemId);
          const remaining = itemQty - totalAssigned;

          const isComplete = remaining <= 0 && totalAssigned > 0;

          return (
            <div key={itemId} className={`py-4 transition-opacity ${isComplete ? "opacity-50" : ""}`}>
              {/* Item Header - same style as Step 1 rows */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-primary font-semibold tabular-nums w-8 text-center">{itemQty}</span>
                  <span className="font-normal truncate">{item.name}</span>
                </div>
                <span className="font-semibold tabular-nums text-right w-28">{fmt(totalPrice)}</span>
              </div>

              {/* Mode Toggle - more compact */}
              <div className="flex gap-2 mb-2 ml-11">
                <button
                  className={`py-1 px-3 text-xs font-medium rounded-md transition-colors ${
                    mode === "individual"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 text-muted-foreground"
                  }`}
                  onClick={() => toggleMode(itemId)}
                >
                  {t("items.individual")}
                </button>
                <button
                  className={`py-1 px-3 text-xs font-medium rounded-md transition-colors ${
                    mode === "grupal"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 text-muted-foreground"
                  }`}
                  onClick={() => toggleMode(itemId)}
                >
                  {t("items.grupal")}
                </button>
                {/* Quick action for grupal - inline */}
                {mode === "grupal" && (
                  <button
                    className="py-1 px-3 text-xs font-medium text-primary hover:underline transition-colors"
                    onClick={() => assignAll(itemId)}
                  >
                    {t("items.allTogether")}
                  </button>
                )}
              </div>

              {/* Participants Assignment - aligned with content */}
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide ml-11">
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
