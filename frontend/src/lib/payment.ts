/**
 * payment.ts
 * Payment client for Bill-e - Flow.cl integration
 */

import { getDeviceId } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";

// --- Types ---

export interface CreatePaymentResponse {
  success: boolean;
  payment_url: string;
  commerce_order: string;
  amount: number;
  flow_order?: number;
}

export interface PaymentStatusResponse {
  success: boolean;
  status: "pending" | "paid" | "rejected" | "cancelled" | "not_found";
  commerce_order: string;
  amount?: number;
  paid_at?: string;
  premium_expires?: string;
  user_type?: "host" | "editor";
  session_id?: string;
  payment_method?: string;
}

export interface PriceResponse {
  price: number;
  currency: string;
  description: string;
}

// --- LocalStorage Keys ---

const PENDING_PAYMENT_KEY = "bill-e-pending-payment";

export interface PendingPayment {
  commerce_order: string;
  session_id: string;
  owner_token?: string;
  user_type: "host" | "editor";
  phone?: string;
  created_at: string;
}

// --- Helper ---

async function paymentRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Payment API error: ${response.status}`);
  }

  return response.json();
}

// --- Payment Functions ---

/**
 * Create a payment order and get the Flow.cl redirect URL
 */
export async function createPayment(params: {
  user_type: "host" | "editor";
  phone?: string;
  session_id?: string;
}): Promise<CreatePaymentResponse> {
  const deviceId = getDeviceId();

  return paymentRequest<CreatePaymentResponse>("/api/payment/create", {
    method: "POST",
    body: JSON.stringify({
      user_type: params.user_type,
      device_id: deviceId,
      phone: params.phone,
      session_id: params.session_id,
    }),
  });
}

/**
 * Get current payment status
 */
export async function getPaymentStatus(
  commerceOrder: string
): Promise<PaymentStatusResponse> {
  return paymentRequest<PaymentStatusResponse>(
    `/api/payment/status/${encodeURIComponent(commerceOrder)}`
  );
}

/**
 * Get current premium price
 */
export async function getPremiumPrice(): Promise<PriceResponse> {
  return paymentRequest<PriceResponse>("/api/payment/price");
}

// --- LocalStorage Helpers ---

/**
 * Store pending payment info before redirecting to Flow
 */
export function storePendingPayment(payment: PendingPayment): void {
  try {
    localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(payment));
  } catch (e) {
    console.error("Failed to store pending payment:", e);
  }
}

/**
 * Get pending payment info (after returning from Flow)
 */
export function getPendingPayment(): PendingPayment | null {
  try {
    const stored = localStorage.getItem(PENDING_PAYMENT_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as PendingPayment;
  } catch (e) {
    console.error("Failed to get pending payment:", e);
    return null;
  }
}

/**
 * Clear pending payment info (after successful verification)
 */
export function clearPendingPayment(): void {
  try {
    localStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch (e) {
    console.error("Failed to clear pending payment:", e);
  }
}

// --- Payment Flow ---

/**
 * Start payment flow: create order, store info, redirect to Flow
 */
export async function startPaymentFlow(params: {
  user_type: "host" | "editor";
  phone?: string;
  session_id?: string;
  owner_token?: string;
}): Promise<void> {
  // Create payment order
  const result = await createPayment({
    user_type: params.user_type,
    phone: params.phone,
    session_id: params.session_id,
  });

  if (!result.success || !result.payment_url) {
    throw new Error("Failed to create payment order");
  }

  // Store pending payment info for when user returns
  storePendingPayment({
    commerce_order: result.commerce_order,
    session_id: params.session_id || "",
    owner_token: params.owner_token,
    user_type: params.user_type,
    phone: params.phone,
    created_at: new Date().toISOString(),
  });

  // Redirect to Flow payment page
  window.location.href = result.payment_url;
}

/**
 * Poll payment status until completed or timeout
 */
export async function pollPaymentStatus(
  commerceOrder: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    onStatusChange?: (status: PaymentStatusResponse) => void;
  } = {}
): Promise<PaymentStatusResponse> {
  const maxAttempts = options.maxAttempts || 60; // 5 minutes with 5s interval
  const intervalMs = options.intervalMs || 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getPaymentStatus(commerceOrder);

    if (options.onStatusChange) {
      options.onStatusChange(status);
    }

    // Payment completed (success or failure)
    if (status.status !== "pending") {
      return status;
    }

    // Wait before next poll
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // Timeout - return last known status
  return getPaymentStatus(commerceOrder);
}

// --- Format Helpers ---

/**
 * Format price in CLP (Chilean Pesos)
 */
export function formatPriceCLP(amount: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
