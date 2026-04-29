"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Loader2, LogIn } from "lucide-react";
import { createCollaborativeSession, getBillHistory, getDeviceId } from "@/lib/api";
import { getStoredUser, clearAuth, setStoredUser, startOAuthLogin, handleAuthCallback, verifyToken, refreshStoredUser, type AuthUser } from "@/lib/auth";
import { trackAppOpen, trackPhotoTaken, trackOcrComplete } from "@/lib/tracking";
import { getTranslator, detectLanguage, type Language } from "@/lib/i18n";
import { getInitials } from "@/lib/billEngine";

// Helper to manage recent session in localStorage
const RECENT_SESSION_KEY = "bill-e-recent-session";
const SESSION_MAX_AGE = 1 * 60 * 60 * 1000; // 1 hour

interface RecentSession {
  sessionId: string;
  ownerToken: string;
  role?: "host" | "editor";
  createdAt: number;
}

function saveRecentSession(sessionId: string, ownerToken: string) {
  const data: RecentSession = { sessionId, ownerToken, role: "host", createdAt: Date.now() };
  localStorage.setItem(RECENT_SESSION_KEY, JSON.stringify(data));
}

function getRecentSession(): RecentSession | null {
  try {
    const stored = localStorage.getItem(RECENT_SESSION_KEY);
    if (!stored) return null;
    const data: RecentSession = JSON.parse(stored);
    if (Date.now() - data.createdAt > SESSION_MAX_AGE) {
      localStorage.removeItem(RECENT_SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function getTimeAgo(timestamp: number, t: (key: string) => string): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return t("home.justNow");
  if (minutes < 60) return t("home.minutesAgo").replace("{n}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo").replace("{n}", String(hours));
  return t("home.moreThan24h");
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Compress like WhatsApp: ~1600px, 70% quality
async function compressImage(base64: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 1600;
      let { width, height } = img;

      // Scale down if larger than maxSize
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = (height / width) * maxSize;
          width = maxSize;
        } else {
          width = (width / height) * maxSize;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64;
  });
}


export default function LandingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnedFromAuth = searchParams.has("token");
  const returnedFromPayment = searchParams.get("payment") === "success";
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [recentSession, setRecentSession] = useState<RecentSession | null>(null);
  const [photoSource, setPhotoSource] = useState<"camera" | "gallery">("camera");
  const [lang, setLang] = useState<Language>("es");
  const [billCount, setBillCount] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const t = getTranslator(lang);

  // Load recent session on mount, detect language, and track app open
  useEffect(() => {
    setLang(detectLanguage());
    setRecentSession(getRecentSession());
    trackAppOpen();

    // Read cached bill count immediately (sync, before API)
    const cached = parseInt(localStorage.getItem('bill-e-bill-count') || '0', 10);
    if (cached > 0) setBillCount(cached);

    // Then update from API in background
    const stored = getStoredUser();
    setUser(stored);
    getBillHistory(getDeviceId(), stored?.id)
      .then((res) => {
        setBillCount(res.count);
        localStorage.setItem('bill-e-bill-count', String(res.count));
      })
      .catch(() => {});
  }, []);

  // After a successful Polar payment, the redirect drops us here without
  // an OAuth token. Re-verify the existing stored token so the cached
  // is_premium flag in localStorage matches what the backend now knows.
  useEffect(() => {
    if (!returnedFromPayment) return;
    let cancelled = false;
    (async () => {
      const fresh = await refreshStoredUser();
      if (cancelled) return;
      if (fresh) setUser(fresh);
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("payment");
      newUrl.searchParams.delete("payer");
      router.replace(newUrl.pathname + newUrl.search, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [returnedFromPayment, router]);

  // Process OAuth callback on return (verify token, store user, refresh bill count, clean URL)
  useEffect(() => {
    if (!returnedFromAuth) return;
    const cb = handleAuthCallback();
    const token = cb?.token;
    if (!token) return;
    let cancelled = false;
    (async () => {
      const verified = await verifyToken(token);
      if (cancelled) return;
      if (verified) {
        setStoredUser(verified);
        setUser(verified);
        // Refresh bill count now that we have a user_id
        getBillHistory(getDeviceId(), verified.id)
          .then((res) => {
            setBillCount(res.count);
            localStorage.setItem('bill-e-bill-count', String(res.count));
          })
          .catch(() => {});
      }
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("token");
      newUrl.searchParams.delete("user_id");
      newUrl.searchParams.delete("is_premium");
      router.replace(newUrl.pathname + newUrl.search, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [returnedFromAuth, router]);

  // Close account menu on click outside
  useEffect(() => {
    if (!showAccountMenu) return;
    const onClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showAccountMenu]);

  const handleSignOut = () => {
    clearAuth();
    setUser(null);
    setShowAccountMenu(false);
  };

  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      const authUrl = await startOAuthLogin("google", getDeviceId(), window.location.href);
      window.location.href = authUrl;
    } catch (err) {
      console.error("Sign in error:", err);
      setSigningIn(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";

    if (!file) return;

    // Track photo taken
    trackPhotoTaken(photoSource);

    setIsLoading(true);
    setError(null);

    try {
      setStatus(t("home.compressing"));
      const rawBase64 = await fileToBase64(file);
      const base64 = await compressImage(rawBase64);

      // Step 1: Create empty session
      setStatus(t("home.connecting"));
      const sessionResponse = await fetch(`${API_URL}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        throw new Error(`${t("home.errorCreatingSession")}: ${errorText}`);
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.session_id;

      // Step 2: Process with OCR
      setStatus(t("home.analyzing"));
      const ocrResponse = await fetch(`${API_URL}/api/session/${sessionId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });

      if (!ocrResponse.ok) {
        const errorText = await ocrResponse.text();
        throw new Error(`${t("home.errorOcr")}: ${errorText}`);
      }

      const ocrData = await ocrResponse.json();
      const data = ocrData.data || ocrData;

      // Track OCR complete
      trackOcrComplete(sessionId, data.items?.length || 0, true);

      // Step 3: Create collaborative session with OCR data
      setStatus(t("home.creatingSession"));
      const session = await createCollaborativeSession({
        items: data.items || [],
        total: data.total || 0,
        subtotal: data.subtotal || 0,
        tip: data.tip || 0,
        charges: data.charges || [],
        raw_text: data.raw_text || "",
        decimal_places: data.decimal_places || 0,
        merchant_name: data.merchant_name || "",
      });

      // Save session for "continue" feature
      saveRecentSession(session.session_id, session.owner_token);

      // Redirect to session
      router.push(`/s/${session.session_id}?owner=${session.owner_token}`);
    } catch (err) {
      console.error("Error:", err);
      const message = err instanceof Error ? err.message : t("home.errorProcessing");
      // Simplify error message for users
      if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        setError(t("home.connectionError"));
      } else {
        setError(message);
      }
      setIsLoading(false);
      setStatus("");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 pt-6 pb-8 relative">
      {/* Account control — top-right, swaps content based on auth state */}
      <div className="absolute top-3 right-3 z-10" ref={accountMenuRef}>
        {user ? (
          <>
            <button
              onClick={() => setShowAccountMenu((v) => !v)}
              className="w-9 h-9 rounded-full bg-primary/20 hover:bg-primary/30 flex items-center justify-center transition-colors overflow-hidden"
              aria-label={t("home.accountMenu")}
            >
              {user.picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-semibold text-foreground">
                  {getInitials(user.name || user.email)}
                </span>
              )}
            </button>
            {showAccountMenu && (
              <div className="absolute top-full right-0 mt-2 w-56 bg-card border border-border rounded-xl shadow-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{t("home.signedInAs")}</p>
                <p className="text-sm font-medium text-foreground truncate mb-3">{user.email}</p>
                <button
                  onClick={handleSignOut}
                  className="w-full text-sm text-destructive hover:underline text-left"
                >
                  {t("home.signOut")}
                </button>
              </div>
            )}
          </>
        ) : (
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="px-3 h-9 rounded-full bg-secondary hover:bg-secondary/80 flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors disabled:opacity-60"
          >
            {signingIn ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            <span>{t("home.signIn")}</span>
          </button>
        )}
      </div>

      {/* Hidden file inputs - key forces re-render to fix onChange issues */}
      <input
        key={`camera-${inputKey}`}
        type="file"
        ref={cameraInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        capture
        className="hidden"
      />
      <input
        key={`gallery-${inputKey}`}
        type="file"
        ref={galleryInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        className="hidden"
      />

      {/* Logo */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center mb-2">
          <span className="inline-flex items-center justify-center w-11 h-11 bg-primary rounded-full font-bold text-white leading-none" style={{ fontSize: '1.875rem' }}>B</span>
          <span className="font-bold text-foreground" style={{ fontSize: '1.875rem', marginLeft: '2px' }}>ill-e</span>
        </div>
        <p className="text-base text-muted-foreground">
          {t("app.subtitle")}
        </p>
      </div>

      {/* CTA */}
      <div className="w-full max-w-sm">
        {isLoading ? (
          <div className="h-14 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            {status || t("home.processing")}
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              className="flex-1 h-14 text-lg font-semibold bg-primary/20 hover:bg-primary/30 rounded-xl transition-colors text-foreground"
              onClick={() => {
                setPhotoSource("camera");
                setInputKey(k => k + 1);
                setTimeout(() => cameraInputRef.current?.click(), 50);
              }}
            >
              {t("home.camera")}
            </button>
            <button
              className="flex-1 h-14 text-lg font-semibold bg-primary/20 hover:bg-primary/30 rounded-xl transition-colors text-foreground"
              onClick={() => {
                setPhotoSource("gallery");
                setInputKey(k => k + 1);
                setTimeout(() => galleryInputRef.current?.click(), 50);
              }}
            >
              {t("home.gallery")}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}

        {/* Continue recent session */}
        {recentSession && !isLoading && (
          <button
            className="mt-4 w-full p-3 bg-card hover:bg-card/80 border border-border rounded-xl transition-colors flex items-center gap-3"
            onClick={() => router.push(
              recentSession.role === "editor"
                ? `/s/${recentSession.sessionId}`
                : `/s/${recentSession.sessionId}?owner=${recentSession.ownerToken}`
            )}
          >
            <span className="text-xl">📋</span>
            <div className="text-left flex-1">
              <p className="text-sm font-medium text-foreground">{t("home.continueSession")}</p>
              <p className="text-xs text-muted-foreground">{getTimeAgo(recentSession.createdAt, t)}</p>
            </div>
            <span className="text-muted-foreground">→</span>
          </button>
        )}

        {/* My bills button */}
        {billCount > 0 && (
          <button
            className="mt-4 w-full p-3 bg-card hover:bg-card/80 border border-border rounded-xl transition-colors text-left"
            onClick={() => router.push("/bills")}
          >
            <p className="text-sm font-medium text-foreground">{t("bills.myBills")}</p>
            <p className="text-xs text-muted-foreground">{t("bills.count").replace("{n}", String(billCount))}</p>
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="mt-8 w-full max-w-md space-y-2">
        <div className="bg-card rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
            1
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">{t("home.step1Title")}</p>
            <p className="text-xs text-muted-foreground">{t("home.step1Desc")}</p>
          </div>
        </div>
        <div className="bg-card rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
            2
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">{t("home.step2Title")}</p>
            <p className="text-xs text-muted-foreground">{t("home.step2Desc")}</p>
          </div>
        </div>
        <div className="bg-card rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
            3
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">{t("home.step3Title")}</p>
            <p className="text-xs text-muted-foreground">{t("home.step3Desc")}</p>
          </div>
        </div>
      </div>

      {/* Install Prompt */}
      <div className="mt-6">
        <InstallPrompt t={t} />
      </div>

      {/* Footer */}
      <footer className="mt-6 text-center">
        <p className="text-xs text-muted-foreground">
          {t("home.madeWith")}
        </p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          <a href="/privacy" className="hover:text-foreground underline-offset-2 hover:underline">
            {t("footer.privacy")}
          </a>
          <span className="mx-2">·</span>
          <a href="/terms" className="hover:text-foreground underline-offset-2 hover:underline">
            {t("footer.terms")}
          </a>
        </p>
      </footer>
    </div>
  );
}
