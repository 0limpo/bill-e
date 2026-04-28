"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { detectLanguage, getTranslator, type Language } from "@/lib/i18n";

export default function DeleteAccountPage() {
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

      <h1 className="text-2xl font-bold mb-6">{t("deleteAccount.title")}</h1>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">{t("deleteAccount.howToTitle")}</h2>
          <p className="mb-3">{t("deleteAccount.howToBody")}</p>
          <a
            href="mailto:hi@billeocr.com?subject=Delete%20Bill-e%20account"
            className="inline-block bg-primary text-primary-foreground font-medium py-3 px-6 rounded-xl hover:bg-primary/90 transition-colors"
          >
            hi@billeocr.com
          </a>
          <p className="mt-3 text-muted-foreground">{t("deleteAccount.howToHint")}</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("deleteAccount.whatTitle")}</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t("deleteAccount.what1")}</li>
            <li>{t("deleteAccount.what2")}</li>
            <li>{t("deleteAccount.what3")}</li>
            <li>{t("deleteAccount.what4")}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("deleteAccount.autoTitle")}</h2>
          <p>{t("deleteAccount.autoBody")}</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">{t("deleteAccount.responseTitle")}</h2>
          <p>{t("deleteAccount.responseBody")}</p>
        </section>
      </div>

      <footer className="mt-12 mb-8 text-center text-xs text-muted-foreground">
        Bill-e &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
