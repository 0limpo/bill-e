"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { StepReview } from "@/components/steps/StepReview";
import { StepAssign } from "@/components/steps/StepAssign";
import { StepShare } from "@/components/steps/StepShare";
import { getTranslator, detectLanguage, type Language } from "@/lib/i18n";
import { formatCurrency, detectDecimals, getAvatarColor, getInitials, calculateParticipantTotal, type Item, type Charge, type Participant, type Assignment, type Session } from "@/lib/billEngine";
import { startPaymentFlow, formatPriceCLP, formatPriceUSD, PREMIUM_PRICE_USD } from "@/lib/payment";
import { getCountryCode, getPaymentRail, type PaymentRail } from "@/lib/geo";
import { getStoredToken, getStoredUser, setStoredUser, getAuthProviders, handleAuthCallback, verifyToken, refreshStoredUser, type AuthProvider } from "@/lib/auth";
import { updateBillName, enterShare } from "@/lib/api";
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
  const isViewOnlyParam = viewMode === "results";
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

  // Avatar picture for header. Null until we know there's no Google
  // session — undefined would render an empty initials avatar even for
  // logged-in users until the SSR/hydration race resolves.
  const [userPicture, setUserPicture] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const user = getStoredUser();
      return user?.picture_url || null;
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

  const [step, setStep] = useState(isViewOnlyParam ? 3 : 1);
  const [lang, setLang] = useState<Language>("es");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  // Bill name
  const [billName, setBillName] = useState<string>("");
  const billNameInitialized = useRef(false);

  // Free-tier paywall state
  const [showPaywall, setShowPaywall] = useState(false);
  const [sessionsUsed, setSessionsUsed] = useState(0);
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  // Initialize from getStoredUser so the header tier badge ("free"/"pro")
  // reflects the user's status from step 1, not only after enter-share
  // fires at step 3.
  const [isPremium, setIsPremium] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return getStoredUser()?.is_premium === true;
    }
    return false;
  });
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [premiumPrice] = useState(PREMIUM_PRICE_USD);
  const [selectingParticipant, setSelectingParticipant] = useState<string | null>(null);

  // Geo gate for paywall: Chile is blocked until boleta electrónica is live.
  const [paymentRail, setPaymentRail] = useState<PaymentRail | "detecting">("detecting");
  useEffect(() => {
    let cancelled = false;
    getCountryCode().then((country) => {
      if (cancelled) return;
      setPaymentRail(getPaymentRail(country));
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Host post-finalize sign-in pitch (one-time, dismissible, localStorage-gated)
  const [showHostSignInPitch, setShowHostSignInPitch] = useState(false);

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
    regroupAllItems,
    updateSessionCharges,
    updateOriginalSubtotal,
    updateOriginalTotal,
    finalize,
    reopen,
    markInteraction,
    updateHostStep,
    billCostShared,
    updateBillCostShared,
  } = useSession({
    sessionId,
    ownerToken,
    ownerEmail: userEmail,
    pollInterval: 5000,
    interactionPause: 15000,
  });

  // View-only: either from URL param or snapshot from PostgreSQL
  const isViewOnly = isViewOnlyParam || (session?.is_snapshot ?? false);

  // Detect language
  useEffect(() => {
    setLang(detectLanguage());
  }, []);

  // If session is already finalized or is a snapshot, go directly to step 3
  useEffect(() => {
    if ((session?.status === "finalized" || session?.is_snapshot) && step !== 3) {
      setStep(3);
    }
  }, [session?.status, session?.is_snapshot, step]);

  // Free-tier hook: fire once on the first transition into step 3. Counts
  // this session against the user/device tally (idempotent server-side).
  // View-only/snapshot revisits are skipped — the counter is for the 1st
  // time the participant reaches share, not for re-opening a saved bill.
  const enterShareDoneRef = useRef(false);
  useEffect(() => {
    if (step !== 3) return;
    if (enterShareDoneRef.current) return;
    if (!session) return;
    if (isViewOnly) return;
    enterShareDoneRef.current = true;
    (async () => {
      try {
        const userId = getStoredUser()?.id;
        const result = await enterShare(sessionId, userId, userEmail || undefined);
        setIsPremium(result.is_premium);
        setFreeRemaining(result.free_remaining);
        if (!result.allowed) {
          trackPaywallShown(sessionId);
          setSessionsUsed(result.sessions_used);
          setShowPaywall(true);
        }
      } catch (e) {
        // Non-fatal: a transient failure shouldn't trap the user at p3.
        // PR 4 will surface a retry path if free_remaining stays null.
        console.warn("enter-share failed:", e);
      }
    })();
  }, [step, session, isViewOnly, sessionId, userEmail]);

  // Editor entry: once an editor has a participant, save the session as
  // "recent" (so the home page Continue button works for editors too) and
  // skip the read-only step 1 by jumping to step 2. Fires once per mount.
  const editorEntryDoneRef = useRef(false);
  useEffect(() => {
    if (editorEntryDoneRef.current) return;
    if (isOwner) return;
    if (!currentParticipant) return;
    if (isViewOnly) return;
    editorEntryDoneRef.current = true;
    try {
      localStorage.setItem(
        "bill-e-recent-session",
        JSON.stringify({
          sessionId,
          ownerToken: "",
          role: "editor",
          createdAt: Date.now(),
        }),
      );
    } catch {}
    if (step === 1) setStep(2);
  }, [isOwner, currentParticipant, isViewOnly, sessionId, step]);

  // Sync bill name from session (only on initial load)
  useEffect(() => {
    if (session?.bill_name && !billNameInitialized.current) {
      setBillName(session.bill_name);
      billNameInitialized.current = true;
    }
  }, [session?.bill_name]);

  // After a successful payment (Polar / MP), the cached user in localStorage
  // still has stale is_premium=false. Re-verify the token so the rest of
  // this page sees the fresh value before any guards run.
  useEffect(() => {
    if (!paymentSuccess) return;
    let cancelled = false;
    (async () => {
      const fresh = await refreshStoredUser();
      if (cancelled || !fresh) return;
      // Sync the page's premium/picture state with the refreshed user
      // so the header badge flips to "pro" immediately post-payment
      // (the polled enter-share would also do this at p3, but the
      // user-visible header is on every step).
      setIsPremium(fresh.is_premium === true);
      setUserPicture(fresh.picture_url || null);
      setUserEmail(fresh.email || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentSuccess]);

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

      // Editor payment: auto-join with stored name, then go to step 2.
      const pendingJoin = getPendingJoin();
      if (pendingJoin) {
        const storedUser = getStoredUser();
        const editorEmail = storedUser?.email || undefined;

        // Polar redirects the user the moment payment is recorded — the
        // webhook that grants premium can lag a couple of seconds. Retry
        // the join with backoff so a transient limitReached doesn't bounce
        // a paid user back to the paywall.
        const tryJoin = () =>
          pendingJoin.participantId
            ? selectParticipant(pendingJoin.participantId, pendingJoin.name, editorEmail)
            : join(pendingJoin.name, undefined, editorEmail);

        let result = await tryJoin();
        for (let attempt = 1; attempt < 5 && !result.success && result.limitReached; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          result = await tryJoin();
        }

        if (result.success) {
          clearPendingJoin();
          setStep(2);
          window.scrollTo(0, 0);
        } else if (result.limitReached) {
          // Webhook still hasn't landed after several retries — fall back
          // to the paywall so the user isn't left in a frozen state.
          clearPendingJoin();
          setSessionsUsed(result.sessionsUsed || 0);
          setShowPaywall(true);
        } else {
          clearPendingJoin();
        }
        clearPaymentParams();
        return;
      }

      // Host payment: advance to step 3 immediately and finalize in the
      // background. Going to step 3 unconditionally avoids stranding a paid
      // user at step 1 while the webhook is still propagating premium.
      if (isOwner && session.status !== "finalized") {
        const storedUser = getStoredUser();
        if (!storedUser?.email && !userEmail) {
          // Email not yet loaded from localStorage — wait for re-render.
          return;
        }

        setStep(3);
        window.scrollTo(0, 0);
        updateHostStep(3);

        // Best-effort finalize with retries to cover the webhook race.
        let result = await finalize();
        for (let attempt = 1; attempt < 5 && !result.success && result.limitReached; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          result = await finalize();
        }
        clearPaymentParams();
      }
    };
    handlePostPayment();
  }, [paymentSuccess, payerType, isOwner, session, finalize, router, updateHostStep, userEmail, join, selectParticipant, sessionId]);

  // Load auth providers when paywall opens, editor is on landing without auth, or host pitch shows
  useEffect(() => {
    const onEditorLanding = !isOwner && !currentParticipant && !isViewOnlyParam && !userEmail;
    if ((showPaywall || onEditorLanding || showHostSignInPitch) && authProviders.length === 0) {
      getAuthProviders()
        .then((data) => setAuthProviders(data.providers))
        .catch(console.error);
    }
  }, [showPaywall, isOwner, currentParticipant, isViewOnlyParam, userEmail, showHostSignInPitch, authProviders.length]);

  // Trigger host sign-in pitch on first finalized session (host only, anonymous, dismissed-once)
  useEffect(() => {
    if (
      isOwner &&
      !userEmail &&
      session?.status === "finalized" &&
      typeof window !== "undefined" &&
      !localStorage.getItem("host_signin_pitch_shown")
    ) {
      setShowHostSignInPitch(true);
    }
  }, [isOwner, userEmail, session?.status]);

  const dismissHostSignInPitch = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("host_signin_pitch_shown", "1");
    }
    setShowHostSignInPitch(false);
  };

  // Process OAuth return: verify token, store user, update local state, clean URL.
  // Runs for both editor (sign-in from landing) and host (sign-in from paywall).
  useEffect(() => {
    if (!returnedFromAuth) return;
    const cb = handleAuthCallback();
    const token = cb?.token;
    if (!token) return;
    let cancelled = false;
    (async () => {
      const verified = await verifyToken(token);
      if (cancelled) return;
      if (verified) {
        setStoredUser(verified);
        setUserEmail(verified.email);
        setUserPicture(verified.picture_url || null);
        setIsPremium(verified.is_premium === true);
      }
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("token");
      newUrl.searchParams.delete("user_id");
      newUrl.searchParams.delete("is_premium");
      router.replace(newUrl.pathname + newUrl.search, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [returnedFromAuth, router]);

  // Post-OAuth bypass flow: when the user signs in from the paywall trying
  // to recover an existing premium subscription, we either:
  //  - is_premium=False  → keep the paywall open with a "no premium linked"
  //                        warning so they know which account to try.
  //  - is_premium=True   → premium recognized; close the paywall and
  //                        finish what they were trying to do (host:
  //                        finalize and go to step 3; editor: auto-join
  //                        with the name they had typed).
  // Editors signing in from the landing (just to save history) have no
  // pending action and fall through harmlessly.
  useEffect(() => {
    if (!returnedFromAuth) return;
    if (!session) return;

    if (authIsPremium === "False") {
      if (isOwner) {
        setShowNoPremiumWarning(true);
        setShowPaywall(true);
      }
      return;
    }

    if (authIsPremium !== "True") return;

    if (isOwner) {
      setShowPaywall(false);
      setShowNoPremiumWarning(false);
      if (session.status !== "finalized") {
        setStep(3);
        window.scrollTo(0, 0);
        updateHostStep(3);
        finalize().catch(() => {});
      }
      return;
    }

    // Editor came back from paywall sign-in with premium recognized.
    const pj = getPendingJoin();
    if (pj && !currentParticipant) {
      const stored = getStoredUser();
      const editorEmail = stored?.email || undefined;
      const tryJoin = pj.participantId
        ? selectParticipant(pj.participantId, pj.name, editorEmail)
        : join(pj.name, undefined, editorEmail);
      tryJoin.then((result) => {
        if (result.success) {
          clearPendingJoin();
          setShowPaywall(false);
          setShowNoPremiumWarning(false);
          setStep(2);
          window.scrollTo(0, 0);
        }
      });
    }
  }, [returnedFromAuth, authIsPremium, isOwner, session, currentParticipant, finalize, join, selectParticipant, updateHostStep]);

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

  // Use the max of backend decimal_places and what the items actually need.
  // ?? alone fails when backend returns 0 (default) but items have decimals,
  // which made the host see CLP-style integers while editors saw the decimals.
  const decimals = Math.max(session?.decimal_places ?? 0, detectDecimals(items));

  const priceMode = session?.price_mode || "unitario";

  const charges: Charge[] = (session?.charges || []).map((c) => ({
    id: c.id,
    name: c.name,
    value: c.value,
    valueType: c.valueType,
    isDiscount: c.isDiscount,
    distribution: c.distribution,
    included_in_items: c.included_in_items,
    is_suggested: c.is_suggested,
  }));

  const itemsIncludeCharges = session?.items_include_charges ?? false;

  const participants: Participant[] = (session?.participants || []).map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    paid_at: (p as { paid_at?: string | null }).paid_at ?? null,
  }));

  const assignments: Record<string, Assignment[]> = session?.assignments || {};

  // --- Handlers ---

  const handleBillNameChange = (name: string) => {
    setBillName(name);
    if (ownerToken) {
      updateBillName(sessionId, ownerToken, name).catch(() => {});
    }
  };

  const handleJoin = async () => {
    if (!joinName.trim()) return;
    setJoining(true);
    setJoinError(null);

    const result = await join(joinName.trim());

    if (result.limitReached) {
      // Editor hit the free-tier cap. Show paywall before they invest
      // any time editing — store the pending name so we can resume the
      // join automatically once they pay.
      trackPaywallShown(sessionId);
      setSessionsUsed(result.sessionsUsed || 0);
      storePendingJoin(joinName.trim());
      setShowPaywall(true);
    } else if (!result.success) {
      setJoinError(t("session.joinError"));
    } else {
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
        oldItem.quantity !== newItem.quantity ||
        oldItem.price_as_shown !== newItem.price_as_shown
      ) {
        // Updated item — include price_as_shown so the displayed value
        // (which the editor uses as source of truth) actually changes.
        await updateItemById(newItem.id!, {
          name: newItem.name,
          price: newItem.price,
          price_as_shown: newItem.price_as_shown,
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
      // Paywall (if cap reached) fires from the enter-share effect above.
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
            {waitingForAutoFinalize ? t("session.loadingFinalizing") : waitingForAutoJoin ? t("session.loadingJoining") : t("session.loadingSession")}
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
      // Geo gate: Chile is blocked until boleta SII integration ships.
      if (paymentRail === "detecting") {
        return (
          <div className="min-h-screen bg-background flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        );
      }
      if (paymentRail === "blocked") {
        return (
          <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="w-full max-w-sm text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-5">
                <span className="text-3xl">🌎</span>
              </div>
              <h1 className="text-xl font-semibold mb-3">{t("payment.notAvailableTitle")}</h1>
              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                {t("payment.notAvailableSubtitleChile")}
              </p>
              <button
                onClick={() => window.history.back()}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
              >
                {t("paywall.later")}
              </button>
            </div>
          </div>
        );
      }

      const handlePayment = () => {
        // Redirect to payment page → Polar checkout. Propagate the
        // `country` override (used during international testing) so the
        // /payment page lands on the same payment rail as this paywall.
        const country = typeof window !== "undefined"
          ? new URL(window.location.href).searchParams.get("country")
          : null;
        const params = new URLSearchParams({ session: sessionId, type: "editor" });
        if (country) params.set("country", country);
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
                <span className="text-3xl font-bold">{formatPriceUSD(premiumPrice)}</span>
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

            {/* Sign in to save history (editor paywall) */}
            <div className="bg-card rounded-2xl p-4 border border-border mb-4">
              <p className="text-sm text-center text-muted-foreground mb-3">
                {t("paywall.saveHistory")}
              </p>
              {authProviders.length > 0 ? (
                <SignInButtons
                  providers={authProviders}
                  redirectTo={`${window.location.origin}/payment?session=${sessionId}&type=editor`}
                  variant="compact"
                  t={t}
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

          {/* Sign-in pitch (only if not logged in) */}
          {!userEmail && (
            <div className="bg-card rounded-2xl p-4 border border-border mb-4">
              <p className="text-sm font-medium text-center mb-1">
                {t("join.signInPitchTitle")}
              </p>
              <p className="text-xs text-muted-foreground text-center mb-3">
                {t("join.signInPitchSubtitle")}
              </p>
              {authProviders.length > 0 ? (
                <SignInButtons
                  providers={authProviders}
                  redirectTo={typeof window !== "undefined" ? window.location.href : ""}
                  variant="compact"
                  t={t}
                />
              ) : (
                <div className="flex justify-center py-2">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}

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
              placeholder={t("session.namePlaceholder")}
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
    // Geo gate: Chile is blocked until boleta SII integration ships.
    if (paymentRail === "detecting") {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (paymentRail === "blocked") {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-sm text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <span className="text-3xl">🌎</span>
            </div>
            <h1 className="text-xl font-semibold mb-3">{t("payment.notAvailableTitle")}</h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-8">
              {t("payment.notAvailableSubtitleChile")}
            </p>
            <button
              onClick={() => window.history.back()}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
            >
              {t("paywall.later")}
            </button>
          </div>
        </div>
      );
    }

    // Calculate Bill-e cost sharing amounts (USD, 2 decimals)
    const participantCount = participants.length;
    const canDivideBillCost = participantCount >= 2;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const billCostPerPerson = canDivideBillCost ? round2(premiumPrice / participantCount) : 0;
    // Total transferred to the host by the other N-1 participants
    const hostRecovery = canDivideBillCost ? round2(billCostPerPerson * (participantCount - 1)) : 0;
    // Host's actual share — absorbs the rounding residual so Σ === totalAmount exactly
    const billCostForHost = canDivideBillCost ? round2(premiumPrice - hostRecovery) : 0;

    // Find a sample "other" participant name for preview
    const otherParticipant = participants.find((p) => p.id !== session?.participants?.find((sp) => sp.role === "owner")?.id);
    const otherParticipantName = otherParticipant?.name || "Participante";

    const handleHostPayment = async () => {
      // Save bill cost sharing preference before redirecting to payment
      if (canDivideBillCost) {
        await updateBillCostShared(billCostShared);
      }
      // Propagate the `country` override (used during international testing)
      // so the /payment page lands on the same payment rail as this paywall.
      const country = typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("country")
        : null;
      const params = new URLSearchParams({
        session: sessionId,
        type: "host",
        ...(ownerToken ? { owner: ownerToken } : {}),
        ...(country ? { country } : {}),
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
              <span className="text-3xl font-bold">{formatPriceUSD(premiumPrice)}</span>
            </div>

            {/* Divide Bill-e toggle - only show if 2+ participants */}
            {canDivideBillCost && (
              <div className="mb-4 p-3 bg-secondary/50 rounded-xl">
                <label className="flex items-start justify-between cursor-pointer gap-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span id="divide-billE-label" className="text-sm font-medium">
                      {t("paywall.divideBillE")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatPriceUSD(premiumPrice)} ÷ {participantCount} ={" "}
                      <strong className="text-foreground font-semibold">
                        {formatPriceUSD(billCostPerPerson)}
                      </strong>{" "}
                      {t("paywall.eachPays")}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={billCostShared}
                    aria-labelledby="divide-billE-label"
                    onClick={() => updateBillCostShared(!billCostShared)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                      billCostShared ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        billCostShared ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>

                {/* Preview: cards based on the host's REAL totals */}
                {billCostShared && (() => {
                  const hostParticipant = session?.participants?.find((p) => p.role === "owner");
                  const hostName = hostParticipant?.name || t("session.host");
                  const hostId = hostParticipant?.id;

                  const previewSession: Session = { items, charges, participants, assignments };

                  const hostBaseTotal = hostId
                    ? calculateParticipantTotal(hostId, previewSession).total
                    : 0;
                  const otherBaseTotal = otherParticipant?.id
                    ? calculateParticipantTotal(otherParticipant.id, previewSession).total
                    : 0;

                  // Fallback to per-capita average if no items assigned yet
                  const tableTotal = participants.reduce((sum, p) => {
                    return sum + calculateParticipantTotal(p.id, previewSession).total;
                  }, 0);
                  const avgPerPerson = participantCount > 0 ? Math.round(tableTotal / participantCount) : 0;

                  const hostDisplayBase = hostBaseTotal > 0 ? hostBaseTotal : avgPerPerson;
                  const otherDisplayBase = otherBaseTotal > 0 ? otherBaseTotal : avgPerPerson;

                  // Same math as StepShare: host absorbs rounding residual, others pay billCostPerPerson
                  const hostFinalTotal = hostDisplayBase + billCostForHost;
                  const otherFinalTotal = otherDisplayBase + billCostPerPerson;

                  return (
                    <div className="mt-3 space-y-2">
                      {/* Host card */}
                      <div className="bg-card rounded-lg border border-border overflow-hidden">
                        <div className="flex items-center justify-between p-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                              style={{ backgroundColor: getAvatarColor(hostName, 0) }}
                            >
                              {getInitials(hostName)}
                            </div>
                            <span className="text-sm font-medium">{hostName} ({t("paywall.you")})</span>
                          </div>
                          <span className="text-sm font-semibold">{formatCurrency(hostFinalTotal, decimals)}</span>
                        </div>
                        <div className="px-3 pb-2 pt-0 text-xs space-y-1">
                          <div className="flex justify-between text-muted-foreground">
                            <span>{t("totals.subtotal")}</span>
                            <span>{formatCurrency(hostDisplayBase, decimals)}</span>
                          </div>
                          <div className="flex justify-between text-orange-500">
                            <span>{t("share.billECost")}</span>
                            <span>+{formatCurrency(billCostForHost, decimals)}</span>
                          </div>
                          <div className="flex justify-between font-semibold border-t border-border/30 pt-1 mt-1">
                            <span>{t("items.total")}</span>
                            <span>{formatCurrency(hostFinalTotal, decimals)}</span>
                          </div>
                          <div className="mt-2 px-2.5 py-1.5 bg-primary/10 border border-primary/25 rounded-md text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1">
                            <span className="text-primary font-semibold flex-shrink-0" aria-hidden="true">i</span>
                            <span>
                              {t("share.billEHostNote")
                                .replace("{paid}", formatCurrency(premiumPrice, decimals))
                                .replace("{recovered}", formatCurrency(hostRecovery, decimals))}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Other participant card */}
                      <div className="bg-card rounded-lg border border-border overflow-hidden">
                        <div className="flex items-center justify-between p-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                              style={{ backgroundColor: getAvatarColor(otherParticipantName, 1) }}
                            >
                              {getInitials(otherParticipantName)}
                            </div>
                            <span className="text-sm font-medium">{otherParticipantName}</span>
                          </div>
                          <span className="text-sm font-semibold">{formatCurrency(otherFinalTotal, decimals)}</span>
                        </div>
                        <div className="px-3 pb-2 pt-0 text-xs space-y-1">
                          <div className="flex justify-between text-muted-foreground">
                            <span>{t("totals.subtotal")}</span>
                            <span>{formatCurrency(otherDisplayBase, decimals)}</span>
                          </div>
                          <div className="flex justify-between text-orange-500">
                            <span>{t("share.billECost")}</span>
                            <span>+{formatCurrency(billCostPerPerson, decimals)}</span>
                          </div>
                          <div className="flex justify-between font-semibold border-t border-border/30 pt-1 mt-1">
                            <span>{t("items.total")}</span>
                            <span>{formatCurrency(otherFinalTotal, decimals)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

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
                t={t}
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
      {/* Host post-finalize sign-in pitch (one-time, dismissible) */}
      {showHostSignInPitch && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl p-6 max-w-sm w-full border border-border">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">✨</div>
              <h2 className="text-xl font-bold mb-2">{t("host.pitchTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("host.pitchSubtitle")}</p>
            </div>
            {authProviders.length > 0 ? (
              <SignInButtons
                providers={authProviders}
                redirectTo={typeof window !== "undefined" ? window.location.href : ""}
                variant="default"
                t={t}
              />
            ) : (
              <div className="flex justify-center py-2">
                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <button
              onClick={dismissHostSignInPitch}
              className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground"
            >
              {t("host.pitchDismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      {(() => {
        // Identity displayed in the right-side avatar. For the host we
        // pull the live participant name (defaults to "Host" until they
        // rename themselves in step 2), so the initials track edits.
        // We also resolve the participant INDEX so the avatar color
        // matches the same person's color in the step-2/step-3 list
        // (getAvatarColor is keyed by index, not name hash).
        const ownerIdx = session?.participants?.findIndex((p) => p.role === "owner") ?? -1;
        const meIdx = isOwner
          ? ownerIdx
          : currentParticipant
            ? session?.participants?.findIndex((p) => p.id === currentParticipant.id) ?? -1
            : -1;
        const me = meIdx >= 0 ? session?.participants?.[meIdx] : null;
        const meName = me?.name || (isOwner ? t("session.host") : t("session.editor"));
        const roleLabel = isOwner ? t("session.host") : t("session.editor");
        const tierLabel = isPremium ? "pro" : "free";
        return (
          <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
            <div className="max-w-md mx-auto px-4 py-3">
              <div className="flex items-start">
                {/* Left: Bill-e logo + free/pro tier */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <Link
                    href="/"
                    className="flex items-center justify-center w-8 h-8 bg-primary rounded-full text-white font-bold text-sm"
                  >
                    B
                  </Link>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${isPremium ? "text-primary" : "text-muted-foreground"}`}>
                    {tierLabel}
                  </span>
                </div>

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
                        className="flex flex-col items-center gap-1 w-[60px]"
                        onClick={() => !isViewOnly && s.num <= step && goToStep(s.num)}
                        disabled={isViewOnly || s.num > step}
                      >
                        {/* Circle */}
                        <span
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                            s.num === step
                              ? "bg-primary text-white shadow-[0_0_0_3px_rgba(59,130,246,0.2)]"
                              : s.num < step
                              ? "bg-primary/30 text-primary"
                              : "bg-secondary text-muted-foreground/40"
                          }`}
                        >
                          {s.num}
                        </span>
                        {/* Label */}
                        <span
                          className={`text-xs font-medium flex items-center justify-center gap-0.5 ${
                            s.num === step
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          {s.num < step && <span className="text-primary text-[10px]">✓</span>}
                          {s.label}
                        </span>
                      </button>
                      {/* Line between steps */}
                      {idx < 2 && (
                        <div
                          className={`w-6 h-0.5 mx-1 mb-5 rounded-full ${
                            s.num < step ? "bg-primary/50" : "bg-secondary"
                          }`}
                        />
                      )}
                    </div>
                  ))}
                  </div>
                </div>

                {/* Right: avatar + role label */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  {userPicture ? (
                    <img
                      src={userPicture}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
                      style={{ backgroundColor: getAvatarColor(meName, meIdx >= 0 ? meIdx : undefined) }}
                    >
                      {getInitials(meName)}
                    </div>
                  )}
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {roleLabel}
                  </span>
                </div>
              </div>
            </div>
          </header>
        );
      })()}

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-6">
        {/* Step 1: Review (only for owner) */}
        {step === 1 && isOwner && (
          <StepReview
            items={items}
            charges={charges}
            originalSubtotal={session?.subtotal}
            originalTotal={session?.total}
            itemsIncludeCharges={itemsIncludeCharges}
            priceMode={priceMode}
            onOriginalSubtotalChange={updateOriginalSubtotal}
            onOriginalTotalChange={updateOriginalTotal}
            onItemsChange={handleItemsChange}
            onChargesChange={handleChargesChange}
            onNext={() => goToStep(2)}
            t={t}
            billName={billName}
            onBillNameChange={handleBillNameChange}
            onRescan={() => router.push("/")}
            onRegroup={(mode) => regroupAllItems(mode)}
            decimals={decimals}
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
            nextDisabled={!isOwner}
            nextLabel={!isOwner ? t("editor.waitingForHost") : undefined}
            sessionId={sessionId}
            decimals={decimals}
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
            onBack={isViewOnly ? () => router.push("/bills") : () => goToStep(2)}
            onBackToBills={undefined}
            t={t}
            isOwner={isOwner}
            sessionId={sessionId}
            billCostShared={billCostShared}
            premiumPrice={premiumPrice}
            ownerParticipantId={session?.participants?.find((p) => p.role === "owner")?.id}
            decimals={decimals}
            isSnapshot={(session?.is_snapshot ?? false) || session?.status === "finalized"}
            freeRemaining={freeRemaining}
            isPremium={isPremium}
          />
        )}
      </main>
    </div>
  );
}
