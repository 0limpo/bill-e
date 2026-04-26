"use client";

import { CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface StepGateChecklistItem {
  ok: boolean;
  label: string;
  detail?: string;
}

export interface StepGateHint {
  /** The instruction itself. Reads as a full short sentence. */
  text: string;
  /** Optional clarification appended below the text in muted color. */
  example?: string;
}

/**
 * Numeric comparison block (error mode) — surfaces the math behind
 * the mismatch so the user can act with full context.
 */
export interface StepGateCompare {
  rowA: { label: string; value: string };
  rowB: { label: string; value: string };
  diff: { label: string; value: string };
}

interface StepGateModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Visual mode of the modal. */
  mode: "success" | "error";
  /** Headline. */
  title: string;
  /** Optional supporting paragraph below the title. */
  subtitle?: string;
  /** Checklist (success: list of confirmations; error: list of issues). */
  checklist?: StepGateChecklistItem[];
  /** Optional comparative block (error mode). */
  compare?: StepGateCompare;
  /** Optional numbered hints explaining what to review (error mode). */
  hints?: StepGateHint[];
  /** Header above the hints list (e.g., "Revisa:"). */
  hintsHeader?: string;
  /** Primary CTA — typically "Avanzar". Hidden when undefined. */
  primaryLabel?: string;
  onPrimary?: () => void;
  /** Secondary CTA — typically "Seguir editando". Hidden when undefined. */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/**
 * Persistent step-gate modal.
 *
 * Use this between steps of the Bill-e flow to confirm progress (success)
 * or surface issues that need to be resolved (error). The modal blocks
 * interaction with the rest of the screen via a semi-opaque backdrop —
 * the user has to act on it (advance or go back to edit) to continue.
 */
export function StepGateModal({
  open,
  mode,
  title,
  subtitle,
  checklist,
  compare,
  hints,
  hintsHeader,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: StepGateModalProps) {
  if (!open) return null;

  const isSuccess = mode === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertTriangle;
  const accent = isSuccess ? "text-green-500" : "text-amber-500";
  const ringTone = isSuccess ? "bg-green-500/10" : "bg-amber-500/10";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-gate-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      {/* Backdrop — covers the page so the modal is the only thing actionable */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onSecondary}
      />

      {/* Card — full-width sheet on mobile, centered card on desktop */}
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 step-gate-enter">
        {/* Icon + Title */}
        <div className="flex flex-col items-center text-center mb-4">
          <div className={`w-14 h-14 rounded-full ${ringTone} flex items-center justify-center mb-3`}>
            <Icon className={`w-8 h-8 ${accent}`} strokeWidth={2} />
          </div>
          <h2 id="step-gate-title" className="text-xl font-bold text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        {/* Checklist */}
        {checklist && checklist.length > 0 && (
          <ul className="space-y-2 mb-4">
            {checklist.map((it, i) => (
              <li
                key={i}
                className="flex items-start gap-3 px-3 py-2 rounded-xl bg-secondary/50"
              >
                <span
                  className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    it.ok
                      ? "bg-green-500/15 text-green-500"
                      : "bg-amber-500/15 text-amber-500"
                  }`}
                  aria-hidden="true"
                >
                  {it.ok ? "✓" : "!"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {it.label}
                  </p>
                  {it.detail && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {it.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Comparative numbers (error mode) — items vs receipt vs diff */}
        {compare && (
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2.5">
              <span className="text-xs text-muted-foreground">{compare.rowA.label}</span>
              <span className="text-sm font-medium tabular-nums">{compare.rowA.value}</span>
            </div>
            <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2.5">
              <span className="text-xs text-muted-foreground">{compare.rowB.label}</span>
              <span className="text-sm font-medium tabular-nums">{compare.rowB.value}</span>
            </div>
            <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5">
              <span className="text-xs text-amber-600 font-medium">{compare.diff.label}</span>
              <span className="text-sm font-medium text-amber-600 tabular-nums">{compare.diff.value}</span>
            </div>
          </div>
        )}

        {/* Numbered hints — what the user should review */}
        {hints && hints.length > 0 && (
          <div className="mb-4">
            {hintsHeader && (
              <p className="text-sm font-medium text-foreground mb-2">{hintsHeader}</p>
            )}
            <ol className="space-y-2 list-none p-0 m-0">
              {hints.map((h, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="shrink-0 w-5 h-5 rounded-full bg-secondary text-muted-foreground text-[11px] font-medium flex items-center justify-center mt-0.5"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">{h.text}</p>
                    {h.example && (
                      <p className="text-xs text-muted-foreground mt-0.5">{h.example}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {primaryLabel && onPrimary && (
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold"
              onClick={onPrimary}
            >
              {primaryLabel}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              variant="outline"
              size="lg"
              className="w-full h-11 text-sm"
              onClick={onSecondary}
            >
              {secondaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
