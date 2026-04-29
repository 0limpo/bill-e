"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { detectLanguage, getTranslator, type Language } from "@/lib/i18n";

export default function TermsPage() {
  const router = useRouter();
  const [lang, setLang] = useState<Language>("es");

  useEffect(() => {
    setLang(detectLanguage());
  }, []);

  const t = getTranslator(lang);

  const sections = [
    { title: t("terms.s1Title"), body: t("terms.s1Body") },
    { title: t("terms.s2Title"), body: t("terms.s2Body") },
    { title: t("terms.s3Title"), body: t("terms.s3Body") },
    { title: t("terms.s4Title"), body: t("terms.s4Body") },
    { title: t("terms.s5Title"), body: t("terms.s5Body") },
    { title: t("terms.s6Title"), body: t("terms.s6Body") },
    { title: t("terms.s7Title"), body: t("terms.s7Body") },
    { title: t("terms.s8Title"), body: t("terms.s8Body") },
    { title: t("terms.s9Title"), body: t("terms.s9Body") },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/")}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 mb-6"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t("common.back")}
      </button>

      <h1 className="text-2xl font-bold mb-6">{t("terms.title")}</h1>
      <p className="text-sm text-muted-foreground mb-8">{t("terms.lastUpdated")}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        {sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-lg font-semibold mb-2">{s.title}</h2>
            <p>{s.body}</p>
          </section>
        ))}
      </div>

      <footer className="mt-12 mb-8 text-center text-xs text-muted-foreground">
        Bill-e &copy; {new Date().getFullYear()} · Olimpo SpA
      </footer>
    </div>
  );
}
