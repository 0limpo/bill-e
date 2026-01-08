"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getMPPublicKey, createMPPreference, processMPCardPayment } from "@/lib/api";
import { createPayment, storePendingPayment } from "@/lib/payment";

declare global {
  interface Window {
    MercadoPago: any;
  }
}

type PaymentStatus = "loading" | "ready" | "redirecting" | "processing" | "success" | "error";
type PaymentTab = "mercadopago" | "webpay" | "tarjeta";

function PaymentPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const sessionId = searchParams.get("session") || "";
  const userType = (searchParams.get("type") as "host" | "editor") || "editor";
  const ownerToken = searchParams.get("owner") || "";

  const [status, setStatus] = useState<PaymentStatus>("loading");
  const [error, setError] = useState<string>("");
  const [preferenceId, setPreferenceId] = useState<string>("");
  const [mpInstance, setMpInstance] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<PaymentTab>("mercadopago");

  const walletBrickRef = useRef<boolean>(false);
  const cardBrickRef = useRef<boolean>(false);

  const amount = 1990; // CLP

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
      document.body.removeChild(script);
    };
  }, []);

  // Initialize MercadoPago and create preference for Wallet Brick
  useEffect(() => {
    const init = async () => {
      try {
        // Get public key
        const pkResponse = await getMPPublicKey();

        // Create preference for Wallet Brick
        const prefResponse = await createMPPreference({
          user_type: userType,
          session_id: sessionId,
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

        // Initialize MercadoPago
        const mp = new window.MercadoPago(pkResponse.public_key, {
          locale: "es-CL",
        });
        setMpInstance(mp);

        setStatus("ready");
      } catch (err: any) {
        console.error("Init error:", err);
        setError(err.message || "Error initializing payment");
        setStatus("error");
      }
    };

    init();
  }, [sessionId, userType, ownerToken]);

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
              buttonBackground: "black",
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
    if (status !== "ready" || !mpInstance || activeTab !== "tarjeta" || cardBrickRef.current) return;

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
                  session_id: sessionId,
                });

                if (result.success) {
                  setStatus("success");
                  setTimeout(() => {
                    router.push(`/payment/success?session=${sessionId}&status=approved&order=${result.commerce_order}`);
                  }, 1500);
                } else {
                  setError(result.status_detail || "Pago rechazado");
                  setStatus("error");
                }
              } catch (err: any) {
                console.error("Payment error:", err);
                setError(err.message || "Error en el pago");
                setStatus("error");
              }
            },
            onError: (error: any) => {
              console.error("Brick error:", error);
              setError(error.message || "Error en el formulario");
            },
          },
        });
        cardBrickRef.current = true;
      } catch (err: any) {
        console.error("Card Brick error:", err);
      }
    };

    renderCardBrick();
  }, [status, mpInstance, activeTab, amount, userType, sessionId, router]);

  // Handle redirect to Flow.cl for Webpay
  const handleWebpayRedirect = async () => {
    setStatus("redirecting");
    try {
      // Create Flow payment order
      const result = await createPayment({
        user_type: userType,
        session_id: sessionId,
      });

      if (!result.success || !result.payment_url) {
        throw new Error("Error al crear orden de pago");
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
      setError(err.message || "Error al procesar pago");
      setStatus("error");
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
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <button
          onClick={handleBack}
          className="text-gray-400 hover:text-white flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Volver
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 max-w-md mx-auto w-full">
        {/* Product info */}
        <div className="bg-gray-900 rounded-xl p-4 mb-6">
          <div className="flex justify-between items-start mb-2">
            <h1 className="text-xl font-bold">Bill-e Premium</h1>
            <span className="bg-blue-600 text-xs px-2 py-1 rounded-full">1 ano</span>
          </div>
          <p className="text-gray-400 text-sm mb-3">Uso ilimitado como anfitrion e invitado</p>
          <div className="text-3xl font-bold">${amount.toLocaleString("es-CL")}</div>
        </div>

        {/* Status messages */}
        {status === "loading" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Cargando metodos de pago...</p>
          </div>
        )}

        {status === "redirecting" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Redirigiendo a Webpay...</p>
          </div>
        )}

        {status === "processing" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Procesando pago...</p>
          </div>
        )}

        {status === "success" && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-green-400 text-lg font-medium">Pago exitoso!</p>
            <p className="text-gray-400 text-sm mt-2">Redirigiendo...</p>
          </div>
        )}

        {status === "error" && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-xl p-4 mb-6">
            <p className="text-red-400">{error}</p>
            <button
              onClick={() => {
                setStatus("ready");
                setError("");
              }}
              className="mt-3 text-sm text-blue-400 hover:underline"
            >
              Intentar de nuevo
            </button>
          </div>
        )}

        {/* Payment forms */}
        {(status === "ready" || status === "error") && (
          <>
            {/* Payment method tabs */}
            <div className="flex rounded-xl overflow-hidden mb-6 bg-secondary">
              <button
                onClick={() => setActiveTab("mercadopago")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-all ${
                  activeTab === "mercadopago"
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                Mercado Pago
              </button>
              <button
                onClick={() => setActiveTab("webpay")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-all ${
                  activeTab === "webpay"
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                Webpay
              </button>
              <button
                onClick={() => setActiveTab("tarjeta")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-all ${
                  activeTab === "tarjeta"
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                Tarjeta
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
                className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                Pagar con Webpay
              </button>
              <p className="text-muted-foreground text-xs text-center mt-3">
                Seras redirigido a Webpay para seleccionar tu banco
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
          <p className="text-xs text-gray-500">
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Pago seguro procesado por {activeTab === "webpay" ? "Transbank" : "MercadoPago"}
          </p>
        </div>
      </div>
    </div>
  );
}

// Loading fallback for Suspense
function PaymentLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-400">Cargando...</p>
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
