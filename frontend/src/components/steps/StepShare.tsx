"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronDown, Share2, Copy, Check, Mail, MessageCircle, Send, MoreHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  detectDecimals,
  getAvatarColor,
  getInitials,
  calculateParticipantTotal,
  type Item,
  type Charge,
  type Participant,
  type Assignment,
  type Session,
} from "@/lib/billEngine";
import { trackShare, trackTipWidgetShown } from "@/lib/tracking";
import { toggleParticipantPaid, getDeviceId, getSessionTip, type SessionTip } from "@/lib/api";
import { getStoredToken, isSupporter, getStoredUser } from "@/lib/auth";
import { TipWidget } from "@/components/TipWidget";
import { type Language } from "@/lib/i18n";
import { getLocalFx } from "@/lib/fx";

interface StepShareProps {
  items: Item[];
  charges: Charge[];
  participants: Participant[];
  assignments: Record<string, Assignment[]>;
  onBack?: () => void;
  onBackToBills?: () => void;
  t: (key: string) => string;
  isOwner?: boolean;
  sessionId?: string;
  ownerParticipantId?: string;
  // Optional override — see StepAssign for why this is needed.
  decimals?: number;
  // Toggle-paid only persists when the session is a finalized snapshot
  // (toggle_participant_paid acts on SessionSnapshot, not the live Redis
  // session). Pass true once the session has been written to Postgres.
  isSnapshot?: boolean;
  // Free-tier status from enter-share. `null` while the call is in flight.
  freeRemaining?: number | null;
  isPremium?: boolean;
  // TipWidget props
  lang?: Language;
  hostEmail?: string;
  alreadyTipped?: boolean;
  // Owner token — only present for the host; enables manual tip edit
  ownerToken?: string | null;
}

export function StepShare({
  items,
  charges,
  participants,
  assignments,
  onBack,
  onBackToBills,
  t,
  isOwner = false,
  sessionId,
  ownerParticipantId,
  decimals: decimalsProp,
  isSnapshot = false,
  freeRemaining = null,
  isPremium = false,
  lang = "es",
  hostEmail = "",
  alreadyTipped = false,
  ownerToken,
}: StepShareProps) {
  const [expandedParticipants, setExpandedParticipants] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [hasNativeShare, setHasNativeShare] = useState(false);

  // Detect navigator.share availability once on mount. Doing this in a
  // useEffect (not inline) avoids a hydration mismatch between SSR and
  // the client, since `navigator` only exists on the client.
  useEffect(() => {
    setHasNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  // Optimistic-paid model: we don't mirror paid_at into local state. Instead
  // we read paid_at directly from props, except for participants whose
  // toggle is in flight or whose latest server-confirmed value hasn't yet
  // propagated through the session prop. `pending` holds the optimistic
  // value; we drop the entry once props reflect it.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Per-participant lock: blocks double-click while a request is in flight.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  // Drop pending entries once the prop has caught up to the optimistic value.
  useEffect(() => {
    setPending((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, optimistic] of Object.entries(prev)) {
        const fromProps = !!participants.find((p) => p.id === id)?.paid_at;
        if (fromProps === optimistic) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [participants]);

  const isParticipantPaid = (p: Participant): boolean =>
    p.id in pending ? pending[p.id] : !!p.paid_at;

  const handleTogglePaid = async (participantId: string) => {
    if (!isOwner || !isSnapshot || !sessionId) return;
    if (inFlight.has(participantId)) return;

    const current = participants.find((pp) => pp.id === participantId);
    const currentlyPaid = participantId in pending ? pending[participantId] : !!current?.paid_at;
    const desired = !currentlyPaid;

    setPending((m) => ({ ...m, [participantId]: desired }));
    setInFlight((s) => {
      const next = new Set(s);
      next.add(participantId);
      return next;
    });

    try {
      await toggleParticipantPaid(
        sessionId,
        participantId,
        getStoredToken() ?? undefined,
        getDeviceId(),
      );
      // The server confirmed. We keep pending until props reflect the new
      // value — that prevents a flicker if session polling still has the
      // old paid_at cached. The useEffect above clears pending then.
    } catch (e) {
      console.error("Failed to toggle paid:", e);
      setPending((m) => {
        const next = { ...m };
        delete next[participantId];
        return next;
      });
    } finally {
      setInFlight((s) => {
        const next = new Set(s);
        next.delete(participantId);
        return next;
      });
    }
  };

  // Fire tip widget impression once per session mount
  useEffect(() => {
    if (!sessionId) return;
    trackTipWidgetShown({
      session_id: sessionId,
      participant_count: participants.length,
      is_supporter: isSupporter(getStoredUser()),
    });
    // Only fire once per session_id mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fetch tip data for the Bill-e line in each participant's expanded view
  const [tip, setTip] = useState<SessionTip | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 5; // ~10 seconds at 2s intervals

    const fetchTip = async () => {
      try {
        const t = await getSessionTip(sessionId);
        if (!cancelled) {
          setTip(t);
          // If tip exists but total_paid_usd is null (webhook not arrived), keep polling
          if (t && t.total_paid_usd == null && attempts < maxAttempts) {
            attempts++;
            setTimeout(fetchTip, 2000);
          }
        }
      } catch {
        // Silent — endpoint may 503 if backend not configured
      }
    };

    fetchTip();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Per-person tip share (USD), only when tip.is_split = true
  const tipPerPersonUsd = useMemo<number | null>(() => {
    if (!tip || !tip.is_split) return null;
    const totalForSplit = tip.total_paid_usd ?? tip.amount_total_usd;
    if (totalForSplit == null || totalForSplit <= 0 || tip.participant_count <= 0) return null;
    return Math.round((totalForSplit / tip.participant_count) * 100) / 100;
  }, [tip]);

  // Pre-payment preview: host has toggled "split" in TipWidget but hasn't paid yet.
  // Lets each participant see what they will owe BEFORE the host commits.
  // `manualLocalPerEditor` is the host's pre-tip override of the per-editor
  // local-currency amount (overrides FX auto-conversion in the preview).
  // Real tip (above) always wins when both exist.
  const [tipPreview, setTipPreview] = useState<{
    amountTotal: number;
    isSplit: boolean;
    manualLocalPerEditor: number | null;
  } | null>(null);

  const tipPreviewPerPersonUsd = useMemo<number | null>(() => {
    if (tipPerPersonUsd !== null) return null;  // real tip takes precedence
    if (!tipPreview || !tipPreview.isSplit) return null;
    if (participants.length === 0) return null;
    return Math.round((tipPreview.amountTotal / participants.length) * 100) / 100;
  }, [tipPerPersonUsd, tipPreview, participants.length]);

  // FX: convert USD tip to local currency (inferred from IP geo) so the
  // Bill-e line and the participant Total are in the same units as the
  // rest of the bill. Fetched once on mount; falls back to USD-only display.
  const [fx, setFx] = useState<{ currency: string; rate: number } | null>(null);
  useEffect(() => {
    const showsAnyTip = tipPerPersonUsd !== null || tipPreviewPerPersonUsd !== null;
    if (!showsAnyTip || fx !== null) return;
    let cancelled = false;
    getLocalFx().then((result) => {
      if (!cancelled && result) setFx(result);
    });
    return () => { cancelled = true; };
  }, [tipPerPersonUsd, tipPreviewPerPersonUsd, fx]);

  // Effective per-person tip in USD: real wins, preview otherwise.
  const tipUsd = tipPerPersonUsd ?? tipPreviewPerPersonUsd;
  const tipIsPreview = tipPerPersonUsd === null && tipPreviewPerPersonUsd !== null;
  // Per-person tip in the bill's local currency. Priority:
  //   1. Persisted manual override on the tip row (post-payment)
  //   2. Host's pre-tip manual override from preview callback (pre-payment)
  //   3. FX-auto-converted from USD (best effort, may be null)
  const tipLocal: number | null = (() => {
    if (tip?.manual_per_editor_local != null) return tip.manual_per_editor_local;
    if (tipPreview?.manualLocalPerEditor != null) return tipPreview.manualLocalPerEditor;
    if (tipUsd != null && fx != null) return tipUsd * fx.rate;
    return null;
  })();
  const tipLocalIsManual =
    tip?.manual_per_editor_local != null || tipPreview?.manualLocalPerEditor != null;

  // Prefer explicit decimals from parent (which knows session.decimal_places),
  // fall back to item-level detection.
  const decimals = decimalsProp ?? detectDecimals(items);
  const fmt = (amount: number) => formatCurrency(amount, decimals);

  // Build session object for calculations
  const session: Session = {
    items,
    charges,
    participants,
    assignments,
  };

  // Calculate grand total
  const totalAmount = participants.reduce((sum, p) => {
    const { total } = calculateParticipantTotal(p.id, session);
    return sum + total;
  }, 0);

  // Get items for a participant (with correct grupal division)
  const getParticipantItems = (participantId: string) => {
    const result: { name: string; amount: number; qty: number; shared?: number }[] = [];

    Object.entries(assignments).forEach(([itemId, assigns]) => {
      const assignment = assigns.find((a) => a.participant_id === participantId);
      if (assignment && assignment.quantity > 0) {
        const unitMatch = itemId.match(/^(.+)_unit_(\d+)$/);

        if (unitMatch) {
          // Unit-specific assignment
          const baseItemId = unitMatch[1];
          const unitIndex = parseInt(unitMatch[2]) + 1;
          const item = items.find((i) => (i.id || i.name) === baseItemId);
          if (item) {
            const numPeopleSharing = assigns.filter(a => a.quantity > 0).length;
            result.push({
              name: `${item.name} (u${unitIndex})`,
              amount: item.price / Math.max(1, numPeopleSharing),
              qty: 1,
              shared: numPeopleSharing > 1 ? numPeopleSharing : undefined,
            });
          }
        } else {
          const item = items.find((i) => (i.id || i.name) === itemId);
          if (item) {
            const numPeopleSharing = assigns.filter(a => a.quantity > 0).length;
            const isGrupalMode = item.mode === "grupal";

            if (isGrupalMode && numPeopleSharing > 1) {
              // Grupal mode - divide total among all participants
              const itemQty = item.quantity || 1;
              const totalItemPrice = item.price * itemQty;
              result.push({
                name: item.name,
                amount: totalItemPrice / numPeopleSharing,
                qty: itemQty,
                shared: numPeopleSharing,
              });
            } else {
              // Individual mode - each person pays for their own quantity
              result.push({
                name: item.name,
                amount: item.price * assignment.quantity,
                qty: Math.round(assignment.quantity),
              });
            }
          }
        }
      }
    });

    return result;
  };

  const toggleExpanded = (participantId: string) => {
    setExpandedParticipants((prev) => ({
      ...prev,
      [participantId]: !prev[participantId],
    }));
  };

  // Generate share message
  const generateShareMessage = () => {
    const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || "https://billeocr.com";

    let message = `🧾 *${t("share.billSummary")}*\n\n`;

    participants.forEach((p) => {
      const { total } = calculateParticipantTotal(p.id, session);
      // Each participant's share includes their slice of the Bill-e tip
      // when the host has elected to split it.
      message += `• ${p.name}: ${fmt(total + (tipLocal ?? 0))}\n`;
    });

    const grandTotal = totalAmount + (tipLocal != null ? tipLocal * participants.length : 0);
    message += `\n💰 *${t("totals.total")}: ${fmt(grandTotal)}*`;

    if (sessionId) {
      message += `\n\n🔗 ${t("share.viewDetails")}:\n${frontendUrl}/s/${sessionId}?view=results`;
    }

    message += `\n\n✨ ${t("share.cta")}:\n${frontendUrl}`;

    return message;
  };

  // Copy to clipboard
  const copyToClipboard = async () => {
    const message = generateShareMessage();
    if (sessionId) trackShare(sessionId, "copy");

    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = message;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Share on WhatsApp
  const shareOnWhatsApp = () => {
    if (sessionId) trackShare(sessionId, "whatsapp");
    const message = generateShareMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
    setShareSheetOpen(false);
  };

  // Share on Telegram
  const shareOnTelegram = () => {
    if (sessionId) trackShare(sessionId, "telegram");
    const message = generateShareMessage();
    // Telegram's share intent uses url+text; we put everything in text
    // since the share message already contains the link.
    const url = `https://t.me/share/url?url=${encodeURIComponent("")}&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
    setShareSheetOpen(false);
  };

  // Share via email (mailto:)
  const shareViaEmail = () => {
    if (sessionId) trackShare(sessionId, "email");
    const message = generateShareMessage();
    const subject = encodeURIComponent(t("share.emailSubject"));
    const body = encodeURIComponent(message);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setShareSheetOpen(false);
  };

  // Native share sheet (mobile + supported desktop browsers)
  const shareNative = async () => {
    if (sessionId) trackShare(sessionId, "native");
    const message = generateShareMessage();
    try {
      await navigator.share({ text: message });
    } catch {
      // User cancelled or share failed — swallow silently
    }
    setShareSheetOpen(false);
  };

  // Wrapper around copyToClipboard that also closes the sheet
  const copyFromSheet = async () => {
    await copyToClipboard();
    setShareSheetOpen(false);
  };

  return (
    <div className="step-animate">
      {/* Participants List */}
      <div className="space-y-2">
        {participants.map((p, pIndex) => {
          const { subtotal, total, charges: pCharges } = calculateParticipantTotal(p.id, session);
          const isExpanded = expandedParticipants[p.id];
          const participantItems = getParticipantItems(p.id);

          const isPaid = isParticipantPaid(p);

          return (
            <div
              key={p.id}
              className="rounded-xl bg-card transition-colors"
            >
              {/* Participant Row */}
              <div className="w-full flex items-center justify-between p-3 gap-2">
                <button
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  onClick={() => toggleExpanded(p.id)}
                >
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                  >
                    {getInitials(p.name)}
                  </div>
                  <span className="font-medium truncate">{p.name}</span>
                </button>
                <span className="font-semibold tabular-nums text-foreground">
                  {fmt(total + (tipLocal ?? 0))}
                </span>
                {isOwner && isSnapshot ? (
                  <button
                    type="button"
                    onClick={() => handleTogglePaid(p.id)}
                    disabled={inFlight.has(p.id)}
                    aria-label={isPaid ? t("share.markUnpaid") : t("share.markPaid")}
                    className={`shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors disabled:opacity-50 ${
                      isPaid
                        ? "bg-green-600 border-green-600 text-white"
                        : "border-muted-foreground/40 hover:border-foreground"
                    }`}
                  >
                    {isPaid && <Check className="w-4 h-4" />}
                  </button>
                ) : (
                  isPaid && (
                    <span className="shrink-0 text-xs text-green-600 font-medium">
                      {t("share.paidLabel")}
                    </span>
                  )
                )}
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="pb-3 px-3 pt-0">
                  <div className="pl-3 space-y-1">
                    {/* Items */}
                    {participantItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="text-xs bg-secondary/80 text-foreground px-1.5 py-0.5 rounded min-w-[2.5ch] text-center">
                            {item.shared ? `÷${item.shared}` : `${item.qty}x`}
                          </span>
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="tabular-nums shrink-0">{fmt(item.amount)}</span>
                      </div>
                    ))}

                    {/* Subtotal line */}
                    <div className="flex items-center justify-between py-1 text-sm border-t border-border/30 mt-2 pt-2">
                      <span className="text-muted-foreground">{t("totals.subtotal")}</span>
                      <span className="tabular-nums">{fmt(subtotal)}</span>
                    </div>

                    {/* Charges */}
                    {pCharges
                      .filter((c) => Math.abs(c.amount) > 0)
                      .map((charge) => (
                        <div
                          key={charge.id}
                          className={`flex items-center justify-between py-1 text-sm ${charge.amount < 0 ? "text-green-600" : "text-muted-foreground"}`}
                        >
                          <span>{charge.name}</span>
                          <span className="tabular-nums">
                            {charge.amount < 0 ? "-" : "+"}
                            {fmt(Math.abs(charge.amount))}
                          </span>
                        </div>
                      ))}

                    {/* Bill-e tip line — placed inline above the Total so the
                        Total reflects the full amount the participant will owe.
                        Value priority: host's manual override > FX-converted USD.
                        Falls back to a USD-only line below the Total if FX failed. */}
                    {tipLocal !== null && (
                      <div
                        className={
                          "flex items-center justify-between py-1 text-sm " +
                          (tipIsPreview ? "text-muted-foreground italic" : "text-foreground")
                        }
                      >
                        <span>{tipIsPreview ? t("tip_line_label_preview") : t("tip_line_label")}</span>
                        <span className="tabular-nums">
                          +{fmt(tipLocal)}
                          {tipUsd !== null && !tipLocalIsManual && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              (≈${tipUsd.toFixed(2)} USD)
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    {/* Total — includes tipLocal when FX available */}
                    <div className="flex items-center justify-between py-1 text-sm font-semibold border-t border-border/30 mt-1 pt-2">
                      <span>{t("items.total")}</span>
                      <span className="tabular-nums text-foreground">
                        {fmt(total + (tipLocal ?? 0))}
                      </span>
                    </div>

                    {/* USD fallback line — only when FX failed; Total stays in local-only */}
                    {tipUsd !== null && tipLocal === null && (
                      <div
                        className={
                          "flex justify-between text-sm mt-1 " +
                          (tipIsPreview ? "text-muted-foreground italic" : "text-foreground")
                        }
                      >
                        <span>{tipIsPreview ? t("tip_line_label_preview") : t("tip_line_label")}</span>
                        <span className="tabular-nums">+${tipUsd.toFixed(2)} USD</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Grand Total — includes the Bill-e tip (per-editor × N) when split is on. */}
      <div className="flex items-center justify-between p-4 mt-4 bg-primary/15 rounded-xl">
        <span className="font-semibold">{t("totals.tableTotal")}</span>
        <span className="text-xl font-bold text-foreground">
          {fmt(totalAmount + (tipLocal != null ? tipLocal * participants.length : 0))}
        </span>
      </div>

      {/* Tip Widget */}
      {sessionId && (
        <TipWidget
          sessionId={sessionId}
          participantCount={participants.length}
          hostEmail={hostEmail}
          lang={lang}
          alreadyTipped={alreadyTipped}
          ownerToken={ownerToken ?? undefined}
          onPreviewChange={setTipPreview}
        />
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-8">
        {onBack && (
          <Button variant="outline" size="lg" className={isOwner ? "flex-1 h-12" : "w-full h-12"} onClick={onBack}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            {t("steps.back")}
          </Button>
        )}
        {!onBack && onBackToBills && (
          <Button size="lg" className="w-full h-12 font-semibold" onClick={onBackToBills}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            {t("bills.backToBills")}
          </Button>
        )}
        {isOwner && (
          <Button
            size="lg"
            className="flex-1 h-12 font-semibold"
            onClick={() => {
              if (hasNativeShare) {
                shareNative();
              } else {
                setShareSheetOpen(true);
              }
            }}
          >
            <Share2 className="w-4 h-4 mr-2" />
            {t("share.button")}
          </Button>
        )}
      </div>

      {/* Bottom sheet — share options. Rendered when isOwner triggers
          the share button. Used on both mobile and desktop for a
          consistent look. */}
      {shareSheetOpen && (
        <>
          <div
            className="share-sheet-backdrop fixed inset-0 bg-black/40 z-40"
            onClick={() => setShareSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("share.sheetTitle")}
            className="share-sheet fixed inset-x-0 bottom-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-xl max-w-md mx-auto"
          >
            <div className="px-4 pt-3 pb-6">
              {/* drag handle */}
              <div className="w-10 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">{t("share.sheetTitle")}</h3>
                <button
                  type="button"
                  onClick={() => setShareSheetOpen(false)}
                  className="p-1 rounded-md hover:bg-secondary text-muted-foreground"
                  aria-label={t("steps.back")}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-1">
                <ShareOption
                  icon={<MessageCircle className="w-5 h-5 text-green-600" />}
                  bg="bg-green-500/15"
                  label="WhatsApp"
                  onClick={shareOnWhatsApp}
                />
                <ShareOption
                  icon={<Send className="w-5 h-5 text-sky-600" />}
                  bg="bg-sky-500/15"
                  label="Telegram"
                  onClick={shareOnTelegram}
                />
                <ShareOption
                  icon={<Mail className="w-5 h-5 text-muted-foreground" />}
                  bg="bg-muted"
                  label={t("share.email")}
                  onClick={shareViaEmail}
                />
                <ShareOption
                  icon={copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5 text-muted-foreground" />}
                  bg="bg-muted"
                  label={copied ? t("share.copied") : t("share.copyLink")}
                  onClick={copyFromSheet}
                />
                {hasNativeShare && (
                  <ShareOption
                    icon={<MoreHorizontal className="w-5 h-5 text-muted-foreground" />}
                    bg="bg-muted"
                    label={t("share.more")}
                    onClick={shareNative}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface ShareOptionProps {
  icon: React.ReactNode;
  bg: string;
  label: string;
  onClick: () => void;
}

function ShareOption({ icon, bg, label, onClick }: ShareOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-secondary transition-colors text-left"
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bg}`}>
        {icon}
      </div>
      <span className="font-medium">{label}</span>
    </button>
  );
}
