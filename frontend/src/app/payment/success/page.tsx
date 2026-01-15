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
import { trackPaymentComplete } from "@/lib/tracking";
import { detectLanguage, getTranslator } from "@/lib/i18n";

type PaymentState = "loading" | "success" | "pending" | "rejected" | "cancelled" | "error";

function PaymentSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<PaymentState>("loading");
  const [paymentData, setPaymentData] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = detectLanguage();
  const t = getTranslator(lang);

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
            setError(t("payment.errorDesc"));
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
        setError(t("payment.errorDesc"));
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
          // Track payment completion
          if (sessionId) {
            trackPaymentComplete(sessionId, status.payment_method || "unknown");
          }
          // Auto-redirect after 3 seconds
          setTimeout(() => {
            if (sessionId) {
              const url = ownerToken
                ? `/s/${sessionId}?owner=${ownerToken}&payment=success`
                : `/s/${sessionId}?payment=success`;
              router.push(url);
            } else {
              router.push("/");
            }
          }, 3000);
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
          setError(t("payment.errorDesc"));
      }
    };

    checkPayment();
  }, [router, searchParams, t]);

  const handleReturnToSession = () => {
    const pendingPayment = getPendingPayment();
    if (pendingPayment?.session_id) {
      // Add payment=success param so session page knows to auto-finalize
      const url = pendingPayment.owner_token
        ? `/s/${pendingPayment.session_id}?owner=${pendingPayment.owner_token}&payment=success`
        : `/s/${pendingPayment.session_id}?payment=success`;
      clearPendingPayment();
      router.push(url);
    } else if (paymentData?.session_id) {
      router.push(`/s/${paymentData.session_id}?payment=success`);
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
              <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                {t("payment.verifying")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("payment.verifyingDesc")}
              </p>
            </div>
          )}

          {state === "pending" && (
            <div className="text-center">
              <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                {t("payment.processing")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("payment.processingDesc")}
              </p>
            </div>
          )}

          {state === "success" && (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {t("payment.success")}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                {t("payment.successDesc")}
              </p>
              {paymentData?.amount && (
                <p className="text-lg font-bold text-primary mb-4">
                  {formatPriceCLP(paymentData.amount)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("payment.redirecting")}
              </p>
            </div>
          )}

          {state === "rejected" && (
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {t("payment.rejected")}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {t("payment.rejectedDesc")}
              </p>

              <div className="space-y-3">
                <button
                  onClick={handleReturnToSession}
                  className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  {t("payment.tryAgain")}
                </button>
                <button
                  onClick={handleReturnHome}
                  className="w-full h-12 bg-card text-foreground font-medium rounded-xl border border-border hover:bg-muted transition-colors"
                >
                  {t("payment.goHome")}
                </button>
              </div>
            </div>
          )}

          {state === "cancelled" && (
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {t("payment.cancelled")}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {t("payment.cancelledDesc")}
              </p>

              <div className="space-y-3">
                <button
                  onClick={handleReturnToSession}
                  className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  {t("payment.returnToSession")}
                </button>
                <button
                  onClick={handleReturnHome}
                  className="w-full h-12 bg-card text-foreground font-medium rounded-xl border border-border hover:bg-muted transition-colors"
                >
                  {t("payment.goHome")}
                </button>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="text-center">
              <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {t("payment.error")}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {error || t("payment.errorDesc")}
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  {t("payment.retry")}
                </button>
                <button
                  onClick={handleReturnHome}
                  className="w-full h-12 bg-card text-foreground font-medium rounded-xl border border-border hover:bg-muted transition-colors"
                >
                  {t("payment.goHome")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          {t("payment.poweredBy")} MercadoPago
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
          <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
