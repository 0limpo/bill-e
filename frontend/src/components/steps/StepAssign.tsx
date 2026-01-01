"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Minus, Plus, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  getAvatarColor,
  getInitials,
  type Item,
  type Participant,
  type Assignment,
} from "@/lib/billEngine";
import { playCelebrationSound } from "@/lib/sounds";

interface StepAssignProps {
  items: Item[];
  participants: Participant[];
  assignments: Record<string, Assignment[]>;
  onUpdateQty: (itemId: string, participantId: string, delta: number) => void;
  onUpdateItemMode?: (itemId: string, mode: "individual" | "grupal") => void;
  onBack: () => void;
  onNext: () => void;
  t: (key: string) => string;
  // Props for participant management
  isOwner?: boolean;
  showAddParticipant?: boolean;
  newParticipantName?: string;
  onNewParticipantNameChange?: (name: string) => void;
  onAddParticipant?: () => void;
  onToggleAddParticipant?: (show: boolean) => void;
  onRemoveParticipant?: (participantId: string) => void;
  // Props for editable name
  currentParticipantId?: string;
  onUpdateParticipantName?: (participantId: string, newName: string) => void;
  // Props for editor navigation control
  nextDisabled?: boolean;
  nextLabel?: string;
}

export function StepAssign({
  items,
  participants,
  assignments,
  onUpdateQty,
  onUpdateItemMode,
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
  currentParticipantId,
  onUpdateParticipantName,
  nextDisabled = false,
  nextLabel,
}: StepAssignProps) {
  // Initialize modes from persisted item.mode values
  const [itemModes, setItemModes] = useState<Record<string, "individual" | "grupal">>(() => {
    const initial: Record<string, "individual" | "grupal"> = {};
    items.forEach((item) => {
      const itemId = item.id || item.name;
      if (item.mode) {
        initial[itemId] = item.mode;
      }
    });
    return initial;
  });
  // Initialize unitModeItems from existing unit-based assignments
  const [unitModeItems, setUnitModeItems] = useState<Set<string>>(() => {
    const itemsWithUnits = new Set<string>();
    Object.entries(assignments).forEach(([key, assigns]) => {
      const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
      if (unitMatch && assigns && assigns.some((a) => a.quantity > 0)) {
        itemsWithUnits.add(unitMatch[1]);
      }
    });
    return itemsWithUnits;
  });
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const prevAllAssignedRef = useRef<boolean | null>(null);
  const initializedRef = useRef(false);

  // Open first item by default on mount (only once)
  useEffect(() => {
    if (items.length > 0 && !initializedRef.current) {
      const firstItemId = items[0].id || items[0].name;
      setExpandedItemId(firstItemId);
      initializedRef.current = true;
    }
  }, [items]);

  // Sync itemModes from items when they change (e.g., navigating back to this step)
  useEffect(() => {
    const newModes: Record<string, "individual" | "grupal"> = {};
    items.forEach((item) => {
      const itemId = item.id || item.name;
      if (item.mode) {
        newModes[itemId] = item.mode;
      }
    });
    // Only update if there are modes to sync
    if (Object.keys(newModes).length > 0) {
      setItemModes((prev) => ({ ...prev, ...newModes }));
    }
  }, [items]);

  // Sync unitModeItems from assignments when they change (e.g., polling updates)
  useEffect(() => {
    const itemsWithUnits = new Set<string>();
    Object.entries(assignments).forEach(([key, assigns]) => {
      const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
      if (unitMatch && assigns && assigns.some((a) => a.quantity > 0)) {
        itemsWithUnits.add(unitMatch[1]);
      }
    });
    // Only update if different
    setUnitModeItems((prev) => {
      if (prev.size !== itemsWithUnits.size) return itemsWithUnits;
      for (const id of itemsWithUnits) {
        if (!prev.has(id)) return itemsWithUnits;
      }
      return prev;
    });
  }, [assignments]);

  const fmt = (amount: number) => formatCurrency(amount);

  // Clear all unit-based assignments for an item
  const clearUnitAssignments = (itemId: string, itemQty: number) => {
    for (let i = 0; i < itemQty; i++) {
      const unitId = `${itemId}_unit_${i}`;
      const unitAssignments = assignments[unitId] || [];
      unitAssignments.forEach((a) => {
        if (a.quantity > 0) {
          onUpdateQty(unitId, a.participant_id, -a.quantity);
        }
      });
    }
  };

  // Clear base item assignments (non-unit)
  const clearBaseAssignments = (itemId: string) => {
    const baseAssignments = assignments[itemId] || [];
    baseAssignments.forEach((a) => {
      if (a.quantity > 0) {
        onUpdateQty(itemId, a.participant_id, -a.quantity);
      }
    });
  };

  // Toggle mode for an item and persist to backend
  const toggleMode = (itemId: string, itemQty: number) => {
    const currentMode = itemModes[itemId] || "individual";
    const newMode = currentMode === "individual" ? "grupal" : "individual";

    // Clear all assignments when switching modes to avoid confusion
    clearBaseAssignments(itemId);
    if (unitModeItems.has(itemId)) {
      clearUnitAssignments(itemId, itemQty);
    }

    setItemModes({ ...itemModes, [itemId]: newMode });

    // Persist mode change to backend
    onUpdateItemMode?.(itemId, newMode);

    if (newMode === "individual") {
      // Reset unit mode when switching to individual
      setUnitModeItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  // Toggle per-unit mode for grupal items
  const toggleUnitMode = (itemId: string, itemQty: number) => {
    const isCurrentlyUnitMode = unitModeItems.has(itemId);

    if (isCurrentlyUnitMode) {
      // Switching OFF unit mode: clear unit assignments
      clearUnitAssignments(itemId, itemQty);
    } else {
      // Switching ON unit mode: clear base assignments
      clearBaseAssignments(itemId);
    }

    setUnitModeItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Get unit-based item ID (must match billEngine.ts format)
  const getUnitItemId = (itemId: string, unitIndex: number) => `${itemId}_unit_${unitIndex}`;

  // Assign all participants to an item (1 unit each)
  const assignAll = (itemId: string) => {
    participants.forEach((p) => {
      const currentQty = (assignments[itemId] || []).find((a) => a.participant_id === p.id)?.quantity || 0;
      if (currentQty === 0) {
        onUpdateQty(itemId, p.id, 1);
      }
    });
  };

  // Get total assigned quantity for an item (including unit-based assignments)
  const getTotalAssigned = (itemId: string, itemQty: number = 1, mode: "individual" | "grupal" = "individual") => {
    // Check if this item has ACTIVE unit-based assignments (quantity > 0)
    const hasActiveUnitAssignments = Object.entries(assignments).some(([k, assigns]) =>
      k.startsWith(`${itemId}_unit_`) && assigns.some((a) => a.quantity > 0)
    );

    if (hasActiveUnitAssignments) {
      // Count units that have at least one person assigned
      let unitsAssigned = 0;
      for (let i = 0; i < itemQty; i++) {
        const unitId = getUnitItemId(itemId, i);
        const unitAssignments = assignments[unitId] || [];
        if (unitAssignments.some((a) => a.quantity > 0)) {
          unitsAssigned++;
        }
      }
      return unitsAssigned;
    }

    // Regular assignment
    const itemAssignments = assignments[itemId] || [];
    const peopleAssigned = itemAssignments.filter((a) => a.quantity > 0).length;

    if (mode === "grupal" && peopleAssigned > 0) {
      // Grupal mode: people sharing = item is fully assigned (count as itemQty)
      return itemQty;
    }

    // Individual mode: sum up quantities
    const totalAssigned = itemAssignments.reduce((sum, a) => sum + (a.quantity || 0), 0);
    return totalAssigned;
  };

  // Calculate total amounts for progress indicator
  const totalAmount = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0);
  const assignedAmount = items.reduce((sum, item) => {
    const itemId = item.id || item.name;
    const itemQty = item.quantity || 1;
    const mode = itemModes[itemId] || "individual";
    const assignedQty = getTotalAssigned(itemId, itemQty, mode);
    return sum + assignedQty * (item.price || 0);
  }, 0);
  const remainingAmount = totalAmount - assignedAmount;
  const progressPercent = totalAmount > 0 ? (assignedAmount / totalAmount) * 100 : 0;
  const isAllAssigned = remainingAmount <= 0 && totalAmount > 0;

  // Calculate max price width for alignment (using ch units for tabular-nums)
  const maxPriceLength = Math.max(...items.map((item) => fmt((item.quantity || 1) * (item.price || 0)).length));
  const priceWidth = `${maxPriceLength}ch`;

  // Trigger celebration when all items become assigned
  useEffect(() => {
    if (isAllAssigned && prevAllAssignedRef.current === false) {
      // Transitioned from not-assigned to all-assigned - show celebration
      setShowCelebration(true);
      playCelebrationSound();
      const timer = setTimeout(() => setShowCelebration(false), 4500);
      return () => clearTimeout(timer);
    }
    prevAllAssignedRef.current = isAllAssigned;
  }, [isAllAssigned]);

  return (
    <div className="step-animate">
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
            />
            <button
              onClick={onAddParticipant}
              disabled={!newParticipantName.trim()}
              className="px-4 py-3 rounded-xl bg-primary text-white font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <Check className="w-5 h-5" />
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
      <div className="flex gap-1 overflow-x-auto pt-2 pb-4 mb-6 scrollbar-hide items-start">
        {/* Add Participant Button (circle) - only for owner */}
        {isOwner && !showAddParticipant && (
          <div className="flex flex-col items-center gap-1 min-w-14 shrink-0">
            <button
              onClick={() => onToggleAddParticipant?.(true)}
              className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors border-2 border-dashed border-primary/30"
            >
              <Plus className="w-5 h-5" />
            </button>
            <span className="text-xs text-muted-foreground">{t("participants.addShort")}</span>
          </div>
        )}

        {/* Participants */}
        {participants.map((p, pIndex) => {
          const isCurrentUser = p.id === currentParticipantId;
          const isEditing = editingParticipantId === p.id;

          const canEdit = isCurrentUser && onUpdateParticipantName;
          const startEditing = () => {
            if (canEdit) {
              setEditNameValue(p.name);
              setEditingParticipantId(p.id);
            }
          };

          return (
            <div key={p.id} className="participant-chip relative group shrink-0">
              <button
                type="button"
                onClick={startEditing}
                className={canEdit ? "cursor-pointer" : "cursor-default"}
                disabled={!canEdit}
              >
                <div
                  className="participant-avatar"
                  style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                >
                  {getInitials(p.name)}
                </div>
              </button>
              {isEditing ? (
                <input
                  type="text"
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onBlur={() => {
                    if (editNameValue.trim() && editNameValue.trim() !== p.name) {
                      onUpdateParticipantName?.(p.id, editNameValue.trim());
                    }
                    setEditingParticipantId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editNameValue.trim() && editNameValue.trim() !== p.name) {
                        onUpdateParticipantName?.(p.id, editNameValue.trim());
                      }
                      setEditingParticipantId(null);
                    } else if (e.key === "Escape") {
                      setEditingParticipantId(null);
                    }
                  }}
                  className="participant-name bg-transparent border-b border-primary outline-none w-16 text-center"
                  autoFocus
                />
              ) : (
                <button
                  onClick={startEditing}
                  className={`participant-name ${canEdit ? "hover:text-foreground cursor-pointer" : "cursor-default"}`}
                >
                  {p.name}
                </button>
              )}

              {/* Delete button (only for owner, not for self, visible on hover) */}
              {isOwner && onRemoveParticipant && !isEditing && !isCurrentUser && (
                <button
                  onClick={() => onRemoveParticipant(p.id)}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
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
      <div className="space-y-2">
        {items.map((item) => {
          const itemId = item.id || item.name;
          const itemQty = item.quantity || 1;
          const totalPrice = itemQty * (item.price || 0);
          const itemAssignments = assignments[itemId] || [];
          const mode = itemModes[itemId] || "individual";
          const isUnitMode = unitModeItems.has(itemId);
          const totalAssigned = getTotalAssigned(itemId, itemQty, mode);
          const remaining = itemQty - totalAssigned;
          const isExpanded = expandedItemId === itemId;
          const isComplete = remaining <= 0 && totalAssigned > 0;

          // Get assigned participants for mini-avatars (including unit-based assignments)
          const getAssignedParticipants = () => {
            if (isUnitMode) {
              // Collect all participants from all units
              const allAssigned = new Set<string>();
              for (let i = 0; i < itemQty; i++) {
                const unitId = getUnitItemId(itemId, i);
                const unitAssigns = assignments[unitId] || [];
                unitAssigns.forEach((a) => {
                  if (a.quantity > 0) allAssigned.add(a.participant_id);
                });
              }
              return participants.filter((p) => allAssigned.has(p.id));
            }
            return participants.filter((p) =>
              itemAssignments.some((a) => a.participant_id === p.id && a.quantity > 0)
            );
          };
          const assignedParticipants = getAssignedParticipants();

          return (
            <div
              key={itemId}
              className={`rounded-xl transition-colors ${
                isComplete
                  ? "bg-secondary/40"
                  : "bg-primary/15"
              }`}
            >
              {/* Collapsed Row - clickable to expand */}
              <button
                type="button"
                className="w-full flex items-center justify-between p-3"
                onClick={() => setExpandedItemId(isExpanded ? null : itemId)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <ChevronDown className={`w-4 h-4 transition-transform ${isComplete ? "text-muted-foreground/50" : "text-muted-foreground"} ${isExpanded ? "" : "-rotate-90"}`} />
                  <span className={`font-semibold tabular-nums ${isComplete ? "text-muted-foreground" : "text-primary"}`}>{itemQty}</span>
                  <span className={`font-normal truncate text-left ${isComplete ? "text-muted-foreground" : "text-foreground"}`}>{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Mini-avatars of assigned participants (only when collapsed) */}
                  {!isExpanded && assignedParticipants.length > 0 && (
                    <div className="flex -space-x-2">
                      {assignedParticipants.slice(0, 4).map((p) => {
                        const pIndex = participants.findIndex((pp) => pp.id === p.id);
                        return (
                          <div
                            key={p.id}
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-white ring-2 ring-background ${isComplete ? "opacity-60" : ""}`}
                            style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                          >
                            {getInitials(p.name)}
                          </div>
                        );
                      })}
                      {assignedParticipants.length > 4 && (
                        <div className={`w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium ring-2 ring-background ${isComplete ? "opacity-60" : ""}`}>
                          +{assignedParticipants.length - 4}
                        </div>
                      )}
                    </div>
                  )}
                  <span
                    className={`font-semibold tabular-nums text-right ${isComplete ? "text-muted-foreground" : "text-foreground"}`}
                    style={{ minWidth: priceWidth }}
                  >{fmt(totalPrice)}</span>
                </div>
              </button>

              {/* Expanded View */}
              {isExpanded && (
                <div className="pb-3 px-3 pt-0">
                  {/* Mode Toggle - segmented control style */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="inline-flex rounded-lg bg-secondary p-0.5">
                      <button
                        type="button"
                        className={`py-1 px-3 text-xs font-medium rounded-md transition-colors ${
                          mode === "individual"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={(e) => { e.stopPropagation(); toggleMode(itemId, itemQty); }}
                      >
                        {t("items.individual")}
                      </button>
                      <button
                        type="button"
                        className={`py-1 px-3 text-xs font-medium rounded-md transition-colors ${
                          mode === "grupal"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={(e) => { e.stopPropagation(); toggleMode(itemId, itemQty); }}
                      >
                        {t("items.grupal")}
                      </button>
                    </div>

                    {/* Grupal sub-options */}
                    {mode === "grupal" && (
                      <div className="inline-flex rounded-lg bg-secondary p-0.5">
                        <button
                          type="button"
                          className={`py-1 px-3 text-xs font-medium rounded-md transition-colors ${
                            !isUnitMode
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={(e) => { e.stopPropagation(); if (isUnitMode) toggleUnitMode(itemId, itemQty); assignAll(itemId); }}
                        >
                          {t("items.allTogether")}
                        </button>
                        {itemQty > 1 && (
                          <button
                            type="button"
                            className={`py-1 px-3 text-xs font-medium rounded-md transition-colors ${
                              isUnitMode
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={(e) => { e.stopPropagation(); if (!isUnitMode) toggleUnitMode(itemId, itemQty); }}
                          >
                            {t("items.perUnit")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Remaining indicator (not in unit mode) */}
                  {remaining > 0 && !isUnitMode && (
                    <p className="text-xs text-muted-foreground mb-3">
                      {t("assign.remaining")}: {remaining} de {itemQty}
                    </p>
                  )}

                  {/* Per-unit assignment UI - horizontal layout */}
                  {isUnitMode ? (
                    <div className="space-y-2">
                      {Array.from({ length: itemQty }, (_, unitIndex) => {
                        const unitId = getUnitItemId(itemId, unitIndex);
                        const unitAssignments = assignments[unitId] || [];

                        return (
                          <div key={unitIndex} className="flex items-center gap-3 py-1">
                            <span className="text-xs text-muted-foreground w-16 shrink-0">
                              {t("items.unit")} {unitIndex + 1}
                            </span>
                            <div className="flex gap-1.5 overflow-x-auto py-0.5 scrollbar-hide flex-1">
                              {participants.map((p, pIndex) => {
                                const assign = unitAssignments.find((a) => a.participant_id === p.id);
                                const isAssigned = (assign?.quantity || 0) > 0;

                                return (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onUpdateQty(unitId, p.id, isAssigned ? -1 : 1);
                                    }}
                                  >
                                    <div
                                      className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-white transition-all ${
                                        isAssigned ? "ring-2 ring-primary" : "opacity-30"
                                      }`}
                                      style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                                    >
                                      {getInitials(p.name)}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Regular Participants Assignment */
                    <div className="flex gap-1 overflow-x-auto pt-1 pb-2 scrollbar-hide">
                      {participants.map((p, pIndex) => {
                        const assign = itemAssignments.find((a) => a.participant_id === p.id);
                        const qty = assign?.quantity || 0;
                        const isAssigned = qty > 0;
                        const canAdd = remaining > 0 || mode === "grupal";

                        return (
                          <div key={p.id} className="flex flex-col items-center gap-1 min-w-14">
                            {/* Avatar with click to add */}
                            <button
                              type="button"
                              className="relative"
                              onClick={(e) => { e.stopPropagation(); canAdd && onUpdateQty(itemId, p.id, 1); }}
                              disabled={!canAdd && !isAssigned}
                            >
                              <div
                                className={`participant-avatar ${isAssigned ? "selected" : canAdd ? "opacity-40" : "opacity-20"}`}
                                style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
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
                            <span className="text-xs text-muted-foreground truncate max-w-14">{p.name.split(" ")[0]}</span>

                            {/* Minus button (only show when assigned) */}
                            {qty > 0 && (
                              <button
                                type="button"
                                className="w-6 h-6 rounded-full bg-destructive/20 text-destructive flex items-center justify-center hover:bg-destructive/30 transition-colors"
                                onClick={(e) => { e.stopPropagation(); onUpdateQty(itemId, p.id, -1); }}
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
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
        <Button
          size="lg"
          className="flex-1 h-12 font-semibold"
          onClick={onNext}
          disabled={nextDisabled}
        >
          {nextLabel || t("steps.continue")}
          {!nextDisabled && <ChevronRight className="w-4 h-4 ml-2" />}
        </Button>
      </div>
    </div>
  );
}
