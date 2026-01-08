"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  getPendingPayment,
  clearPendingPayment,
  getPaymentStatus,
  formatPriceCLP,
  type PaymentStatusResponse,
} from "@/lib/payment";

type PaymentState = "loading" | "success" | "pending" | "rejected" | "cancelled" | "error";

function PaymentSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<PaymentState>("loading");
  const [paymentData, setPaymentData] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkPayment = async () => {
      try {
        // Get pending payment from localStorage
        const pendingPayment = getPendingPayment();

        if (!pendingPayment) {
          // Maybe user navigated here directly - check URL params
          // MercadoPago uses external_reference, Flow uses order
          const commerceOrder = searchParams.get("external_reference") || searchParams.get("order");
          if (!commerceOrder) {
            setState("error");
            setError("No se encontró información del pago");
            return;
          }
          // Try to check status anyway
          const status = await getPaymentStatus(commerceOrder);
          handleStatusResponse(status, searchParams.get("session"), null);
          return;
        }

        // Check payment status
        const status = await getPaymentStatus(pendingPayment.commerce_order);
        handleStatusResponse(status, pendingPayment.session_id, pendingPayment.owner_token || null);
      } catch (err) {
        console.error("Error checking payment:", err);
        setState("error");
        setError("Error al verificar el pago");
      }
    };

    const handleStatusResponse = (
      status: PaymentStatusResponse,
      sessionId: string | null,
      ownerToken: string | null
    ) => {
      setPaymentData(status);

      switch (status.status) {
        case "paid":
          setState("success");
          clearPendingPayment();
          // Auto-redirect to session after 3 seconds
          if (sessionId) {
            setTimeout(() => {
              const url = ownerToken
                ? `/s/${sessionId}?owner=${ownerToken}`
                : `/s/${sessionId}`;
              router.push(url);
            }, 3000);
          }
          break;

        case "pending":
          setState("pending");
          // Poll again in 3 seconds
          setTimeout(checkPayment, 3000);
          break;

        case "rejected":
          setState("rejected");
          clearPendingPayment();
          break;

        case "cancelled":
          setState("cancelled");
          clearPendingPayment();
          break;

        default:
          setState("error");
          setError("Estado de pago desconocido");
      }
    };

    checkPayment();
  }, [router, searchParams]);

  const handleReturnToSession = () => {
    const pendingPayment = getPendingPayment();
    if (pendingPayment?.session_id) {
      const url = pendingPayment.owner_token
        ? `/s/${pendingPayment.session_id}?owner=${pendingPayment.owner_token}`
        : `/s/${pendingPayment.session_id}`;
      clearPendingPayment();
      router.push(url);
    } else if (paymentData?.session_id) {
      router.push(`/s/${paymentData.session_id}`);
    } else {
      router.push("/");
    }
  };

  const handleReturnHome = () => {
    clearPendingPayment();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center">
            <span
              className="inline-flex items-center justify-center w-11 h-11 bg-primary rounded-full font-bold text-white leading-none"
              style={{ fontSize: "1.875rem" }}
            >
              B
            </span>
            <span
              className="font-bold text-foreground"
              style={{ fontSize: "1.875rem", marginLeft: "2px" }}
            >
              ill-e
            </span>
          </div>
        </div>

        {/* Status Card */}
        <div className="bg-card rounded-2xl p-6 border border-border">
          {state === "loading" && (
            <div className="text-center">
              <div className="text-4xl mb-4 animate-pulse">⏳</div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Verificando pago...
              </h2>
              <p className="text-sm text-muted-foreground">
                Espera mientras confirmamos tu pago
              </p>
            </div>
          )}

          {state === "pending" && (
            <div className="text-center">
              <div className="text-4xl mb-4 animate-bounce">⏳</div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Procesando pago...
              </h2>
              <p className="text-sm text-muted-foreground">
                Tu pago está siendo procesado. Esto puede tomar unos segundos.
              </p>
            </div>
          )}

          {state === "success" && (
            <div className="text-center">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                ¡Pago exitoso!
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Tu cuenta premium está activa por 1 año
              </p>
              {paymentData?.amount && (
                <p className="text-lg font-bold text-primary mb-4">
                  {formatPriceCLP(paymentData.amount)}
                </p>
              )}
              <p className="text-xs text-muted-foreground mb-6">
                Recibirás tu boleta electrónica por email
              </p>

              <button
                onClick={handleReturnToSession}
                className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
              >
                Continuar a la sesión
              </button>
              <p className="text-xs text-muted-foreground mt-3">
                Redirigiendo automáticamente en 3 segundos...
              </p>
            </div>
          )}

          {state === "rejected" && (
            <div className="text-center">
              <div className="text-5xl mb-4">❌</div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Pago rechazado
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Tu pago fue rechazado. Por favor intenta con otro medio de pago.
              </p>

              <div className="space-y-3">
                <button
                  onClick={handleReturnToSession}
                  className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  Volver e intentar de nuevo
                </button>
                <button
                  onClick={handleReturnHome}
                  className="w-full h-12 bg-card text-foreground font-medium rounded-xl border border-border hover:bg-muted transition-colors"
                >
                  Ir al inicio
                </button>
              </div>
            </div>
          )}

          {state === "cancelled" && (
            <div className="text-center">
              <div className="text-5xl mb-4">🚫</div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Pago cancelado
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Cancelaste el proceso de pago.
              </p>

              <div className="space-y-3">
                <button
                  onClick={handleReturnToSession}
                  className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  Volver a la sesión
                </button>
                <button
                  onClick={handleReturnHome}
                  className="w-full h-12 bg-card text-foreground font-medium rounded-xl border border-border hover:bg-muted transition-colors"
                >
                  Ir al inicio
                </button>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="text-center">
              <div className="text-5xl mb-4">⚠️</div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Error
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {error || "Ocurrió un error al verificar el pago"}
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  Reintentar
                </button>
                <button
                  onClick={handleReturnHome}
                  className="w-full h-12 bg-card text-foreground font-medium rounded-xl border border-border hover:bg-muted transition-colors"
                >
                  Ir al inicio
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          Pago seguro
        </p>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-4xl animate-pulse">⏳</div>
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
