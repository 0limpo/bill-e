"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStoredUser } from "@/lib/auth";
import {
  loadSession,
  pollSession,
  joinSession,
  selectExistingParticipant,
  assignItem,
  addItem,
  updateItem,
  deleteItem,
  updateCharges,
  updateSubtotal,
  updateTotal,
  finalizeSession,
  reopenSession,
  removeParticipant,
  updateParticipant,
  addParticipantManual,
  updateHostStep as apiUpdateHostStep,
  updateBillCostShared as apiUpdateBillCostShared,
  type SessionResponse,
  type ApiCharge,
  type PollResponse,
} from "@/lib/api";

// --- Types ---

export interface UseSessionOptions {
  sessionId: string;
  ownerToken?: string | null;
  ownerEmail?: string | null;  // For email-based premium verification
  pollInterval?: number;
  interactionPause?: number;
}

export interface UseSessionReturn {
  // State
  session: SessionResponse | null;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  currentParticipant: { id: string; name: string } | null;
  hostStep: number;  // Track which step the host is on

  // Actions
  refresh: () => Promise<void>;
  markInteraction: () => void;

  // Participant actions
  join: (name: string, phone?: string, emailOverride?: string) => Promise<{ success: boolean; limitReached?: boolean; sessionsUsed?: number; isNew?: boolean }>;
  selectParticipant: (participantId: string, name: string, emailOverride?: string) => Promise<{ success: boolean; limitReached?: boolean; sessionsUsed?: number }>;
  addParticipant: (name: string, phone?: string) => Promise<boolean>;
  removeParticipantById: (participantId: string) => Promise<boolean>;
  updateParticipantName: (participantId: string, name: string) => Promise<boolean>;

  // Item actions
  addNewItem: (name: string, price: number, quantity: number) => Promise<boolean>;
  updateItemById: (itemId: string, updates: Partial<{ name: string; price: number; quantity: number; mode: "individual" | "grupal" }>) => Promise<boolean>;
  deleteItemById: (itemId: string) => Promise<boolean>;

  // Assignment actions
  toggleAssignment: (itemId: string, participantId: string, currentlyAssigned: boolean) => Promise<boolean>;
  updateAssignmentQty: (itemId: string, participantId: string, delta: number) => Promise<boolean>;

  // Charges actions
  updateSessionCharges: (charges: ApiCharge[]) => Promise<boolean>;

  // Subtotal/Total actions
  updateOriginalSubtotal: (subtotal: number) => Promise<boolean>;
  updateOriginalTotal: (total: number) => Promise<boolean>;

  // Session status
  finalize: () => Promise<{ success: boolean; limitReached?: boolean; sessionsUsed?: number }>;
  reopen: () => Promise<boolean>;
  updateHostStep: (step: number) => Promise<boolean>;

  // Bill-e cost sharing
  billCostShared: boolean;
  updateBillCostShared: (shared: boolean) => Promise<boolean>;
}

// --- Hook ---

export function useSession({
  sessionId,
  ownerToken,
  ownerEmail,
  pollInterval = 5000,
  interactionPause = 15000,
}: UseSessionOptions): UseSessionReturn {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentParticipant, setCurrentParticipant] = useState<{ id: string; name: string } | null>(null);

  const lastInteraction = useRef<number>(0);
  const lastUpdate = useRef<string>("");
  const pollingActive = useRef<boolean>(true);

  const isOwner = session?.is_owner ?? false;

  // --- Load Session ---

  const loadSessionData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await loadSession(sessionId, ownerToken || undefined);
      setSession(data);
      lastUpdate.current = data.last_updated;

      // Restore current participant from localStorage or set owner
      const stored = localStorage.getItem(`bill-e-participant-${sessionId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        const stillExists = data.participants.find((p) => p.id === parsed.id);
        if (stillExists) {
          setCurrentParticipant({ id: parsed.id, name: stillExists.name });
        } else {
          localStorage.removeItem(`bill-e-participant-${sessionId}`);
        }
      }

      // If owner and no current participant, set owner as current participant
      if (data.is_owner && !stored) {
        const ownerParticipant = data.participants.find((p) => p.role === "owner");
        if (ownerParticipant) {
          setCurrentParticipant({ id: ownerParticipant.id, name: ownerParticipant.name });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading session");
    } finally {
      setLoading(false);
    }
  }, [sessionId, ownerToken]);

  // --- Polling ---

  useEffect(() => {
    if (!session || !sessionId) return;

    const poll = async () => {
      if (!pollingActive.current) return;

      // Skip if user interacted recently
      if (Date.now() - lastInteraction.current < interactionPause) {
        return;
      }

      try {
        const data = await pollSession(sessionId, lastUpdate.current);
        if (data.has_changes) {
          lastUpdate.current = data.last_updated;
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              participants: data.participants,
              assignments: data.assignments,
              items: data.items,
              status: data.status,
              host_step: data.host_step ?? prev.host_step,
              totals: data.totals,
              charges: data.charges,
              number_format: data.number_format || prev.number_format,
              bill_cost_shared: data.bill_cost_shared ?? prev.bill_cost_shared,
              bill_name: data.bill_name ?? prev.bill_name,
            };
          });
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    const intervalId = setInterval(poll, pollInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [session, sessionId, pollInterval, interactionPause]);

  // --- Initial Load ---

  useEffect(() => {
    loadSessionData();

    return () => {
      pollingActive.current = false;
    };
  }, [loadSessionData]);

  // --- Actions ---

  const markInteraction = useCallback(() => {
    lastInteraction.current = Date.now();
  }, []);

  const refresh = useCallback(async () => {
    await loadSessionData();
  }, [loadSessionData]);

  // Join session - returns result with status info
  const join = useCallback(
    async (name: string, phone?: string, emailOverride?: string): Promise<{ success: boolean; limitReached?: boolean; sessionsUsed?: number; isNew?: boolean }> => {
      markInteraction();
      try {
        // Get editor's google email for premium check
        // Use emailOverride if provided (e.g., from post-payment flow), otherwise get from stored user
        const storedUser = getStoredUser();
        const googleEmail = emailOverride || storedUser?.email || undefined;
        console.log("Join: using googleEmail:", googleEmail);
        const result = await joinSession(sessionId, name, phone, googleEmail);

        // Check if limit reached
        if (result.status === "limit_reached") {
          return {
            success: false,
            limitReached: true,
            sessionsUsed: result.sessions_used || 0
          };
        }

        // Success
        if (result.participant) {
          setCurrentParticipant({ id: result.participant.id, name: result.participant.name });
          localStorage.setItem(
            `bill-e-participant-${sessionId}`,
            JSON.stringify({ id: result.participant.id, name: result.participant.name })
          );
          await refresh();
          return { success: true, isNew: !result.is_existing };
        }

        return { success: false };
      } catch (err) {
        console.error("Join error:", err);
        return { success: false };
      }
    },
    [sessionId, markInteraction, refresh]
  );

  // Select existing participant (checks device limit first)
  const selectParticipant = useCallback(
    async (participantId: string, name: string, emailOverride?: string): Promise<{ success: boolean; limitReached?: boolean; sessionsUsed?: number }> => {
      try {
        // Get editor's google email for premium check
        // Use emailOverride if provided (e.g., from post-payment flow), otherwise get from stored user
        const storedUser = getStoredUser();
        const googleEmail = emailOverride || storedUser?.email || undefined;
        console.log("SelectParticipant: using googleEmail:", googleEmail);
        // Check device limit via API
        const result = await selectExistingParticipant(sessionId, participantId, googleEmail);

        // Check if limit reached
        if (result.status === "limit_reached") {
          return {
            success: false,
            limitReached: true,
            sessionsUsed: result.sessions_used || 0
          };
        }

        // Success - save participant locally
        setCurrentParticipant({ id: participantId, name });
        localStorage.setItem(
          `bill-e-participant-${sessionId}`,
          JSON.stringify({ id: participantId, name })
        );
        return { success: true };
      } catch (err) {
        console.error("Select participant error:", err);
        return { success: false };
      }
    },
    [sessionId]
  );

  // Add participant (owner only)
  const addParticipant = useCallback(
    async (name: string, phone?: string): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();
      try {
        const result = await addParticipantManual(sessionId, ownerToken, name, phone);
        // Optimistic update
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: [...prev.participants, result.participant],
          };
        });
        return true;
      } catch (err) {
        console.error("Add participant error:", err);
        await refresh();
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction, refresh]
  );

  // Remove participant
  const removeParticipantById = useCallback(
    async (participantId: string): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();

      // Save for rollback
      const oldParticipant = session?.participants.find((p) => p.id === participantId);
      const oldAssignments = session?.assignments;

      // Optimistic update FIRST
      setSession((prev) => {
        if (!prev) return prev;
        // Remove participant and their assignments
        const newAssignments = { ...prev.assignments };
        Object.keys(newAssignments).forEach((itemId) => {
          newAssignments[itemId] = newAssignments[itemId].filter(
            (a) => a.participant_id !== participantId
          );
        });
        return {
          ...prev,
          participants: prev.participants.filter((p) => p.id !== participantId),
          assignments: newAssignments,
        };
      });

      try {
        await removeParticipant(sessionId, participantId, ownerToken);
        return true;
      } catch (err) {
        console.error("Remove participant error:", err);
        // Rollback
        if (oldParticipant) {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              participants: [...prev.participants, oldParticipant],
              assignments: oldAssignments || prev.assignments,
            };
          });
        }
        return false;
      }
    },
    [sessionId, ownerToken, session, markInteraction]
  );

  // Update participant name
  const updateParticipantName = useCallback(
    async (participantId: string, name: string): Promise<boolean> => {
      markInteraction();

      // Save for rollback
      const oldName = session?.participants.find((p) => p.id === participantId)?.name;

      // Optimistic update FIRST
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.map((p) =>
            p.id === participantId ? { ...p, name } : p
          ),
        };
      });

      try {
        await updateParticipant(sessionId, participantId, name);
        return true;
      } catch (err) {
        console.error("Update participant name error:", err);
        // Rollback
        if (oldName) {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              participants: prev.participants.map((p) =>
                p.id === participantId ? { ...p, name: oldName } : p
              ),
            };
          });
        }
        return false;
      }
    },
    [sessionId, session, markInteraction]
  );

  // Add item
  const addNewItem = useCallback(
    async (name: string, price: number, quantity: number): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();

      // Optimistic update FIRST with temp ID
      const tempId = `temp-${Date.now()}`;
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: [...prev.items, { id: tempId, name, price, quantity, mode: "individual" as const }],
        };
      });

      try {
        const result = await addItem(sessionId, ownerToken, { name, price, quantity });
        // Update temp ID with real ID
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((item) =>
              item.id === tempId ? { ...item, id: result.item.id } : item
            ),
          };
        });
        return true;
      } catch (err) {
        console.error("Add item error:", err);
        // Rollback
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.filter((item) => item.id !== tempId),
          };
        });
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction]
  );

  // Update item
  const updateItemById = useCallback(
    async (
      itemId: string,
      updates: Partial<{ name: string; price: number; quantity: number; mode: "individual" | "grupal" }>
    ): Promise<boolean> => {
      // Mode can be changed by anyone, other fields require owner
      const onlyModeChange = Object.keys(updates).length === 1 && "mode" in updates;
      if (!ownerToken && !onlyModeChange) return false;
      markInteraction();

      // Save old values for rollback
      const oldItem = session?.items.find((item) => item.id === itemId);

      // Optimistic update FIRST
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === itemId ? { ...item, ...updates } : item
          ),
        };
      });

      try {
        await updateItem(sessionId, ownerToken || null, itemId, updates);
        return true;
      } catch (err) {
        console.error("Update item error:", err);
        // Rollback
        if (oldItem) {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              items: prev.items.map((item) =>
                item.id === itemId ? oldItem : item
              ),
            };
          });
        }
        return false;
      }
    },
    [sessionId, ownerToken, session, markInteraction]
  );

  // Delete item
  const deleteItemById = useCallback(
    async (itemId: string): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();

      // Save for rollback
      const oldItem = session?.items.find((item) => item.id === itemId);

      // Optimistic update FIRST
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.filter((item) => item.id !== itemId),
        };
      });

      try {
        await deleteItem(sessionId, itemId, ownerToken);
        return true;
      } catch (err) {
        console.error("Delete item error:", err);
        // Rollback
        if (oldItem) {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              items: [...prev.items, oldItem],
            };
          });
        }
        return false;
      }
    },
    [sessionId, ownerToken, session, markInteraction]
  );

  // Toggle assignment with optimistic update FIRST
  const toggleAssignment = useCallback(
    async (itemId: string, participantId: string, currentlyAssigned: boolean): Promise<boolean> => {
      const participant = session?.participants.find((p) => p.id === participantId);
      if (!participant) return false;

      markInteraction();

      // Optimistic update FIRST for instant feedback
      const newQuantity = currentlyAssigned ? 0 : 1;
      setSession((prev) => {
        if (!prev) return prev;
        const currentAssignments = prev.assignments[itemId] || [];

        let newAssignments;
        if (currentlyAssigned) {
          newAssignments = currentAssignments.filter((a) => a.participant_id !== participantId);
        } else {
          newAssignments = [...currentAssignments, { participant_id: participantId, quantity: 1 }];
        }

        return {
          ...prev,
          assignments: {
            ...prev.assignments,
            [itemId]: newAssignments,
          },
        };
      });

      // API call in background (fire and forget for better UX)
      assignItem(
        sessionId,
        itemId,
        participantId,
        newQuantity,
        !currentlyAssigned,
        participant.name
      ).catch((err) => {
        console.error("Assignment error:", err);
        // Don't refresh on error - let polling sync eventually
      });

      return true;
    },
    [sessionId, session, markInteraction]
  );

  // Update assignment quantity (+1 or -1)
  const updateAssignmentQty = useCallback(
    async (itemId: string, participantId: string, delta: number): Promise<boolean> => {
      const participant = session?.participants.find((p) => p.id === participantId);
      if (!participant) return false;

      const currentAssignments = session?.assignments[itemId] || [];
      const currentAssign = currentAssignments.find((a) => a.participant_id === participantId);
      const currentQty = currentAssign?.quantity || 0;
      const newQty = Math.max(0, currentQty + delta);

      // Don't do anything if trying to go below 0
      if (newQty === currentQty) return true;

      markInteraction();

      // Optimistic update FIRST
      setSession((prev) => {
        if (!prev) return prev;
        const assigns = prev.assignments[itemId] || [];

        let newAssigns;
        if (newQty === 0) {
          // Remove assignment
          newAssigns = assigns.filter((a) => a.participant_id !== participantId);
        } else if (currentQty === 0) {
          // Add new assignment
          newAssigns = [...assigns, { participant_id: participantId, quantity: newQty }];
        } else {
          // Update existing
          newAssigns = assigns.map((a) =>
            a.participant_id === participantId ? { ...a, quantity: newQty } : a
          );
        }

        return {
          ...prev,
          assignments: {
            ...prev.assignments,
            [itemId]: newAssigns,
          },
        };
      });

      // API call in background (fire and forget for better UX)
      assignItem(
        sessionId,
        itemId,
        participantId,
        newQty,
        newQty > 0,
        participant.name
      ).catch((err) => {
        console.error("Assignment error:", err);
        // Don't refresh on error - let polling sync eventually
      });

      return true;
    },
    [sessionId, session, markInteraction]
  );

  // Update charges
  const updateSessionCharges = useCallback(
    async (charges: ApiCharge[]): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();

      // Save for rollback
      const oldCharges = session?.charges;

      // Optimistic update FIRST
      setSession((prev) => (prev ? { ...prev, charges } : prev));

      try {
        await updateCharges(sessionId, ownerToken, charges);
        return true;
      } catch (err) {
        console.error("Update charges error:", err);
        // Rollback
        if (oldCharges) {
          setSession((prev) => (prev ? { ...prev, charges: oldCharges } : prev));
        }
        return false;
      }
    },
    [sessionId, ownerToken, session, markInteraction]
  );

  // Update original subtotal (OCR value)
  const updateOriginalSubtotal = useCallback(
    async (newSubtotal: number): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();

      // Save for rollback
      const oldSubtotal = session?.subtotal;

      // Optimistic update
      setSession((prev) => (prev ? { ...prev, subtotal: newSubtotal } : prev));

      try {
        await updateSubtotal(sessionId, ownerToken, newSubtotal);
        return true;
      } catch (err) {
        console.error("Update subtotal error:", err);
        // Rollback
        if (oldSubtotal !== undefined) {
          setSession((prev) => (prev ? { ...prev, subtotal: oldSubtotal } : prev));
        }
        return false;
      }
    },
    [sessionId, ownerToken, session, markInteraction]
  );

  // Update original total (OCR value)
  const updateOriginalTotal = useCallback(
    async (newTotal: number): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();

      // Save for rollback
      const oldTotal = session?.total;

      // Optimistic update
      setSession((prev) => (prev ? { ...prev, total: newTotal } : prev));

      try {
        await updateTotal(sessionId, ownerToken, newTotal);
        return true;
      } catch (err) {
        console.error("Update total error:", err);
        // Rollback
        if (oldTotal !== undefined) {
          setSession((prev) => (prev ? { ...prev, total: oldTotal } : prev));
        }
        return false;
      }
    },
    [sessionId, ownerToken, session, markInteraction]
  );

  // Finalize session
  const finalize = useCallback(async (): Promise<{ success: boolean; limitReached?: boolean; sessionsUsed?: number }> => {
    if (!ownerToken) return { success: false };
    markInteraction();
    try {
      const result = await finalizeSession(sessionId, ownerToken, ownerEmail || undefined);

      // Check if limit was reached
      if (result.error === "limit_reached" || result.requires_payment) {
        return {
          success: false,
          limitReached: true,
          sessionsUsed: result.sessions_used || 0
        };
      }

      setSession((prev) => (prev ? { ...prev, status: "finalized" } : prev));
      return { success: true };
    } catch (err: unknown) {
      console.error("Finalize error:", err);
      // Check if error is limit_reached (402 Payment Required)
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("limit_reached") || errorMessage.includes("402")) {
        return { success: false, limitReached: true };
      }
      return { success: false };
    }
  }, [sessionId, ownerToken, ownerEmail, markInteraction]);

  // Reopen session
  const reopen = useCallback(async (): Promise<boolean> => {
    if (!ownerToken) return false;
    markInteraction();
    try {
      await reopenSession(sessionId, ownerToken);
      setSession((prev) => (prev ? { ...prev, status: "assigning" } : prev));
      return true;
    } catch (err) {
      console.error("Reopen error:", err);
      return false;
    }
  }, [sessionId, ownerToken, markInteraction]);

  // Update host step (owner only)
  const updateHostStep = useCallback(async (step: number): Promise<boolean> => {
    if (!ownerToken) return false;
    markInteraction();
    try {
      await apiUpdateHostStep(sessionId, ownerToken, step);
      setSession((prev) => (prev ? { ...prev, host_step: step } : prev));
      return true;
    } catch (err) {
      console.error("Update host step error:", err);
      return false;
    }
  }, [sessionId, ownerToken, markInteraction]);

  // Update bill cost shared (owner only)
  const updateBillCostShared = useCallback(async (shared: boolean): Promise<boolean> => {
    if (!ownerToken) return false;
    markInteraction();

    // Optimistic update
    setSession((prev) => (prev ? { ...prev, bill_cost_shared: shared } : prev));

    try {
      await apiUpdateBillCostShared(sessionId, ownerToken, shared);
      return true;
    } catch (err) {
      console.error("Update bill cost shared error:", err);
      // Rollback
      setSession((prev) => (prev ? { ...prev, bill_cost_shared: !shared } : prev));
      return false;
    }
  }, [sessionId, ownerToken, markInteraction]);

  const hostStep = session?.host_step ?? 1;
  const billCostShared = session?.bill_cost_shared ?? false;

  return {
    session,
    loading,
    error,
    isOwner,
    currentParticipant,
    hostStep,
    refresh,
    markInteraction,
    join,
    selectParticipant,
    addParticipant,
    removeParticipantById,
    updateParticipantName,
    addNewItem,
    updateItemById,
    deleteItemById,
    toggleAssignment,
    updateAssignmentQty,
    updateSessionCharges,
    updateOriginalSubtotal,
    updateOriginalTotal,
    finalize,
    reopen,
    updateHostStep,
    billCostShared,
    updateBillCostShared,
  };
}
