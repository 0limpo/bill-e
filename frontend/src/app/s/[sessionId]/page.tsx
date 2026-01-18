"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { StepReview } from "@/components/steps/StepReview";
import { StepAssign } from "@/components/steps/StepAssign";
import { StepShare } from "@/components/steps/StepShare";
import { getTranslator, detectLanguage, type Language } from "@/lib/i18n";
import { formatCurrency, detectDecimals, getAvatarColor, getInitials, type Item, type Charge, type Participant, type Assignment } from "@/lib/billEngine";
import { startPaymentFlow, formatPriceCLP } from "@/lib/payment";
import { getStoredToken, getStoredUser, getAuthProviders, type AuthProvider } from "@/lib/auth";
import { SignInButtons } from "@/components/auth/SignInButtons";
import {
  trackStep1Complete,
  trackStep2Complete,
  trackPersonAdded,
  trackPaywallShown,
  trackGuestJoined,
  trackShare,
  trackSessionDetails,
} from "@/lib/tracking";

// Check localStorage for owner token
function getStoredOwnerToken(sessionId: string): string | null {
  try {
    const stored = localStorage.getItem("bill-e-recent-session");
    if (!stored) return null;
    const data = JSON.parse(stored);
    if (data.sessionId === sessionId) {
      return data.ownerToken;
    }
    return null;
  } catch {
    return null;
  }
}

export default function SessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const sessionId = params.sessionId as string;
  const urlOwnerToken = searchParams.get("owner");
  const viewMode = searchParams.get("view");
  const isViewOnly = viewMode === "results";
  const paymentSuccess = searchParams.get("payment") === "success";
  const payerType = searchParams.get("payer"); // "host" or "editor"
  const authIsPremium = searchParams.get("is_premium");
  const returnedFromAuth = searchParams.has("token");

  // Use URL token first, fallback to localStorage
  const [ownerToken, setOwnerToken] = useState<string | null>(urlOwnerToken);

  // Load email synchronously to ensure it's available for autoFinalize
  const [userEmail, setUserEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const user = getStoredUser();
      return user?.email || null;
    }
    return null;
  });

  useEffect(() => {
    if (!urlOwnerToken) {
      const storedToken = getStoredOwnerToken(sessionId);
      if (storedToken) {
        setOwnerToken(storedToken);
      }
    }
  }, [sessionId, urlOwnerToken]);

  const [step, setStep] = useState(isViewOnly ? 3 : 1);
  const [lang, setLang] = useState<Language>("es");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  // Editor limit tracking (device_id based)
  const [showPaywall, setShowPaywall] = useState(false);
  const [sessionsUsed, setSessionsUsed] = useState(0);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [premiumPrice] = useState(1990); // Default, could fetch from API
  const [selectingParticipant, setSelectingParticipant] = useState<string | null>(null);

  // Store pending join info for after payment
  const storePendingJoin = (name: string, participantId?: string) => {
    localStorage.setItem(`pending-join-${sessionId}`, JSON.stringify({ name, participantId }));
  };
  const getPendingJoin = (): { name: string; participantId?: string } | null => {
    try {
      const stored = localStorage.getItem(`pending-join-${sessionId}`);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  };
  const clearPendingJoin = () => {
    localStorage.removeItem(`pending-join-${sessionId}`);
  };

  // Auth providers for paywall sign-in
  const [authProviders, setAuthProviders] = useState<AuthProvider[]>([]);
  const [showNoPremiumWarning, setShowNoPremiumWarning] = useState(false);

  const {
    session,
    loading,
    error,
    isOwner,
    currentParticipant,
    hostStep,
    join,
    selectParticipant,
    addParticipant,
    removeParticipantById,
    updateParticipantName,
    updateAssignmentQty,
    addNewItem,
    updateItemById,
    deleteItemById,
    updateSessionCharges,
    updateOriginalSubtotal,
    updateOriginalTotal,
    finalize,
    reopen,
    markInteraction,
    updateHostStep,
  } = useSession({
    sessionId,
    ownerToken,
    ownerEmail: userEmail,
    pollInterval: 5000,
    interactionPause: 15000,
  });

  // Detect language
  useEffect(() => {
    setLang(detectLanguage());
  }, []);

  // If session is already finalized, go directly to step 3
  useEffect(() => {
    if (session?.status === "finalized" && step !== 3) {
      setStep(3);
    }
  }, [session?.status, step]);

  // Handle post-payment redirect
  useEffect(() => {
    const handlePostPayment = async () => {
      if (!paymentSuccess || !session) return;

      // Clear payment params from URL to avoid re-triggering
      const clearPaymentParams = () => {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete("payment");
        newUrl.searchParams.delete("payer");
        router.replace(newUrl.pathname + newUrl.search, { scroll: false });
      };

      // Editor payment: auto-join with stored name, then go to step 1
      // Check for pendingJoin existence (more reliable than payerType from URL)
      const pendingJoin = getPendingJoin();
      if (pendingJoin) {
        console.log("Editor returned from payment, auto-joining with:", pendingJoin.name);

        // Get the user's email explicitly (same pattern as host flow)
        // This ensures premium verification works after payment
        const storedUser = getStoredUser();
        const editorEmail = storedUser?.email || undefined;
        console.log("Editor email for premium check:", editorEmail);

        // Re-attempt join with stored info (now premium, should succeed)
        let result;
        if (pendingJoin.participantId) {
          console.log("Selecting existing participant:", pendingJoin.participantId);
          result = await selectParticipant(pendingJoin.participantId, pendingJoin.name, editorEmail);
        } else {
          console.log("Joining as new participant");
          result = await join(pendingJoin.name, undefined, editorEmail);
        }

        console.log("Join/select result:", result);

        // Go to step 1 after successful join (same pattern as host going to step 3)
        if (result.success) {
          console.log("Join successful, setting step to 1");
          clearPendingJoin(); // Only clear on success
          setStep(1);
          window.scrollTo(0, 0);
          clearPaymentParams();
        } else if (result.limitReached) {
          // Payment didn't process in time? Show paywall again
          console.log("Limit still reached after payment, showing paywall");
          clearPendingJoin(); // Clear to avoid infinite loop
          setSessionsUsed(result.sessionsUsed || 0);
          setShowPaywall(true);
          clearPaymentParams();
        } else {
          // Other failure - clear and show join screen
          console.log("Join failed for unknown reason");
          clearPendingJoin();
          clearPaymentParams();
        }
        return;
      }

      // Host payment: auto-finalize and go to step 3
      if (isOwner && session.status !== "finalized") {
        // Wait for email to be loaded from localStorage before finalizing
        // This ensures premium verification uses the correct email
        const storedUser = getStoredUser();
        if (!storedUser?.email && !userEmail) {
          // No email yet, wait for next render when email is loaded
          return;
        }

        console.log("Auto-finalizing after payment success, email:", userEmail || storedUser?.email);
        const result = await finalize();
        if (result.success) {
          setStep(3);
          window.scrollTo(0, 0);
          updateHostStep(3);
        }
        clearPaymentParams();
      }
    };
    handlePostPayment();
  }, [paymentSuccess, payerType, isOwner, session, finalize, router, updateHostStep, userEmail, join, selectParticipant, sessionId]);

  // Load auth providers when paywall is opened
  useEffect(() => {
    if (showPaywall && authProviders.length === 0) {
      getAuthProviders()
        .then((data) => setAuthProviders(data.providers))
        .catch(console.error);
    }
  }, [showPaywall, authProviders.length]);

  // Handle return from OAuth - show paywall with message if no premium
  useEffect(() => {
    if (returnedFromAuth && authIsPremium === "False") {
      setShowNoPremiumWarning(true);
      setShowPaywall(true);
      // Clean URL params
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("token");
      newUrl.searchParams.delete("user_id");
      newUrl.searchParams.delete("is_premium");
      router.replace(newUrl.pathname + newUrl.search, { scroll: false });
    }
  }, [returnedFromAuth, authIsPremium, router]);

  const t = getTranslator(lang);

  // Convert API types to billEngine types
  const items: Item[] = (session?.items || []).map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    price_as_shown: item.price_as_shown,
    quantity: item.quantity,
    mode: item.mode,
  }));

  // Use decimal_places from backend (OCR), fallback to detection
  const decimals = session?.decimal_places ?? detectDecimals(items);

  const priceMode = session?.price_mode || "unitario";

  const charges: Charge[] = (session?.charges || []).map((c) => ({
    id: c.id,
    name: c.name,
    value: c.value,
    valueType: c.valueType,
    isDiscount: c.isDiscount,
    distribution: c.distribution,
  }));

  const participants: Participant[] = (session?.participants || []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
  }));

  const assignments: Record<string, Assignment[]> = session?.assignments || {};

  // --- Handlers ---

  const handleJoin = async () => {
    if (!joinName.trim()) return;
    setJoining(true);
    setJoinError(null);

    const result = await join(joinName.trim());

    if (result.limitReached) {
      trackPaywallShown(sessionId);
      setSessionsUsed(result.sessionsUsed || 0);
      storePendingJoin(joinName.trim()); // Store name for after payment
      setShowPaywall(true);
    } else if (!result.success) {
      setJoinError("No se pudo unir. La sesión puede estar finalizada o no existe.");
    } else {
      // Successfully joined
      trackGuestJoined(sessionId, result.isNew || false);
    }

    setJoining(false);
  };

  const handleAddParticipant = () => {
    if (!newParticipantName.trim()) return;
    const name = newParticipantName.trim();
    // Close form immediately - optimistic update in useSession handles the rest
    setNewParticipantName("");
    setShowAddParticipant(false);
    // Fire and forget - useSession has optimistic update
    addParticipant(name);
    // Track person added
    trackPersonAdded(sessionId, (session?.participants?.length || 0) + 1);
  };

  const handleItemsChange = async (newItems: Item[]) => {
    markInteraction();
    // Find what changed
    for (const newItem of newItems) {
      const oldItem = items.find((i) => i.id === newItem.id);
      if (!oldItem) {
        // New item
        await addNewItem(newItem.name, newItem.price, newItem.quantity);
      } else if (
        oldItem.name !== newItem.name ||
        oldItem.price !== newItem.price ||
        oldItem.quantity !== newItem.quantity
      ) {
        // Updated item
        await updateItemById(newItem.id!, {
          name: newItem.name,
          price: newItem.price,
          quantity: newItem.quantity,
        });
      }
    }

    // Check for deleted items
    for (const oldItem of items) {
      if (!newItems.find((i) => i.id === oldItem.id)) {
        await deleteItemById(oldItem.id!);
      }
    }
  };

  const handleChargesChange = async (newCharges: Charge[]) => {
    markInteraction();
    await updateSessionCharges(
      newCharges.map((c) => ({
        id: c.id,
        name: c.name,
        value: c.value,
        valueType: c.valueType,
        isDiscount: c.isDiscount,
        distribution: c.distribution || "proportional",
      }))
    );
  };


  const handleFinalize = async () => {
    const result = await finalize();

    if (result.success) {
      // Track step 2 completion and session details
      trackStep2Complete(sessionId, session?.participants?.length || 0);
      trackSessionDetails(sessionId, {
        total: session?.total || 0,
        itemsCount: session?.items?.length || 0,
        personCount: session?.participants?.length || 0,
        hasCharges: (session?.charges?.length || 0) > 0,
      });

      setStep(3);
      window.scrollTo(0, 0);
      updateHostStep(3);
    } else if (result.limitReached) {
      // Host reached free session limit - show paywall
      trackPaywallShown(sessionId);
      setSessionsUsed(result.sessionsUsed || 0);
      setShowPaywall(true);
    }
  };

  const goToStep = async (newStep: number) => {
    // If owner goes back from step 3, reopen the session
    if (isOwner && step === 3 && newStep < 3) {
      await reopen();
    }

    // Track step completion
    if (newStep === 2 && step === 1) {
      trackStep1Complete(sessionId, session?.items?.length || 0);
    }

    setStep(newStep);
    window.scrollTo(0, 0);

    // Update host step so editors can follow along
    if (isOwner) {
      updateHostStep(newStep);
    }
  };

  // --- Render States ---

  // Loading - also show loading while waiting for auto-finalize/auto-join after payment
  const waitingForAutoFinalize = paymentSuccess && isOwner && session?.status !== "finalized";
  const waitingForAutoJoin = paymentSuccess && !isOwner && !currentParticipant && getPendingJoin() !== null;
  if (loading || waitingForAutoFinalize || waitingForAutoJoin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">
            {waitingForAutoFinalize ? "Finalizando..." : waitingForAutoJoin ? "Uniéndose..." : "Cargando sesión..."}
          </p>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    const isDeviceMismatch = error.includes("session_active_elsewhere");

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          {isDeviceMismatch ? (
            <>
              <div className="text-5xl mb-4">🔒</div>
              <h2 className="text-xl font-bold mb-2">{t("error.sessionActiveElsewhere")}</h2>
              <p className="text-muted-foreground mb-6">{t("error.sessionActiveElsewhereDesc")}</p>
              <Button onClick={() => window.location.href = `/s/${sessionId}`}>
                {t("error.joinAsGuest")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-destructive text-lg mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>{t("error.retry")}</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Need to join (not owner and no current participant, unless view-only mode)
  if (!isOwner && !currentParticipant && !isViewOnly) {
    // Filter out the owner from selectable participants (editors only)
    const selectableParticipants = (session?.participants || []).filter((p) => p.role !== "owner");

    // Paywall screen (shown when free session limit reached)
    if (showPaywall) {
      const handlePayment = () => {
        // Redirect to payment page with MercadoPago Bricks
        router.push(`/payment?session=${sessionId}&type=editor`);
      };

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
                            <h1 className="text-2xl font-bold mb-2">{t("paywall.title")}</h1>
              <p className="text-muted-foreground">{t("paywall.subtitle")}</p>
            </div>

            {/* Package Card */}
            <div className="bg-card rounded-2xl p-6 border-2 border-primary mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg">{t("paywall.packageName")}</h2>
                <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-1 rounded-full">
                  {t("paywall.bestValue")}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">✨</span>
                  <span className="text-sm font-medium">{t("paywall.unlimited")}</span>
                </div>
                <div className="flex items-center gap-2 pl-7">
                  <span className="text-sm text-muted-foreground">{t("paywall.unlimitedDesc")}</span>
                </div>
              </div>

              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold">{formatPriceCLP(premiumPrice)}</span>
              </div>

              <Button
                className="w-full h-12 font-semibold"
                onClick={handlePayment}
                disabled={paymentLoading}
              >
                {paymentLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  t("paywall.pay")
                )}
              </Button>

              {paymentError && (
                <p className="text-destructive text-sm text-center mt-2">
                  {paymentError}
                </p>
              )}
            </div>

            {/* Already have premium - Sign in option */}
            <div className="bg-card rounded-2xl p-4 border border-border mb-4">
              <p className="text-sm text-center text-muted-foreground mb-3">
                {t("paywall.alreadyHavePremium")}
              </p>
              {authProviders.length > 0 ? (
                <SignInButtons
                  providers={authProviders}
                  redirectTo={`${window.location.origin}/payment?session=${sessionId}&type=editor`}
                  variant="compact"
                />
              ) : (
                <div className="flex justify-center py-2">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            <button
              onClick={() => window.history.back()}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              {t("paywall.later")}
            </button>
          </div>
        </div>
      );
    }

    // Join screen - shown directly without phone verification
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">Bill-e</h1>
            <p className="text-muted-foreground">{t("join.title")}</p>
          </div>

          {/* Option 1: Select existing participant */}
          {selectableParticipants.length > 0 && (
            <div className="bg-card rounded-2xl p-6 border border-border mb-4">
              <p className="text-sm font-medium mb-4 text-center">
                {t("join.selectExisting")}
              </p>
              <div className="flex justify-center gap-3 flex-wrap">
                {selectableParticipants.map((p, pIndex) => (
                  <button
                    key={p.id}
                    onClick={async () => {
                      setSelectingParticipant(p.id);
                      const result = await selectParticipant(p.id, p.name);
                      setSelectingParticipant(null);
                      if (result.limitReached) {
                        setSessionsUsed(result.sessionsUsed || 0);
                        storePendingJoin(p.name, p.id); // Store for after payment
                        setShowPaywall(true);
                      }
                    }}
                    disabled={selectingParticipant !== null}
                    className={`participant-chip hover:opacity-80 transition-opacity cursor-pointer ${
                      selectingParticipant === p.id ? "opacity-50" : ""
                    }`}
                  >
                    <div
                      className="participant-avatar"
                      style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                    >
                      {selectingParticipant === p.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        getInitials(p.name)
                      )}
                    </div>
                    <span className="participant-name">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          {selectableParticipants.length > 0 && (
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{t("join.or")}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {/* Option 2: Create new participant */}
          <div className="bg-card rounded-2xl p-6 border border-border">
            <label className="block text-sm font-medium mb-2">{t("join.newName")}</label>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="Ej: Carlos"
              className="w-full px-4 py-3 bg-secondary rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary mb-4"
              autoFocus={selectableParticipants.length === 0}
            />
            <Button
              onClick={handleJoin}
              disabled={!joinName.trim() || joining}
              className="w-full h-12 font-semibold"
            >
              {joining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t("join.joinNew")
              )}
            </Button>
            {joinError && (
              <p className="text-destructive text-sm mt-3 text-center">{joinError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Host Paywall (shown when host reaches free session limit) ---
  if (isOwner && showPaywall) {
    const handleHostPayment = () => {
      // Redirect to payment page with MercadoPago Bricks
      const params = new URLSearchParams({
        session: sessionId,
        type: "host",
        ...(ownerToken ? { owner: ownerToken } : {}),
      });
      router.push(`/payment?${params.toString()}`);
    };

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold mb-2">{t("paywall.title")}</h1>
            <p className="text-muted-foreground">{t("paywall.subtitle")}</p>
          </div>

          {/* Package Card */}
          <div className="bg-card rounded-2xl p-6 border-2 border-primary mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{t("paywall.packageName")}</h2>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-1 rounded-full">
                {t("paywall.bestValue")}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <span className="text-sm font-medium">{t("paywall.unlimited")}</span>
              </div>
              <div className="flex items-center gap-2 pl-7">
                <span className="text-sm text-muted-foreground">{t("paywall.unlimitedDesc")}</span>
              </div>
            </div>

            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold">{formatPriceCLP(premiumPrice)}</span>
            </div>

            <Button
              className="w-full h-12 font-semibold"
              onClick={handleHostPayment}
              disabled={paymentLoading}
            >
              {paymentLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t("paywall.pay")
              )}
            </Button>

            {paymentError && (
              <p className="text-destructive text-sm text-center mt-2">
                {paymentError}
              </p>
            )}
          </div>

          {/* No premium message */}
          {showNoPremiumWarning && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 mb-4">
              <p className="text-sm text-center text-orange-400">
                {t("paywall.noPremiumLinked")}
              </p>
            </div>
          )}

          {/* Already have premium - Sign in option */}
          <div className="bg-card rounded-2xl p-4 border border-border mb-4">
            <p className="text-sm text-center text-muted-foreground mb-3">
              {showNoPremiumWarning ? t("paywall.tryAnotherAccount") : t("paywall.alreadyHavePremium")}
            </p>
            {authProviders.length > 0 ? (
              <SignInButtons
                providers={authProviders}
                redirectTo={`${window.location.origin}/s/${sessionId}${ownerToken ? `?owner=${ownerToken}` : ""}`}
                variant="compact"
              />
            ) : (
              <div className="flex justify-center py-2">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setShowPaywall(false);
              setShowNoPremiumWarning(false);
            }}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            {t("paywall.later")}
          </button>
        </div>
      </div>
    );
  }

  // --- Main Session View ---

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center">
            {/* Stepper container - takes remaining space, centers content */}
            <div className="flex-1 flex justify-center">
              <div className="flex items-center">
              {[
                { num: 1, label: t("steps.review") },
                { num: 2, label: t("steps.assign") },
                { num: 3, label: t("steps.share") },
              ].map((s, idx) => (
                <div key={s.num} className="flex items-center">
                  {/* Step */}
                  <button
                    className="flex flex-col items-center gap-1.5"
                    onClick={() => !isViewOnly && s.num <= step && goToStep(s.num)}
                    disabled={isViewOnly || s.num > step}
                  >
                    {/* Circle */}
                    <span
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all ${
                        s.num === step
                          ? "bg-primary text-white shadow-[0_0_0_4px_rgba(59,130,246,0.2)]"
                          : s.num < step
                          ? "bg-primary/30 text-primary"
                          : "bg-secondary text-muted-foreground/40"
                      }`}
                    >
                      {s.num}
                    </span>
                    {/* Label */}
                    <span
                      className={`text-base font-medium flex items-center gap-1 ${
                        s.num === step
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {s.num < step && <span className="text-primary text-xs">✓</span>}
                      {s.label}
                    </span>
                  </button>
                  {/* Line between steps */}
                  {idx < 2 && (
                    <div
                      className={`w-8 h-0.5 mx-1.5 mb-6 rounded-full ${
                        s.num < step ? "bg-primary/50" : "bg-secondary"
                      }`}
                    />
                  )}
                </div>
              ))}
              </div>
            </div>

            {/* Right column: Language + Role + Sessions */}
            <div className="flex flex-col items-end gap-0.5">
              <button
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setLang(lang === "es" ? "en" : "es")}
              >
                {lang === "es" ? "EN" : "ES"}
              </button>
              <span className="text-xs text-primary/60">
                {isOwner ? "Host" : currentParticipant?.name || "Editor"}
              </span>
              {isOwner && session?.host_sessions_limit && !session?.host_is_premium && (
                <span className="text-[10px] text-muted-foreground/60">
                  {session.host_sessions_used}/{session.host_sessions_limit}
                </span>
              )}
              {isOwner && session?.host_is_premium && (
                <span className="text-[10px] text-primary/60">Premium</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6">
        {/* Step 1: Review (only for owner) */}
        {step === 1 && isOwner && (
          <StepReview
            items={items}
            charges={charges}
            originalSubtotal={session?.subtotal}
            originalTotal={session?.total}
            priceMode={priceMode}
            onOriginalSubtotalChange={updateOriginalSubtotal}
            onOriginalTotalChange={updateOriginalTotal}
            onItemsChange={handleItemsChange}
            onChargesChange={handleChargesChange}
            onNext={() => goToStep(2)}
            t={t}
          />
        )}

        {/* Step 1: Read-only view (for participants) */}
        {step === 1 && !isOwner && (
          <div className="step-animate">
            {/* Info banner */}
            <div className={`rounded-xl p-3 mb-4 flex items-center gap-3 ${hostStep > 1 ? "bg-green-500/10" : "bg-primary/10"}`}>
              {hostStep > 1 ? (
                <>
                  <span className="text-green-500 text-lg">✓</span>
                  <p className="text-sm text-muted-foreground">
                    {t("editor.hostReady")}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {t("editor.hostVerifying")}
                  </p>
                </>
              )}
            </div>

            {/* Read-only items list */}
            <div className="bg-card rounded-2xl p-4 mb-4">
              {items.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  {t("editor.noItemsYet")}
                </p>
              ) : (
                items.map((item) => {
                  const qty = item.quantity || 1;
                  const unitPrice = item.price || 0;
                  const lineTotal = unitPrice * qty;
                  const displayPrice = priceMode === "total_linea" ? lineTotal : unitPrice;

                  return (
                    <div key={item.id || item.name} className="breakdown-row">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-primary font-semibold w-8 text-center">{qty}</span>
                        <span className="truncate">{item.name}</span>
                      </div>
                      <span className="font-semibold tabular-nums">{formatCurrency(displayPrice, decimals)}</span>
                    </div>
                  );
                })
              )}

              {/* Subtotal */}
              {items.length > 0 && (
                <div className="breakdown-row subtotal">
                  <span>{t("totals.subtotal")}</span>
                  <span>{formatCurrency(items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0), decimals)}</span>
                </div>
              )}
            </div>

            {/* Charges (read-only) */}
            {charges.length > 0 && (
              <div className="bg-card rounded-2xl p-4 mb-4">
                <div className="mb-2">
                  <span className="text-xs text-foreground uppercase tracking-wide">{t("charges.sectionTitle")}</span>
                </div>
                {charges.map((charge) => {
                  const subtotal = items.reduce((sum, item) => sum + (item.quantity || 1) * (item.price || 0), 0);
                  const amount = charge.valueType === "percent"
                    ? (subtotal * charge.value) / 100
                    : charge.value;

                  return (
                    <div key={charge.id} className={`breakdown-row charge ${charge.isDiscount ? "discount" : ""}`}>
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="truncate">{charge.name}</span>
                        <span className="text-xs opacity-70 shrink-0">
                          ({charge.value}{charge.valueType === "percent" ? "%" : "$"})
                        </span>
                      </span>
                      <span className="font-semibold shrink-0 ml-2">
                        {charge.isDiscount ? "-" : "+"}{formatCurrency(amount, decimals)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Continue button - only enabled when host is on step 2+ */}
            <div className="mt-8">
              <Button
                size="lg"
                className="w-full h-12 text-base font-semibold"
                onClick={() => goToStep(2)}
                disabled={hostStep < 2}
              >
                {hostStep < 2 ? t("editor.waitingForHost") : t("steps.goToAssign")}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Assign */}
        {step === 2 && (
          <>
            {/* Info banner for editors */}
            {!isOwner && (
              <div className={`rounded-xl p-3 mb-4 flex items-center gap-3 ${session?.status === "finalized" ? "bg-green-500/10" : "bg-primary/10"}`}>
                {session?.status === "finalized" ? (
                  <>
                    <span className="text-green-500 text-lg">✓</span>
                    <p className="text-sm text-muted-foreground">
                      {t("editor.hostFinalized")}
                    </p>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      {t("editor.hostAssigning")}
                    </p>
                  </>
                )}
              </div>
            )}
            <StepAssign
            items={items}
            participants={participants}
            assignments={assignments}
            onUpdateQty={updateAssignmentQty}
            onUpdateItemMode={(itemId, mode) => updateItemById(itemId, { mode })}
            onBack={() => goToStep(1)}
            onNext={isOwner ? handleFinalize : () => goToStep(3)}
            t={t}
            isOwner={isOwner}
            showAddParticipant={showAddParticipant}
            newParticipantName={newParticipantName}
            onNewParticipantNameChange={setNewParticipantName}
            onAddParticipant={handleAddParticipant}
            onToggleAddParticipant={setShowAddParticipant}
            onRemoveParticipant={removeParticipantById}
            currentParticipantId={currentParticipant?.id}
            onUpdateParticipantName={updateParticipantName}
            nextDisabled={!isOwner && session?.status !== "finalized"}
            nextLabel={!isOwner && session?.status !== "finalized" ? t("editor.waitingForHost") : undefined}
            sessionId={sessionId}
            />
          </>
        )}

        {/* Step 3: Share */}
        {step === 3 && (
          <StepShare
            items={items}
            charges={charges}
            participants={participants}
            assignments={assignments}
            onBack={isViewOnly ? undefined : () => goToStep(2)}
            t={t}
            isOwner={isOwner}
            sessionId={sessionId}
          />
        )}
      </main>
    </div>
  );
}
