"use client";

import { useState } from "react";
import { ChevronLeft, ChevronDown, Share2, Copy, Check } from "lucide-react";
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
import { trackShare } from "@/lib/tracking";

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
  billCostShared?: boolean;
  premiumPrice?: number;
  ownerParticipantId?: string;
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
  billCostShared = false,
  premiumPrice = 1990,
  ownerParticipantId,
}: StepShareProps) {
  const [expandedParticipants, setExpandedParticipants] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  // Bill-e cost sharing calculations
  const participantCount = participants.length;
  const billCostPerPerson = billCostShared && participantCount >= 2
    ? Math.round(premiumPrice / participantCount)
    : 0;
  // Host recovery = what they get back from others (N-1 shares)
  const hostRecovery = billCostShared && participantCount >= 2
    ? premiumPrice - billCostPerPerson
    : 0;

  // Detect decimals from items to match receipt format
  const decimals = detectDecimals(items);
  const fmt = (amount: number) => formatCurrency(amount, decimals);

  // Build session object for calculations
  const session: Session = {
    items,
    charges,
    participants,
    assignments,
  };

  // Calculate totals (including Bill-e cost if shared)
  const baseTotalAmount = participants.reduce((sum, p) => {
    const { total } = calculateParticipantTotal(p.id, session);
    return sum + total;
  }, 0);

  // Add Bill-e premium cost to table total if shared
  const totalAmount = baseTotalAmount + (billCostShared ? premiumPrice : 0);

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
    const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || "https://bill-e.vercel.app";

    let message = `🧾 *${t("share.billSummary")}*\n\n`;

    participants.forEach((p) => {
      const { total } = calculateParticipantTotal(p.id, session);
      // Calculate Bill-e cost for this participant
      const isHost = p.id === ownerParticipantId;
      const billECost = billCostShared
        ? (isHost ? -hostRecovery : billCostPerPerson)
        : 0;
      const finalTotal = total + billECost;
      message += `• ${p.name}: ${fmt(finalTotal)}\n`;
    });

    message += `\n💰 *Total: ${fmt(totalAmount)}*`;

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
  };

  return (
    <div className="step-animate">
      {/* Participants List */}
      <div className="space-y-2">
        {participants.map((p, pIndex) => {
          const { subtotal, total, charges: pCharges } = calculateParticipantTotal(p.id, session);
          const isExpanded = expandedParticipants[p.id];
          const participantItems = getParticipantItems(p.id);

          // Calculate Bill-e cost for this participant
          const isHostParticipant = p.id === ownerParticipantId;
          // Host gets negative (recovery), others pay positive
          const billECostForParticipant = billCostShared
            ? (isHostParticipant ? -hostRecovery : billCostPerPerson)
            : 0;
          const finalTotal = total + billECostForParticipant;

          return (
            <div
              key={p.id}
              className="rounded-xl bg-card transition-colors"
            >
              {/* Participant Row */}
              <button
                className="w-full flex items-center justify-between p-3"
                onClick={() => toggleExpanded(p.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                  >
                    {getInitials(p.name)}
                  </div>
                  <span className="font-medium truncate">{p.name}</span>
                </div>
                <span className="font-semibold tabular-nums text-foreground">{fmt(finalTotal)}</span>
              </button>

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

                    {/* Bill-e cost line (only if shared) */}
                    {billCostShared && billECostForParticipant !== 0 && (
                      <div
                        className={`flex items-center justify-between py-1 text-sm ${
                          billECostForParticipant < 0 ? "text-green-600" : "text-orange-500"
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          {t("share.billECost")}
                          {billECostForParticipant < 0 && (
                            <span className="text-xs opacity-70">({t("share.billERecovered")})</span>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {billECostForParticipant < 0 ? "-" : "+"}
                          {fmt(Math.abs(billECostForParticipant))}
                        </span>
                      </div>
                    )}

                    {/* Total */}
                    <div className="flex items-center justify-between py-1 text-sm font-semibold border-t border-border/30 mt-1 pt-2">
                      <span>{t("items.total")}</span>
                      <span className="tabular-nums text-foreground">{fmt(finalTotal)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Grand Total */}
      <div className="flex items-center justify-between p-4 mt-4 bg-primary/15 rounded-xl">
        <span className="font-semibold">{t("totals.tableTotal")}</span>
        <span className="text-xl font-bold text-foreground">{fmt(totalAmount)}</span>
      </div>

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
          <>
            <Button
              variant="outline"
              size="lg"
              className="h-12 px-4"
              onClick={copyToClipboard}
            >
              {copied ? (
                <Check className="w-5 h-5 text-green-600" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </Button>
            <Button
              size="lg"
              className="flex-1 h-12 font-semibold"
              onClick={shareOnWhatsApp}
            >
              <Share2 className="w-4 h-4 mr-2" />
              {t("finalized.shareWhatsApp")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
