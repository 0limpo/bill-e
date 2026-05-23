"use client";

import { useMemo, useState, useEffect } from "react";
import { createTipCheckout } from "@/lib/api";
import { getTranslator, type Language } from "@/lib/i18n";
import { MeetTheDeveloper } from "./MeetTheDeveloper";
import {
  trackTipPresetClicked,
  trackTipCustomEntered,
  trackTipSplitToggled,
  trackTipCheckoutStarted,
} from "@/lib/tracking";

const PRESETS = [3, 7, 15] as const;
const DEFAULT_PRESET = 7;
const MIN_CUSTOM = 1;

interface Props {
  sessionId: string;
  participantCount: number;
  hostEmail: string;
  lang: Language;
  alreadyTipped?: boolean;
}

export function TipWidget({
  sessionId,
  participantCount,
  hostEmail,
  lang,
  alreadyTipped = false,
}: Props) {
  const t = getTranslator(lang);
  const [selected, setSelected] = useState<number | "custom">(DEFAULT_PRESET);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isSplit, setIsSplit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(alreadyTipped);

  useEffect(() => { setCollapsed(alreadyTipped); }, [alreadyTipped]);

  const totalAmount = useMemo(() => {
    if (selected === "custom") {
      const n = parseFloat(customAmount);
      return Number.isFinite(n) ? n : 0;
    }
    return selected;
  }, [selected, customAmount]);

  const canSplit = participantCount >= 2;
  const chargedAmount = useMemo(() => {
    if (isSplit && canSplit) return Math.round((totalAmount / participantCount) * 100) / 100;
    return totalAmount;
  }, [totalAmount, isSplit, participantCount, canSplit]);

  const isValid = totalAmount >= MIN_CUSTOM;

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      trackTipCheckoutStarted({
        amount_total: totalAmount,
        amount_charged_host: chargedAmount,
        is_split: isSplit && canSplit,
      });
      const res = await createTipCheckout({
        session_id: sessionId,
        amount_usd: totalAmount,
        is_split: isSplit && canSplit,
        participant_count: participantCount,
        google_email: hostEmail,
      });
      window.location.href = res.checkout_url;
    } catch (e: any) {
      setError(e?.message || "Error");
      setSubmitting(false);
    }
  }

  if (collapsed) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="text-emerald-700 font-medium">{t("tip_thanks_title")}</p>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-2 text-sm text-emerald-600 underline-offset-2 hover:underline"
        >
          {t("tip_thanks_again")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
      <h3 className="font-semibold text-gray-900">💚 {t("tip_widget_title")}</h3>
      <p className="text-sm text-gray-600 mt-1">{t("tip_widget_subtitle")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => {
              setSelected(amount);
              trackTipPresetClicked({ amount, was_default: amount === DEFAULT_PRESET });
            }}
            className={
              "px-4 py-2 rounded-lg border " +
              (selected === amount
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-emerald-400")
            }
          >
            ${amount}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelected("custom")}
          className={
            "px-4 py-2 rounded-lg border " +
            (selected === "custom"
              ? "bg-emerald-600 text-white border-emerald-600"
              : "bg-white text-gray-700 border-gray-300 hover:border-emerald-400")
          }
        >
          {t("tip_preset_custom")}
        </button>
      </div>

      {selected === "custom" && (
        <div className="mt-3">
          <input
            type="number"
            inputMode="decimal"
            min={MIN_CUSTOM}
            step="0.5"
            value={customAmount}
            onChange={(e) => {
              setCustomAmount(e.target.value);
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= MIN_CUSTOM) {
                trackTipCustomEntered({ amount: n });
              }
            }}
            placeholder={`$${MIN_CUSTOM}.00`}
            className="w-full px-3 py-2 rounded-lg border border-gray-300"
          />
          {customAmount && totalAmount < MIN_CUSTOM && (
            <p className="text-xs text-red-600 mt-1">{t("tip_custom_min_error")}</p>
          )}
        </div>
      )}

      {canSplit && (
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={isSplit}
            onChange={(e) => {
              setIsSplit(e.target.checked);
              trackTipSplitToggled({ is_on: e.target.checked, participants: participantCount });
            }}
            className="mt-1"
          />
          <span>
            {t("tip_split_toggle").replace("{count}", String(participantCount))}
            {isSplit && (
              <span className="block text-xs text-gray-500 mt-0.5">
                {t("tip_split_per_person").replace("{amount}", chargedAmount.toFixed(2))}
              </span>
            )}
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="mt-4 w-full px-4 py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
      >
        {t("tip_cta").replace("{amount}", chargedAmount.toFixed(2))}
      </button>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      <MeetTheDeveloper lang={lang} />
    </div>
  );
}
