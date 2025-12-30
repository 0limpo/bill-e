"use client";

import { useState } from "react";
import { ChevronLeft, ChevronDown, ChevronRight, Share2 } from "lucide-react";
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

  // Get items for a participant
  const getParticipantItems = (participantId: string) => {
    const result: { name: string; amount: number; qty: number }[] = [];

    Object.entries(assignments).forEach(([itemId, assigns]) => {
      const assignment = assigns.find((a) => a.participant_id === participantId);
      if (assignment && assignment.quantity > 0) {
        const item = items.find((i) => (i.id || i.name) === itemId);
        if (item) {
          result.push({
            name: item.name,
            amount: item.price * assignment.quantity,
            qty: Math.round(assignment.quantity),
          });
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
      <div className="text-center mb-6">
        <span className="text-4xl mb-2 block">🎉</span>
        <h2 className="text-xl font-bold">{t("finalized.billClosed")}</h2>
      </div>

      {/* Column Headers */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider">
        <span>{t("items.name")}</span>
        <div className="flex gap-8">
          <span>{t("totals.subtotal")}</span>
          <span>{t("items.total")}</span>
        </div>
      </div>

      {/* Participants List */}
      <div className="space-y-2">
        {participants.map((p, pIndex) => {
          const { subtotal, total, charges: pCharges } = calculateParticipantTotal(p.id, session);
          const isExpanded = expandedParticipants[p.id];
          const participantItems = getParticipantItems(p.id);

          return (
            <div key={p.id} className="bg-card rounded-xl overflow-hidden">
              {/* Participant Row */}
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
                onClick={() => toggleExpanded(p.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </span>
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ backgroundColor: getAvatarColor(p.name, pIndex) }}
                  >
                    {getInitials(p.name)}
                  </div>
                  <span className="font-medium">{p.name}</span>
                </div>
                <div className="flex gap-8 tabular-nums">
                  <span className="text-muted-foreground">{fmt(subtotal)}</span>
                  <span className="font-semibold">{fmt(total)}</span>
                </div>
              </button>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border/50">
                  <div className="pl-11 space-y-0">
                    {/* Items */}
                    {participantItems.map((item, idx) => (
                      <div key={idx} className="breakdown-row">
                        <span className="flex items-center gap-2">
                          <span className="qty-badge">{item.qty}x</span>
                          {item.name}
                        </span>
                        <span>{fmt(item.amount)}</span>
                      </div>
                    ))}

                    {/* Subtotal */}
                    <div className="breakdown-row subtotal">
                      <span>{t("totals.subtotal")}</span>
                      <span>{fmt(subtotal)}</span>
                    </div>

                    {/* Charges */}
                    {pCharges
                      .filter((c) => Math.abs(c.amount) > 0)
                      .map((charge) => (
                        <div
                          key={charge.id}
                          className={`breakdown-row charge ${charge.amount < 0 ? "discount" : ""}`}
                        >
                          <span>{charge.name}</span>
                          <span>
                            {charge.amount < 0 ? "-" : "+"}
                            {fmt(Math.abs(charge.amount))}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between p-4 mt-4 bg-primary/10 rounded-xl">
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
          className="flex-1 h-12 font-semibold bg-green-600 hover:bg-green-700"
          onClick={shareOnWhatsApp}
        >
          <Share2 className="w-4 h-4 mr-2" />
          {t("finalized.shareWhatsApp")}
        </Button>
      </div>
    </div>
  );
}
