"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { getBillHistory, getDeviceId, type BillHistoryItem } from "@/lib/api";
import { getAvatarColor, getInitials, formatCurrency } from "@/lib/billEngine";
import { getTranslator, detectLanguage, type Language } from "@/lib/i18n";
import { getStoredUser } from "@/lib/auth";

const MONTH_KEYS = [
  "bills.january", "bills.february", "bills.march", "bills.april",
  "bills.may", "bills.june", "bills.july", "bills.august",
  "bills.september", "bills.october", "bills.november", "bills.december",
];

interface GroupedBills {
  label: string;
  bills: BillHistoryItem[];
}

function groupBillsByDate(bills: BillHistoryItem[], t: (key: string) => string): GroupedBills[] {
  const now = new Date();
  const todayStr = now.toDateString();

  // Start of this week (Monday)
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const groups: Record<string, BillHistoryItem[]> = {};
  const groupOrder: string[] = [];

  for (const bill of bills) {
    const date = new Date(bill.created_at);
    let label: string;

    if (date.toDateString() === todayStr) {
      label = t("bills.today");
    } else if (date >= weekStart) {
      label = t("bills.thisWeek");
    } else {
      const monthKey = MONTH_KEYS[date.getMonth()];
      label = `${t(monthKey)} ${date.getFullYear()}`;
    }

    if (!groups[label]) {
      groups[label] = [];
      groupOrder.push(label);
    }
    groups[label].push(bill);
  }

  return groupOrder.map((label) => ({ label, bills: groups[label] }));
}

export default function BillsHistoryPage() {
  const router = useRouter();
  const [bills, setBills] = useState<BillHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Language>("es");

  const t = getTranslator(lang);

  useEffect(() => {
    setLang(detectLanguage());

    const user = getStoredUser();
    getBillHistory(getDeviceId(), user?.id)
      .then((res) => {
        setBills(res.bills);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const grouped = groupBillsByDate(bills, t);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-md sticky top-0 bg-background z-10 flex items-center gap-3 px-4 py-4">
        <button
          onClick={() => router.push("/")}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">{t("bills.myBills")}</h1>
        <span className="text-sm text-muted-foreground/60 ml-auto">
          {t("bills.count").replace("{n}", String(bills.length))}
        </span>
      </div>

      {/* Content */}
      <div className="w-full max-w-md px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : bills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <span className="text-2xl">🧾</span>
            </div>
            <p className="text-foreground font-medium">{t("bills.noBills")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("bills.noBillsDesc")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {grouped.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider pt-3 pb-1">
                  {group.label}
                </p>
                {group.bills.map((bill) => (
                  <BillCard key={bill.session_id} bill={bill} t={t} onClick={() => {
                    router.push(`/s/${bill.session_id}?view=results`);
                  }} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fixed bottom back button with gradient */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none">
        <div className="w-full max-w-md">
          <div className="h-6 bg-gradient-to-t from-background to-transparent" />
          <div className="bg-background px-4 pb-6 pointer-events-auto">
            <button
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              onClick={() => router.push("/")}
            >
              <ChevronLeft className="w-4 h-4" />
              {t("bills.back")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillCard({ bill, t, onClick }: { bill: BillHistoryItem; t: (key: string) => string; onClick: () => void }) {
  const date = new Date(bill.created_at);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isToday = date.toDateString() === new Date().toDateString();
  const dateStr = isToday ? timeStr : `${date.getDate()}/${date.getMonth() + 1} · ${timeStr}`;

  // Better name fallback: bill_name > merchant_name > default + short date
  const displayName = bill.bill_name
    || bill.merchant_name
    || `${t("bills.defaultName")} ${date.getDate()}/${date.getMonth() + 1}`;

  return (
    <button
      className="w-full bg-card rounded-xl p-3.5 mb-1.5 text-left hover:bg-card/80 active:bg-card/70 transition-colors"
      onClick={onClick}
    >
      {/* Row 1: name + avatars + total */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
          {displayName}
        </span>

        {/* Avatar stack */}
        <div className="flex flex-shrink-0">
          {bill.participants.slice(0, 4).map((name, i) => (
            <div
              key={i}
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-medium text-white border-2 border-card"
              style={{
                backgroundColor: getAvatarColor(name, i),
                marginLeft: i === 0 ? 0 : -5,
              }}
            >
              {getInitials(name)}
            </div>
          ))}
          {bill.participants_count > 4 && (
            <div
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-medium text-muted-foreground bg-muted border-2 border-card"
              style={{ marginLeft: -5 }}
            >
              +{bill.participants_count - 4}
            </div>
          )}
        </div>

        <span className="text-sm font-semibold text-foreground flex-shrink-0">
          {formatCurrency(bill.total || 0)}
        </span>
      </div>

      {/* Row 2: your share + time */}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-muted-foreground">
          {bill.user_share != null && (
            <>
              {t("bills.yourShare")}{" "}
              <span className="text-foreground font-medium">
                {formatCurrency(bill.user_share)}
              </span>
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/60">{dateStr}</span>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
        </div>
      </div>
    </button>
  );
}
