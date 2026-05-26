"use client";

import { useEffect, useMemo, useState } from "react";
import { createTipCheckout, updateTipTotalPaid } from "@/lib/api";
import { getTranslator, type Language } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MeetTheDeveloper } from "./MeetTheDeveloper";
import {
  trackTipPresetClicked,
  trackTipCustomEntered,
  trackTipSplitToggled,
  trackTipCheckoutStarted,
} from "@/lib/tracking";

const PRESETS = [5, 10, 20] as const;
const DEFAULT_PRESET = 10;
const MIN_CUSTOM = 3.49;

interface Props {
  sessionId: string;
  participantCount: number;
  hostEmail: string;
  lang: Language;
  alreadyTipped?: boolean;
  /** When true, the thank-you message uses split-friendly wording (also
   *  thanking editors who chipped in), instead of host-only wording. */
  tipIsSplit?: boolean;
  ownerToken?: string;
  /** Fires whenever the host's tip selection changes, so the parent can preview
   *  the per-participant Bill-e line. `manualLocalPerEditor` is the host's
   *  explicit override of the per-editor local-currency amount (overrides FX). */
  onPreviewChange?: (
    preview: {
      amountTotal: number;
      isSplit: boolean;
      manualLocalPerEditor: number | null;
    } | null,
  ) => void;
}

/** Tiny inline switch so we don't drag in a UI library just for this. */
function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow-sm transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </span>
  );
}

export function TipWidget({
  sessionId,
  participantCount,
  hostEmail,
  lang,
  alreadyTipped = false,
  tipIsSplit = false,
  ownerToken,
  onPreviewChange,
}: Props) {
  const t = getTranslator(lang);

  // expanded === default-hidden options revealed by the user-controlled switch
  // collapsed === post-payment "thanks" state (renders something different)
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | "custom">(DEFAULT_PRESET);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isSplit, setIsSplit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(alreadyTipped);

  const [manualAmount, setManualAmount] = useState<string>("");
  const [savingManual, setSavingManual] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);

  // Manual per-editor local-currency override (independent of the USD field above).
  const [manualLocal, setManualLocal] = useState<string>("");
  const [savingLocal, setSavingLocal] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);

  // Pre-tip manual override: host types the TOTAL tip amount in their bill's
  // local currency; we divide by participant count to compute the per-editor
  // amount. Lives in local state and is propagated via onPreviewChange. When
  // the host pays, the per-editor amount goes via Polar metadata so editors
  // see the same number after the webhook persists.
  const [preTipManualLocalTotal, setPreTipManualLocalTotal] = useState<string>("");
  const preTipManualLocalTotalNumeric: number | null = (() => {
    const n = parseFloat(preTipManualLocalTotal);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const preTipManualLocalPerEditor: number | null =
    preTipManualLocalTotalNumeric != null && participantCount > 0
      ? Math.round((preTipManualLocalTotalNumeric / participantCount) * 100) / 100
      : null;

  useEffect(() => {
    setCollapsed(alreadyTipped);
  }, [alreadyTipped]);

  async function handleManualSave() {
    if (!ownerToken) return;
    const amount = parseFloat(manualAmount);
    if (!Number.isFinite(amount) || amount < 1) return;
    setSavingManual(true);
    setManualSaved(false);
    try {
      await updateTipTotalPaid(sessionId, {
        total_paid_usd: amount,
        owner_token: ownerToken,
      });
      setManualSaved(true);
    } catch {
      /* swallow — could surface an error state later if it matters */
    }
    setSavingManual(false);
  }

  async function handleLocalSave() {
    if (!ownerToken) return;
    const totalLocal = parseFloat(manualLocal);
    if (!Number.isFinite(totalLocal) || totalLocal < 0) return;
    // Host types the TOTAL tip in local currency; backend stores per-editor.
    const perEditor =
      participantCount > 0
        ? Math.round((totalLocal / participantCount) * 100) / 100
        : totalLocal;
    setSavingLocal(true);
    setLocalSaved(false);
    try {
      await updateTipTotalPaid(sessionId, {
        manual_per_editor_local: perEditor,
        owner_token: ownerToken,
      });
      setLocalSaved(true);
    } catch {
      /* swallow */
    }
    setSavingLocal(false);
  }

  const totalAmount = useMemo(() => {
    if (selected === "custom") {
      const n = parseFloat(customAmount);
      return Number.isFinite(n) ? n : 0;
    }
    return selected;
  }, [selected, customAmount]);

  const canSplit = participantCount >= 2;
  // Host pays full amount to Polar. perPersonAmount is purely for the inline
  // split-toggle subtitle so the host sees what each editor will chip in.
  const perPersonAmount = useMemo(() => {
    if (!isSplit || !canSplit) return totalAmount;
    return Math.round((totalAmount / participantCount) * 100) / 100;
  }, [totalAmount, isSplit, participantCount, canSplit]);

  const hasEmail = Boolean(hostEmail && hostEmail.trim().length > 0);
  const isValid = totalAmount >= MIN_CUSTOM && hasEmail;

  // Preview to parent: only when expanded + split active + valid amount.
  useEffect(() => {
    if (!onPreviewChange) return;
    if (collapsed || !expanded || !isSplit || !canSplit || totalAmount < MIN_CUSTOM) {
      onPreviewChange(null);
      return;
    }
    onPreviewChange({
      amountTotal: totalAmount,
      isSplit: true,
      manualLocalPerEditor: preTipManualLocalPerEditor,
    });
  }, [collapsed, expanded, isSplit, canSplit, totalAmount, preTipManualLocalPerEditor, onPreviewChange]);

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      trackTipCheckoutStarted({
        amount_total: totalAmount,
        amount_charged_host: totalAmount,
        is_split: isSplit && canSplit,
      });
      const res = await createTipCheckout({
        session_id: sessionId,
        amount_usd: totalAmount,
        is_split: isSplit && canSplit,
        participant_count: participantCount,
        google_email: hostEmail,
        ...(preTipManualLocalPerEditor != null && isSplit && canSplit
          ? { manual_per_editor_local: preTipManualLocalPerEditor }
          : {}),
      });
      window.location.href = res.checkout_url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
      setSubmitting(false);
    }
  }

  // Post-payment thanks state — overrides everything else.
  if (collapsed) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-primary/5 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary text-sm">
              ✓
            </span>
            <span className="text-sm font-medium">
              {t(tipIsSplit ? "tip_thanks_title_split" : "tip_thanks_title")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("tip_thanks_again")}
          </button>
        </div>

        {ownerToken && (
          <div className="mt-4 space-y-4 border-t border-border/60 pt-3">
            {/* Manual override: actual USD paid to Polar */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                {t("tip_manual_edit_label")}
              </label>
              <p className="text-[11px] leading-snug text-muted-foreground mb-2">
                {t("tip_manual_edit_hint")}
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 h-8 px-2.5 rounded-md border border-input bg-input text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
                <Button
                  type="button"
                  onClick={handleManualSave}
                  size="sm"
                  variant="secondary"
                  disabled={
                    !Number.isFinite(parseFloat(manualAmount)) ||
                    parseFloat(manualAmount) < 1 ||
                    savingManual
                  }
                >
                  {manualSaved ? t("tip_manual_edit_saved") : t("tip_manual_edit_save")}
                </Button>
              </div>
            </div>

            {/* Manual override: per-editor amount in the bill's local currency.
                Useful when FX conversion is wrong/missing or the host wants
                clean round numbers. When set, editors see this exact value. */}
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                {t("tip_manual_local_label")}
              </label>
              <p className="text-[11px] leading-snug text-muted-foreground mb-2">
                {t("tip_manual_local_hint")}
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={manualLocal}
                  onChange={(e) => setManualLocal(e.target.value)}
                  placeholder="0"
                  className="flex-1 h-8 px-2.5 rounded-md border border-input bg-input text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
                <Button
                  type="button"
                  onClick={handleLocalSave}
                  size="sm"
                  variant="secondary"
                  disabled={
                    !Number.isFinite(parseFloat(manualLocal)) ||
                    parseFloat(manualLocal) < 0 ||
                    savingLocal
                  }
                >
                  {localSaved ? t("tip_manual_edit_saved") : t("tip_manual_edit_save")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden">
      {/* Header — the whole row is the trigger; switch reflects state. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="font-medium text-foreground truncate">
            {t("tip_widget_title")}
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base leading-none">
            ☕
          </span>
        </span>
        <Switch checked={expanded} />
      </button>

      {/* Expandable area — CSS grid trick gives smooth height auto. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "border-t border-border/50 px-4 pb-4 pt-3 transition-opacity duration-200",
              expanded ? "opacity-100 delay-100" : "opacity-0",
            )}
          >
            <p className="text-xs leading-relaxed text-muted-foreground mb-4">
              {t("tip_widget_subtitle")}
            </p>

            {/* Presets — 4 column grid */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => {
                    setSelected(amount);
                    trackTipPresetClicked({
                      amount,
                      was_default: amount === DEFAULT_PRESET,
                    });
                  }}
                  className={cn(
                    "h-10 rounded-md text-sm font-medium transition-all",
                    "border tabular-nums",
                    selected === amount
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-secondary text-foreground border-border hover:bg-secondary/70",
                  )}
                >
                  ${amount}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelected("custom")}
                className={cn(
                  "h-10 rounded-md text-sm font-medium transition-all border",
                  selected === "custom"
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-secondary text-foreground border-border hover:bg-secondary/70",
                )}
              >
                {t("tip_preset_custom")}
              </button>
            </div>

            {/* Custom amount input */}
            {selected === "custom" && (
              <div className="mb-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
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
                    placeholder={MIN_CUSTOM.toFixed(2)}
                    autoFocus
                    className="w-full h-10 pl-7 pr-3 rounded-md border border-input bg-input text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 tabular-nums"
                  />
                </div>
                {customAmount && totalAmount < MIN_CUSTOM && (
                  <p className="text-xs text-destructive mt-1.5">
                    {t("tip_custom_min_error")}
                  </p>
                )}
              </div>
            )}

            {/* Split toggle */}
            {canSplit && (
              <label className="flex items-start gap-2.5 py-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isSplit}
                  onChange={(e) => {
                    setIsSplit(e.target.checked);
                    trackTipSplitToggled({
                      is_on: e.target.checked,
                      participants: participantCount,
                    });
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-input bg-input text-primary focus:ring-ring/40 focus:ring-2"
                />
                <span className="text-sm text-foreground leading-snug">
                  {t("tip_split_toggle").replace(
                    "{count}",
                    String(participantCount),
                  )}
                  {isSplit && (
                    <span className="block text-xs text-muted-foreground mt-0.5 tabular-nums">
                      {t("tip_split_per_person").replace(
                        "{amount}",
                        perPersonAmount.toFixed(2),
                      )}
                    </span>
                  )}
                </span>
              </label>
            )}

            {/* Pre-tip manual override of per-editor local amount. Visible
                only when split is on. Sent via Polar metadata at checkout
                so editors see this value (instead of FX-converted USD)
                after the webhook persists it to the tip row. */}
            {canSplit && isSplit && (
              <div className="mt-2 rounded-md border border-border/60 bg-secondary/40 px-3 py-2.5">
                <p className="text-[11px] leading-snug text-muted-foreground mb-1.5">
                  {t("tip_pretip_local_hint")}
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={preTipManualLocalTotal}
                    onChange={(e) => setPreTipManualLocalTotal(e.target.value)}
                    placeholder={t("tip_pretip_local_placeholder")}
                    className="w-full h-9 pl-7 pr-3 rounded-md border border-input bg-input text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 tabular-nums"
                  />
                </div>
                {preTipManualLocalPerEditor != null && (
                  <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                    {t("tip_pretip_local_per_editor").replace(
                      "{amount}",
                      preTipManualLocalPerEditor.toFixed(2),
                    )}
                  </p>
                )}
              </div>
            )}

            {/* CTA */}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              size="lg"
              className="w-full mt-3"
            >
              {t("tip_cta").replace("{amount}", totalAmount.toFixed(2))}
            </Button>

            {!hasEmail && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                {t("tip_requires_signin")}
              </p>
            )}
            {error && (
              <p className="text-xs text-destructive mt-2 text-center">{error}</p>
            )}

            <MeetTheDeveloper lang={lang} />
          </div>
        </div>
      </div>
    </div>
  );
}
