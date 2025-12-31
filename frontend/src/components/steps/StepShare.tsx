"use client";

import { useState } from "react";
import { ChevronLeft, ChevronDown, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  getAvatarColor,
  getInitials,
  calculateParticipantTotal,
  type Item,
  type Charge,
  type Participant,
  type Assignment,
  type Session,
} from "@/lib/billEngine";

interface StepShareProps {
  items: Item[];
  charges: Charge[];
  participants: Participant[];
  assignments: Record<string, Assignment[]>;
  onBack: () => void;
  t: (key: string) => string;
}

export function StepShare({
  items,
  charges,
  participants,
  assignments,
  onBack,
  t,
}: StepShareProps) {
  const [expandedParticipants, setExpandedParticipants] = useState<Record<string, boolean>>({});

  const fmt = (amount: number) => formatCurrency(amount);

  // Build session object for calculations
  const session: Session = {
    items,
    charges,
    participants,
    assignments,
  };

  // Calculate totals
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

            if (numPeopleSharing > 1) {
              // Shared item - divide among all participants
              const itemQty = item.quantity || 1;
              const totalItemPrice = item.price * itemQty;
              result.push({
                name: item.name,
                amount: totalItemPrice / numPeopleSharing,
                qty: itemQty,
                shared: numPeopleSharing,
              });
            } else {
              // Individual mode - this person has it alone
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

  // Share on WhatsApp
  const shareOnWhatsApp = () => {
    let message = `🧾 *Bill-e - ${t("finalized.billClosed")}*\n\n`;

    participants.forEach((p) => {
      const { total } = calculateParticipantTotal(p.id, session);
      message += `• ${p.name}: ${fmt(total)}\n`;
    });

    message += `\n*${t("totals.total")}: ${fmt(totalAmount)}*`;

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="step-animate">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold">{t("finalized.billClosed")}</h2>
        <p className="text-muted-foreground text-sm">{t("finalized.subtitle") || "Resumen por persona"}</p>
      </div>

      {/* Participants List */}
      <div className="space-y-2">
        {participants.map((p, pIndex) => {
          const { subtotal, total, charges: pCharges } = calculateParticipantTotal(p.id, session);
          const isExpanded = expandedParticipants[p.id];
          const participantItems = getParticipantItems(p.id);

          return (
            <div
              key={p.id}
              className="rounded-xl bg-secondary/40 transition-colors"
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
                <span className="font-semibold tabular-nums text-primary">{fmt(total)}</span>
              </button>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="pb-3 px-3 pt-0">
                  <div className="pl-7 space-y-1">
                    {/* Items */}
                    {participantItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="text-xs bg-secondary/80 text-foreground/70 px-1.5 py-0.5 rounded min-w-[2.5ch] text-center">
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

                    {/* Total */}
                    <div className="flex items-center justify-between py-1 text-sm font-semibold border-t border-border/30 mt-1 pt-2">
                      <span>{t("items.total")}</span>
                      <span className="tabular-nums text-primary">{fmt(total)}</span>
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
        <span className="text-xl font-bold text-primary">{fmt(totalAmount)}</span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mt-8">
        <Button variant="outline" size="lg" className="flex-1 h-12" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          {t("steps.back")}
        </Button>
        <Button
          size="lg"
          className="flex-1 h-12 font-semibold"
          onClick={shareOnWhatsApp}
        >
          <Share2 className="w-4 h-4 mr-2" />
          {t("finalized.shareWhatsApp")}
        </Button>
      </div>
    </div>
  );
}
