"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getMPPublicKey, createMPPreference } from "@/lib/api";
import { storePendingPayment } from "@/lib/payment";

declare global {
  interface Window {
    MercadoPago: any;
  }
}

type PaymentStatus = "loading" | "ready" | "redirecting" | "error";
type PaymentTab = "mercadopago" | "credit" | "debit";

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

        // Create preference for Wallet Brick (no filter = all methods)
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

  // Handle redirect to Checkout Pro for credit/debit cards
  const handleCardRedirect = async (cardType: "credit_card" | "debit_card") => {
    setStatus("redirecting");
    try {
      // Create preference with payment method filter
      const prefResponse = await createMPPreference({
        user_type: userType,
        session_id: sessionId,
        payment_method_filter: cardType,
      });

      // Store pending payment info
      storePendingPayment({
        commerce_order: prefResponse.commerce_order,
        session_id: sessionId,
        owner_token: ownerToken,
        user_type: userType,
        created_at: new Date().toISOString(),
      });

      // Redirect to MercadoPago Checkout Pro
      const redirectUrl = prefResponse.init_point || prefResponse.sandbox_init_point;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        throw new Error("No redirect URL received");
      }
    } catch (err: any) {
      console.error("Redirect error:", err);
      setError(err.message || "Error processing payment");
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
            <p className="text-gray-400">Redirigiendo a MercadoPago...</p>
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
            <div className="flex rounded-xl overflow-hidden mb-6 bg-gray-800">
              <button
                onClick={() => setActiveTab("mercadopago")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === "mercadopago"
                    ? "bg-[#00B1EA] text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.5 2C9.46 2 7 4.46 7 7.5c0 1.33.47 2.55 1.26 3.5H5.5C3.57 11 2 12.57 2 14.5c0 1.93 1.57 3.5 3.5 3.5h.5v2c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-2h.5c1.93 0 3.5-1.57 3.5-3.5 0-1.93-1.57-3.5-3.5-3.5h-2.76c.79-.95 1.26-2.17 1.26-3.5C17 4.46 14.54 2 11.5 2h1z"/>
                  </svg>
                  <span>Mercado Pago</span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab("credit")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === "credit"
                    ? "bg-[#00B1EA] text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span>Credito</span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab("debit")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === "debit"
                    ? "bg-[#00B1EA] text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span>Debito</span>
                </div>
              </button>
            </div>

            {/* MercadoPago Wallet Tab Content */}
            <div className={activeTab === "mercadopago" ? "block" : "hidden"}>
              <div className="bg-[#FFE600] rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#00B1EA] rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="white">
                      <path d="M12.5 2C9.46 2 7 4.46 7 7.5c0 1.33.47 2.55 1.26 3.5H5.5C3.57 11 2 12.57 2 14.5c0 1.93 1.57 3.5 3.5 3.5h.5v2c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-2h.5c1.93 0 3.5-1.57 3.5-3.5 0-1.93-1.57-3.5-3.5-3.5h-2.76c.79-.95 1.26-2.17 1.26-3.5C17 4.46 14.54 2 11.5 2h1z"/>
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-gray-900 font-bold text-lg">Mercado Pago</h2>
                    <p className="text-gray-700 text-sm">Saldo, creditos o tarjetas guardadas</p>
                  </div>
                </div>
              </div>
              <div id="walletBrick_container"></div>
            </div>

            {/* Credit Card Tab Content */}
            <div className={activeTab === "credit" ? "block" : "hidden"}>
              <div className="bg-gray-800 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">Tarjeta de Credito</h2>
                    <p className="text-gray-400 text-sm">Visa, Mastercard, American Express</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleCardRedirect("credit_card")}
                className="w-full bg-[#00B1EA] hover:bg-[#0095c8] text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                Pagar con Tarjeta de Credito
              </button>
              <p className="text-gray-500 text-xs text-center mt-3">
                Seras redirigido a MercadoPago para completar el pago de forma segura
              </p>
            </div>

            {/* Debit Card Tab Content */}
            <div className={activeTab === "debit" ? "block" : "hidden"}>
              <div className="bg-gray-800 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-lg">Tarjeta de Debito</h2>
                    <p className="text-gray-400 text-sm">Redcompra, Visa Debito, Mastercard Debito</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleCardRedirect("debit_card")}
                className="w-full bg-[#00B1EA] hover:bg-[#0095c8] text-white font-bold py-4 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                Pagar con Tarjeta de Debito
              </button>
              <p className="text-gray-500 text-xs text-center mt-3">
                Seras redirigido a MercadoPago para completar el pago de forma segura
              </p>
            </div>
          </>
        )}

        {/* Security note */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500">
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Pago seguro procesado por MercadoPago
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
