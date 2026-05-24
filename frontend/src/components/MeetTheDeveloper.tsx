"use client";

import { useState } from "react";
import { getTranslator, type Language } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  lang: Language;
}

/**
 * Inline expandable "Meet the developer" card, embedded inside TipWidget.
 * The bio is authored by Gonzalo (placeholder content here — replace before launch).
 */
export function MeetTheDeveloper({ lang }: Props) {
  const t = getTranslator(lang);
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-border/50 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <span>{t("tip_meet_developer")}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={cn("transition-transform duration-200", open && "rotate-180")}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr] mt-3" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn(
              "flex gap-3 items-start rounded-lg border border-border/60 bg-secondary/50 p-3 transition-opacity duration-200",
              open ? "opacity-100 delay-75" : "opacity-0",
            )}
          >
            {/* TODO(Gonzalo): replace with your photo at /public/about/gonzalo.jpg
                and write your bio. This placeholder must be replaced before launch. */}
            <div className="h-11 w-11 shrink-0 rounded-full bg-primary/15 ring-1 ring-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
              G
            </div>
            <p className="text-xs leading-relaxed text-foreground/80">
              {/* Bio placeholder — Gonzalo to author before launch. */}
              (bio pendiente)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
