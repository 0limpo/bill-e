"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadSession,
  pollSession,
  joinSession,
  assignItem,
  addItem,
  updateItem,
  deleteItem,
  updateCharges,
  finalizeSession,
  reopenSession,
  removeParticipant,
  addParticipantManual,
  type SessionResponse,
  type ApiCharge,
  type PollResponse,
} from "@/lib/api";

// --- Types ---

export interface UseSessionOptions {
  sessionId: string;
  ownerToken?: string | null;
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

  // Actions
  refresh: () => Promise<void>;
  markInteraction: () => void;

  // Participant actions
  join: (name: string, phone?: string) => Promise<boolean>;
  addParticipant: (name: string, phone?: string) => Promise<boolean>;
  removeParticipantById: (participantId: string) => Promise<boolean>;

  // Item actions
  addNewItem: (name: string, price: number, quantity: number) => Promise<boolean>;
  updateItemById: (itemId: string, updates: Partial<{ name: string; price: number; quantity: number; mode: "individual" | "grupal" }>) => Promise<boolean>;
  deleteItemById: (itemId: string) => Promise<boolean>;

  // Assignment actions
  toggleAssignment: (itemId: string, participantId: string, currentlyAssigned: boolean) => Promise<boolean>;
  updateAssignmentQty: (itemId: string, participantId: string, delta: number) => Promise<boolean>;

  // Charges actions
  updateSessionCharges: (charges: ApiCharge[]) => Promise<boolean>;

  // Session status
  finalize: () => Promise<boolean>;
  reopen: () => Promise<boolean>;
}

// --- Hook ---

export function useSession({
  sessionId,
  ownerToken,
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

      // Restore current participant from localStorage
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
              totals: data.totals,
              charges: data.charges,
              number_format: data.number_format || prev.number_format,
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

  // Join session
  const join = useCallback(
    async (name: string, phone?: string): Promise<boolean> => {
      markInteraction();
      try {
        const result = await joinSession(sessionId, name, phone);
        const participant = result.participant;
        setCurrentParticipant({ id: participant.id, name: participant.name });
        localStorage.setItem(
          `bill-e-participant-${sessionId}`,
          JSON.stringify({ id: participant.id, name: participant.name })
        );
        await refresh();
        return true;
      } catch (err) {
        console.error("Join error:", err);
        return false;
      }
    },
    [sessionId, markInteraction, refresh]
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
      try {
        await removeParticipant(sessionId, participantId, ownerToken);
        await refresh();
        return true;
      } catch (err) {
        console.error("Remove participant error:", err);
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction, refresh]
  );

  // Add item
  const addNewItem = useCallback(
    async (name: string, price: number, quantity: number): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();
      try {
        await addItem(sessionId, ownerToken, { name, price, quantity });
        await refresh();
        return true;
      } catch (err) {
        console.error("Add item error:", err);
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction, refresh]
  );

  // Update item
  const updateItemById = useCallback(
    async (
      itemId: string,
      updates: Partial<{ name: string; price: number; quantity: number; mode: "individual" | "grupal" }>
    ): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();
      try {
        await updateItem(sessionId, ownerToken, itemId, updates);
        // Optimistic update
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item
            ),
          };
        });
        return true;
      } catch (err) {
        console.error("Update item error:", err);
        await refresh();
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction, refresh]
  );

  // Delete item
  const deleteItemById = useCallback(
    async (itemId: string): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();
      try {
        await deleteItem(sessionId, itemId, ownerToken);
        // Optimistic update
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.filter((item) => item.id !== itemId),
          };
        });
        return true;
      } catch (err) {
        console.error("Delete item error:", err);
        await refresh();
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction, refresh]
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

      // Then make API call in background
      try {
        await assignItem(
          sessionId,
          itemId,
          participantId,
          newQuantity,
          !currentlyAssigned,
          participant.name
        );
        return true;
      } catch (err) {
        console.error("Assignment error:", err);
        // Rollback on error
        await refresh();
        return false;
      }
    },
    [sessionId, session, markInteraction, refresh]
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

      // API call in background
      try {
        await assignItem(
          sessionId,
          itemId,
          participantId,
          newQty,
          newQty > 0,
          participant.name
        );
        return true;
      } catch (err) {
        console.error("Assignment error:", err);
        await refresh();
        return false;
      }
    },
    [sessionId, session, markInteraction, refresh]
  );

  // Update charges
  const updateSessionCharges = useCallback(
    async (charges: ApiCharge[]): Promise<boolean> => {
      if (!ownerToken) return false;
      markInteraction();
      try {
        await updateCharges(sessionId, ownerToken, charges);
        setSession((prev) => (prev ? { ...prev, charges } : prev));
        return true;
      } catch (err) {
        console.error("Update charges error:", err);
        return false;
      }
    },
    [sessionId, ownerToken, markInteraction]
  );

  // Finalize session
  const finalize = useCallback(async (): Promise<boolean> => {
    if (!ownerToken) return false;
    markInteraction();
    try {
      await finalizeSession(sessionId, ownerToken);
      setSession((prev) => (prev ? { ...prev, status: "finalized" } : prev));
      return true;
    } catch (err) {
      console.error("Finalize error:", err);
      return false;
    }
  }, [sessionId, ownerToken, markInteraction]);

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

  return {
    session,
    loading,
    error,
    isOwner,
    currentParticipant,
    refresh,
    markInteraction,
    join,
    addParticipant,
    removeParticipantById,
    addNewItem,
    updateItemById,
    deleteItemById,
    toggleAssignment,
    updateAssignmentQty,
    updateSessionCharges,
    finalize,
    reopen,
  };
}
