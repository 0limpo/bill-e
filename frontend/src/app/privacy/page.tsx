"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { detectLanguage, getTranslator, type Language } from "@/lib/i18n";

export default function PrivacyPage() {
  const router = useRouter();
  const [lang, setLang] = useState<Language>("es");

  useEffect(() => {
    setLang(detectLanguage());
  }, []);

  const t = getTranslator(lang);

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

      <h1 className="text-2xl font-bold mb-6">{t("privacy.title")}</h1>
      <p className="text-sm text-muted-foreground mb-8">{t("privacy.lastUpdated")}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s1Title")}</h2>
          <p className="mb-2">{t("privacy.s1Intro")}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>{t("privacy.s1Item1Label")}</strong> {t("privacy.s1Item1Body")}</li>
            <li><strong>{t("privacy.s1Item2Label")}</strong> {t("privacy.s1Item2Body")}</li>
            <li><strong>{t("privacy.s1Item3Label")}</strong> {t("privacy.s1Item3Body")}</li>
            <li><strong>{t("privacy.s1Item4Label")}</strong> {t("privacy.s1Item4Body")}</li>
            <li><strong>{t("privacy.s1Item5Label")}</strong> {t("privacy.s1Item5Body")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s2Title")}</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("privacy.s2Item1")}</li>
            <li>{t("privacy.s2Item2")}</li>
            <li>{t("privacy.s2Item3")}</li>
            <li>{t("privacy.s2Item4")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s3Title")}</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("privacy.s3Item1")}</li>
            <li>{t("privacy.s3Item2")}</li>
            <li>{t("privacy.s3Item3")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s4Title")}</h2>
          <p className="mb-2">{t("privacy.s4Intro")}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>{t("privacy.s4Item1Label")}</strong> {t("privacy.s4Item1Body")}</li>
            <li><strong>{t("privacy.s4Item2Label")}</strong> {t("privacy.s4Item2Body")}</li>
            <li><strong>{t("privacy.s4Item3Label")}</strong> {t("privacy.s4Item3Body")}</li>
            <li><strong>{t("privacy.s4Item4Label")}</strong> {t("privacy.s4Item4Body")}</li>
            <li><strong>{t("privacy.s4Item5Label")}</strong> {t("privacy.s4Item5Body")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s5Title")}</h2>
          <p>{t("privacy.s5Body")}</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s6Title")}</h2>
          <p>{t("privacy.s6Body")}</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("privacy.s7Title")}</h2>
          <p>{t("privacy.s7Body")} <strong>hi@billeocr.com</strong></p>
        </section>
      </div>

      <footer className="mt-12 mb-8 text-center text-xs text-muted-foreground">
        Bill-e &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
