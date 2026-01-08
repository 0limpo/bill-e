"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getMPPublicKey, createMPPreference, processMPCardPayment } from "@/lib/api";
import { storePendingPayment } from "@/lib/payment";

declare global {
  interface Window {
    MercadoPago: any;
  }
}

type PaymentStatus = "loading" | "ready" | "processing" | "success" | "error";

function PaymentPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const sessionId = searchParams.get("session") || "";
  const userType = (searchParams.get("type") as "host" | "editor") || "editor";
  const ownerToken = searchParams.get("owner") || "";

  const [status, setStatus] = useState<PaymentStatus>("loading");
  const [error, setError] = useState<string>("");
  const [publicKey, setPublicKey] = useState<string>("");
  const [preferenceId, setPreferenceId] = useState<string>("");
  const [commerceOrder, setCommerceOrder] = useState<string>("");
  const [mpInstance, setMpInstance] = useState<any>(null);
  const [cardPaymentBrick, setCardPaymentBrick] = useState<any>(null);

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

  // Initialize MercadoPago and create preference
  useEffect(() => {
    const init = async () => {
      try {
        // Get public key
        const pkResponse = await getMPPublicKey();
        setPublicKey(pkResponse.public_key);

        // Create preference for Wallet Brick
        const prefResponse = await createMPPreference({
          user_type: userType,
          session_id: sessionId,
        });

        setPreferenceId(prefResponse.preference_id);
        setCommerceOrder(prefResponse.commerce_order);

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

  // Render Card Payment Brick
  useEffect(() => {
    if (status !== "ready" || !mpInstance || cardPaymentBrick) return;

    const renderCardBrick = async () => {
      try {
        const bricks = mpInstance.bricks();

        const brick = await bricks.create("cardPayment", "cardPaymentBrick_container", {
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
              maxInstallments: 1, // No installments
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
                  // Redirect to success page
                  setTimeout(() => {
                    router.push(`/payment/success?session=${sessionId}&status=approved&order=${result.commerce_order}`);
                  }, 1500);
                } else {
                  setError(result.status_detail || "Payment rejected");
                  setStatus("error");
                }
              } catch (err: any) {
                console.error("Payment error:", err);
                setError(err.message || "Payment failed");
                setStatus("error");
              }
            },
            onError: (error: any) => {
              console.error("Brick error:", error);
              setError(error.message || "Payment form error");
            },
          },
        });

        setCardPaymentBrick(brick);
      } catch (err: any) {
        console.error("Brick render error:", err);
        setError(err.message || "Error rendering payment form");
      }
    };

    renderCardBrick();
  }, [status, mpInstance, cardPaymentBrick, amount, userType, sessionId, router]);

  // Render Wallet Brick
  useEffect(() => {
    if (status !== "ready" || !mpInstance || !preferenceId) return;

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
      } catch (err: any) {
        console.error("Wallet Brick error:", err);
      }
    };

    renderWalletBrick();
  }, [status, mpInstance, preferenceId]);

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
            <span className="bg-blue-600 text-xs px-2 py-1 rounded-full">1 año</span>
          </div>
          <p className="text-gray-400 text-sm mb-3">Uso ilimitado como anfitrión e invitado</p>
          <div className="text-3xl font-bold">${amount.toLocaleString("es-CL")}</div>
        </div>

        {/* Status messages */}
        {status === "loading" && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Cargando métodos de pago...</p>
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
            <p className="text-green-400 text-lg font-medium">¡Pago exitoso!</p>
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
            {/* Wallet Brick - MercadoPago (Primary option) */}
            <div className="mb-6">
              <div className="bg-[#00b1ea] rounded-xl p-4 mb-3">
                <div className="flex items-center gap-3 mb-2">
                  <svg className="w-8 h-8" viewBox="0 0 48 48" fill="white">
                    <path d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20S35.046 4 24 4zm0 36c-8.837 0-16-7.163-16-16S15.163 8 24 8s16 7.163 16 16-7.163 16-16 16z"/>
                    <path d="M24 12c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm0 20c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8z"/>
                  </svg>
                  <div>
                    <h2 className="text-white font-bold text-lg">MercadoPago</h2>
                    <p className="text-white/80 text-sm">Saldo, créditos o tarjetas guardadas</p>
                  </div>
                </div>
              </div>
              <div id="walletBrick_container"></div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-gray-700"></div>
              <span className="text-gray-500 text-sm">o paga con tarjeta</span>
              <div className="flex-1 h-px bg-gray-700"></div>
            </div>

            {/* Card Payment Brick */}
            <div>
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
