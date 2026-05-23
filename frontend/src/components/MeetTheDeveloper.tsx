"use client";

import { useState } from "react";
import { getTranslator, type Language } from "@/lib/i18n";

interface Props {
  lang: Language;
}

/**
 * Expandable "Meet the developer" card. Shown inline below the TipWidget CTA.
 * The bio is authored by Gonzalo (placeholder content here — replace before launch).
 */
export function MeetTheDeveloper({ lang }: Props) {
  const t = getTranslator(lang);
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-emerald-600 underline-offset-2 hover:underline"
        aria-expanded={open}
      >
        {t("tip_meet_developer")}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 flex gap-3 items-start">
          {/* TODO(Gonzalo): replace src with your photo at /public/about/gonzalo.jpg
              and write your bio. This placeholder must be replaced before launch. */}
          <div className="h-12 w-12 shrink-0 rounded-full bg-emerald-200 flex items-center justify-center text-emerald-700 font-semibold">
            G
          </div>
          <p className="text-gray-700 leading-relaxed">
            {/* Bio placeholder — Gonzalo to author before launch. */}
            (bio pendiente)
          </p>
        </div>
      )}
    </div>
  );
}
