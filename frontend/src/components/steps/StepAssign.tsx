"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  onAssignmentsChange: (assignments: Record<string, Assignment[]>) => void;
  onBack: () => void;
  onNext: () => void;
  t: (key: string) => string;
}

export function StepAssign({
  items,
  participants,
  assignments,
  onAssignmentsChange,
  onBack,
  onNext,
  t,
}: StepAssignProps) {
  const [itemModes, setItemModes] = useState<Record<string, "individual" | "grupal">>({});

  const fmt = (amount: number) => formatCurrency(amount);

  // Toggle assignment for a participant on an item
  const toggleAssignment = (itemId: string, participantId: string) => {
    const itemAssignments = assignments[itemId] || [];
    const existing = itemAssignments.find((a) => a.participant_id === participantId);

    let newAssignments: Assignment[];
    if (existing) {
      // Remove assignment
      newAssignments = itemAssignments.filter((a) => a.participant_id !== participantId);
    } else {
      // Add assignment
      const item = items.find((i) => (i.id || i.name) === itemId);
      const mode = itemModes[itemId] || "individual";

      if (mode === "grupal") {
        // Grupal: each person gets a fraction
        newAssignments = [...itemAssignments, { participant_id: participantId, quantity: 1 }];
      } else {
        // Individual: assign one unit
        newAssignments = [...itemAssignments, { participant_id: participantId, quantity: 1 }];
      }
    }

    onAssignmentsChange({
      ...assignments,
      [itemId]: newAssignments,
    });
  };

  // Toggle mode for an item
  const toggleMode = (itemId: string) => {
    const currentMode = itemModes[itemId] || "individual";
    const newMode = currentMode === "individual" ? "grupal" : "individual";
    setItemModes({ ...itemModes, [itemId]: newMode });

    // Clear assignments when switching modes
    onAssignmentsChange({
      ...assignments,
      [itemId]: [],
    });
  };

  // Assign all participants to an item (grupal mode)
  const assignAll = (itemId: string) => {
    const newAssignments = participants.map((p) => ({
      participant_id: p.id,
      quantity: 1,
    }));
    onAssignmentsChange({
      ...assignments,
      [itemId]: newAssignments,
    });
  };

  return (
    <div className="step-animate">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">{t("steps.assignTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("steps.assignSubtitle")}</p>
      </div>

      {/* Participants Bar */}
      <div className="flex gap-3 overflow-x-auto pb-4 mb-6 scrollbar-hide">
        {participants.map((p) => (
          <div key={p.id} className="participant-chip">
            <div
              className="participant-avatar"
              style={{ backgroundColor: getAvatarColor(p.name) }}
            >
              {getInitials(p.name)}
            </div>
            <span className="participant-name">{p.name}</span>
          </div>
        ))}
      </div>

      {/* Items List */}
      <div className="space-y-3">
        {items.map((item) => {
          const itemId = item.id || item.name;
          const qty = item.quantity || 1;
          const totalPrice = qty * (item.price || 0);
          const itemAssignments = assignments[itemId] || [];
          const mode = itemModes[itemId] || "individual";

          return (
            <div key={itemId} className="item-card">
              {/* Item Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="qty-badge">{qty}x</span>
                  <span className="font-medium">{item.name}</span>
                </div>
                <span className="font-semibold tabular-nums">{fmt(totalPrice)}</span>
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
                  👥 {t("items.allTogether")}
                </button>
              )}

              {/* Participants Assignment */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {participants.map((p) => {
                  const isAssigned = itemAssignments.some((a) => a.participant_id === p.id);

                  return (
                    <button
                      key={p.id}
                      className="participant-chip"
                      onClick={() => toggleAssignment(itemId, p.id)}
                    >
                      <div
                        className={`participant-avatar ${isAssigned ? "selected" : "opacity-40"}`}
                        style={{ backgroundColor: getAvatarColor(p.name) }}
                      >
                        {getInitials(p.name)}
                        {isAssigned && (
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center text-[10px] text-white">
                            ✓
                          </span>
                        )}
                      </div>
                    </button>
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
