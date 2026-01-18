"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getMPPublicKey, createMPPreference, processMPCardPayment, getDeviceId } from "@/lib/api";
import { createPayment, storePendingPayment } from "@/lib/payment";
import { detectLanguage, getTranslator, type Language } from "@/lib/i18n";
import { trackPaymentStarted } from "@/lib/tracking";
import { getStoredUser, startOAuthLogin, handleAuthCallback, verifyToken, setStoredUser, type AuthUser } from "@/lib/auth";

declare global {
  interface Window {
    MercadoPago: any;
  }
}

type PaymentStatus = "need_auth" | "loading" | "ready" | "redirecting" | "processing" | "success" | "error";
type PaymentTab = "mercadopago" | "webpay" | "tarjeta";

function PaymentPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const sessionId = searchParams.get("session") || "";
  const userType = (searchParams.get("type") as "host" | "editor") || "editor";
  const ownerToken = searchParams.get("owner") || "";

  const [status, setStatus] = useState<PaymentStatus>("need_auth");
  const [error, setError] = useState<string>("");
  const [preferenceId, setPreferenceId] = useState<string>("");
  const [mpInstance, setMpInstance] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<PaymentTab>("mercadopago");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [lang] = useState<Language>(() => detectLanguage());
  const t = getTranslator(lang);

  const walletBrickRef = useRef<boolean>(false);
  const cardBrickRef = useRef<boolean>(false);

  const amount = 1990; // CLP

  // Check if user is authenticated on mount (also handle OAuth callback)
  useEffect(() => {
    const checkAuth = async () => {
      // First, check if this is an OAuth callback (has token in URL params)
      const callbackResult = handleAuthCallback();

      if (callbackResult?.token) {
        // OAuth callback - verify token and store user
        const verifiedUser = await verifyToken(callbackResult.token);
        if (verifiedUser) {
          setStoredUser(verifiedUser);
          setUser(verifiedUser);
          setStatus("loading");
          // Clean up URL params
          const url = new URL(window.location.href);
          url.searchParams.delete("token");
          url.searchParams.delete("user_id");
          url.searchParams.delete("is_premium");
          window.history.replaceState({}, "", url.toString());
          return;
        }
      }

      // Otherwise, check for existing stored user
      const storedUser = getStoredUser();
      if (storedUser?.email) {
        setUser(storedUser);
        setStatus("loading");
      } else {
        setStatus("need_auth");
      }
    };

    checkAuth();
  }, []);

  // Load MercadoPago SDK script
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.onload = () => {
      console.log("MercadoPago SDK loaded");
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // Initialize MercadoPago and create preference for Wallet Brick (only if authenticated)
  useEffect(() => {
    if (status !== "loading" || !user?.email) return;

    const init = async () => {
      try {
        // Get public key
        const pkResponse = await getMPPublicKey();

        // Create preference for Wallet Brick with Google email
        const prefResponse = await createMPPreference({
          user_type: userType,
          session_id: sessionId,
          google_email: user.email,
        });

        setPreferenceId(prefResponse.preference_id);

        // Store pending payment info
        storePendingPayment({
          commerce_order: prefResponse.commerce_order,
          session_id: sessionId,
          owner_token: ownerToken,
          user_type: userType,
          created_at: new Date().toISOString(),
        });

        // Wait for SDK to load
        const waitForSDK = () => {
          return new Promise<void>((resolve) => {
            const check = () => {
              if (window.MercadoPago) {
                resolve();
              } else {
                setTimeout(check, 100);
              }
            };
            check();
          });
        };

        await waitForSDK();

        // Initialize MercadoPago with detected language
        const mp = new window.MercadoPago(pkResponse.public_key, {
          locale: lang === "en" ? "en-US" : "es-CL",
        });
        setMpInstance(mp);

        setStatus("ready");
      } catch (err: any) {
        console.error("Init error:", err);
        setError(err.message || t("payment.errorInit"));
        setStatus("error");
      }
    };

    init();
  }, [status, user, sessionId, userType, ownerToken, lang]);

  // Render Wallet Brick when tab is active
  useEffect(() => {
    if (status !== "ready" || !mpInstance || !preferenceId || activeTab !== "mercadopago" || walletBrickRef.current) return;

    const renderWalletBrick = async () => {
      try {
        const bricks = mpInstance.bricks();

        await bricks.create("wallet", "walletBrick_container", {
          initialization: {
            preferenceId: preferenceId,
            redirectMode: "self",
          },
          customization: {
            visual: {
              buttonBackground: "#00B1EA",
              borderRadius: "12px",
            },
          },
        });
        walletBrickRef.current = true;
      } catch (err: any) {
        console.error("Wallet Brick error:", err);
      }
    };

    renderWalletBrick();
  }, [status, mpInstance, preferenceId, activeTab]);

  // Render Card Payment Brick when tab is active
  useEffect(() => {
    if (status !== "ready" || !mpInstance || !user?.email || activeTab !== "tarjeta" || cardBrickRef.current) return;

    const renderCardBrick = async () => {
      try {
        const bricks = mpInstance.bricks();

        await bricks.create("cardPayment", "cardPaymentBrick_container", {
          initialization: {
            amount: amount,
          },
          customization: {
            visual: {
              style: {
                theme: "dark",
              },
            },
            paymentMethods: {
              maxInstallments: 1,
            },
          },
          callbacks: {
            onReady: () => {
              console.log("Card Payment Brick ready");
            },
            onSubmit: async (cardFormData: any) => {
              console.log("Card form submitted:", cardFormData);
              trackPaymentStarted(sessionId, "mercadopago");
              setStatus("processing");

              try {
                const result = await processMPCardPayment({
                  token: cardFormData.token,
                  transaction_amount: amount,
                  installments: cardFormData.installments || 1,
                  payment_method_id: cardFormData.payment_method_id,
                  issuer_id: cardFormData.issuer_id,
                  payer_email: cardFormData.payer.email,
                  user_type: userType,
                  google_email: user.email,
                  session_id: sessionId,
                });

                if (result.success) {
                  setStatus("success");
                  // Update pending payment with the new commerce_order from card payment
                  storePendingPayment({
                    commerce_order: result.commerce_order,
                    session_id: sessionId,
                    owner_token: ownerToken,
                    user_type: userType,
                    created_at: new Date().toISOString(),
                  });
                  setTimeout(() => {
                    router.push(`/payment/success?session=${sessionId}&type=${userType}&status=approved&order=${result.commerce_order}`);
                  }, 1500);
                } else {
                  setError(result.status_detail || t("payment.errorRejected"));
                  setStatus("error");
                }
              } catch (err: any) {
                console.error("Payment error:", err);
                setError(err.message || t("payment.errorPayment"));
                setStatus("error");
              }
            },
            onError: (error: any) => {
              console.error("Brick error:", error);
              setError(error.message || t("payment.errorForm"));
            },
          },
        });
        cardBrickRef.current = true;
      } catch (err: any) {
        console.error("Card Brick error:", err);
      }
    };

    renderCardBrick();
  }, [status, mpInstance, activeTab, amount, userType, sessionId, router, user]);

  // Handle redirect to Flow.cl for Webpay
  const handleWebpayRedirect = async () => {
    if (!user?.email) return;

    trackPaymentStarted(sessionId, "webpay");
    setStatus("redirecting");
    try {
      // Create Flow payment order with Google email
      const result = await createPayment({
        user_type: userType,
        google_email: user.email,
        session_id: sessionId,
      });

      if (!result.success || !result.payment_url) {
        throw new Error(t("payment.errorCreateOrder"));
      }

      // Store pending payment info
      storePendingPayment({
        commerce_order: result.commerce_order,
        session_id: sessionId,
        owner_token: ownerToken,
        user_type: userType,
        created_at: new Date().toISOString(),
      });

      // Redirect to Flow.cl (which shows Webpay bank selection)
      window.location.href = result.payment_url;
    } catch (err: any) {
      console.error("Webpay redirect error:", err);
      setError(err.message || t("payment.errorProcessing"));
      setStatus("error");
    }
  };

  // Handle Google login
  const handleGoogleLogin = async () => {
    try {
      const deviceId = getDeviceId();
      // Build redirect URL back to payment page
      const currentUrl = window.location.href;
      const authUrl = await startOAuthLogin("google", deviceId, currentUrl);
      window.location.href = authUrl;
    } catch (err: any) {
      console.error("Google login error:", err);
      setError(err.message || t("payment.errorGoogleLogin"));
    }
  };

  const handleBack = () => {
    if (sessionId) {
      router.push(`/s/${sessionId}${ownerToken ? `?owner=${ownerToken}` : ""}`);
    } else {
      router.push("/");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <button
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("payment.back")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 max-w-md mx-auto w-full">
        {/* Product info */}
        <div className="bg-card rounded-xl p-4 mb-6">
          <div className="flex justify-between items-start mb-2">
            <h1 className="text-xl font-bold">{t("payment.productName")}</h1>
            <span className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">{t("payment.productDuration")}</span>
          </div>
          <p className="text-muted-foreground text-sm mb-3">{t("payment.productDesc")}</p>
          <div className="text-3xl font-bold">${amount.toLocaleString(lang === "en" ? "en-US" : "es-CL")}</div>
        </div>

        {/* Need authentication */}
        {status === "need_auth" && (
          <div className="text-center py-8">
            <div className="mb-6">
              <svg className="w-16 h-16 mx-auto text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <h2 className="text-lg font-semibold mb-2">{t("payment.authRequired")}</h2>
              <p className="text-muted-foreground text-sm mb-6">
                {t("payment.authRequiredDesc")}
              </p>
            </div>
            <button
              onClick={handleGoogleLogin}
              className="w-full bg-white hover:bg-gray-100 text-gray-800 font-medium py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-3 border border-gray-300"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {t("payment.continueWithGoogle")}
            </button>
            <p className="text-xs text-muted-foreground mt-4">
              {t("payment.authBenefit")}
            </p>
          </div>
        )}

        {/* Loading status */}
        {status === "loading" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t("payment.loadingMethods")}</p>
            {user?.email && (
              <p className="text-xs text-muted-foreground mt-2">
                {t("payment.loggedInAs")} {user.email}
              </p>
            )}
          </div>
        )}

        {status === "redirecting" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">
              {activeTab === "webpay" ? t("payment.redirectingWebpay") : t("payment.redirectingMP")}
            </p>
          </div>
        )}

        {status === "processing" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t("payment.processing")}</p>
          </div>
        )}

        {status === "success" && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-success rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-success text-lg font-medium">{t("payment.success")}</p>
            <p className="text-muted-foreground text-sm mt-2">{t("payment.successRedirecting")}</p>
          </div>
        )}

        {status === "error" && (
          <div className="bg-destructive/10 border border-destructive/50 rounded-xl p-4 mb-6">
            <p className="text-destructive">{error}</p>
            <button
              onClick={() => {
                setStatus("ready");
                setError("");
              }}
              className="mt-3 text-sm text-primary hover:underline"
            >
              {t("payment.retry")}
            </button>
          </div>
        )}

        {/* Payment forms */}
        {(status === "ready" || status === "error") && user?.email && (
          <>
            {/* Logged in user info */}
            <div className="bg-card rounded-lg p-3 mb-4 flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.email}</p>
                <p className="text-xs text-muted-foreground">{t("payment.premiumLinkedTo")}</p>
              </div>
            </div>

            {/* Payment method tabs */}
            <div className="flex rounded-xl overflow-hidden mb-6 bg-secondary">
              <button
                onClick={() => setActiveTab("mercadopago")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-all ${
                  activeTab === "mercadopago"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                Mercado Pago
              </button>
              <button
                onClick={() => setActiveTab("webpay")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-all ${
                  activeTab === "webpay"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                {t("payment.tabWebpay")}
              </button>
              <button
                onClick={() => setActiveTab("tarjeta")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-all ${
                  activeTab === "tarjeta"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                {t("payment.tabCard")}
              </button>
            </div>

            {/* MercadoPago Wallet Tab Content */}
            <div className={activeTab === "mercadopago" ? "block" : "hidden"}>
              <div id="walletBrick_container"></div>
            </div>

            {/* Webpay Tab Content */}
            <div className={activeTab === "webpay" ? "block" : "hidden"}>
              <button
                onClick={handleWebpayRedirect}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                {t("payment.payWithWebpay")}
              </button>
              <p className="text-muted-foreground text-xs text-center mt-3">
                {t("payment.webpayRedirectNote")}
              </p>
            </div>

            {/* Card Payment Tab Content */}
            <div className={activeTab === "tarjeta" ? "block" : "hidden"}>
              <div id="cardPaymentBrick_container"></div>
            </div>
          </>
        )}

        {/* Security note */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {t("payment.poweredBy")} {status === "need_auth" ? "MercadoPago & Transbank" : (activeTab === "webpay" ? "Transbank" : "MercadoPago")}
          </p>
        </div>
      </div>
    </div>
  );
}

// Loading fallback for Suspense
function PaymentLoading() {
  const lang = detectLanguage();
  const t = getTranslator(lang);
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-muted-foreground">{t("payment.loadingMethods")}</p>
      </div>
    </div>
  );
}

// Wrapper with Suspense for useSearchParams
export default function PaymentPage() {
  return (
    <Suspense fallback={<PaymentLoading />}>
      <PaymentPageContent />
    </Suspense>
  );
}
