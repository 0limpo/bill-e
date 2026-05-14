/**
 * Funnel Analytics Tracking for Bill-e
 * Tracks user journey through the app — dual-writes to backend (Redis) and PostHog
 */

import posthog from "posthog-js";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let posthogInitialized = false;

// Get or create a persistent user ID for tracking across sessions
function getTrackingId(): string {
  if (typeof window === "undefined") return "server";

  let trackingId = localStorage.getItem("bill-e-tracking-id");
  if (!trackingId) {
    trackingId = `t_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem("bill-e-tracking-id", trackingId);
  }
  return trackingId;
}

// Get device info for analytics
function getDeviceInfo() {
  if (typeof window === "undefined") return {};

  const ua = navigator.userAgent.toLowerCase();

  // Device type
  let deviceType = "desktop";
  if (/mobile|android|iphone/.test(ua)) {
    deviceType = /tablet|ipad/.test(ua) ? "tablet" : "mobile";
  }

  // OS
  let os = "other";
  if (/iphone|ipad/.test(ua)) os = "iOS";
  else if (/android/.test(ua)) os = "Android";
  else if (/windows/.test(ua)) os = "Windows";
  else if (/mac/.test(ua)) os = "macOS";

  return {
    device_type: deviceType,
    os,
    language: navigator.language,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
  };
}

// ============================================================================
// PostHog lifecycle
// ============================================================================

export function initPostHog(): void {
  if (posthogInitialized) return;
  if (typeof window === "undefined") return;
  if (!POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-private]",
    },
    person_profiles: "identified_only",
    loaded: (ph) => {
      try {
        const stored = localStorage.getItem("bill-e-auth-user");
        if (!stored) return;
        const user = JSON.parse(stored);
        if (user?.id) {
          ph.identify(String(user.id), {
            email: user.email,
            name: user.name,
            provider: user.provider,
            is_premium: !!user.is_premium,
          });
        }
      } catch {
        // ignore
      }
    },
  });
  posthogInitialized = true;
}

export function identifyUserPostHog(user: {
  id: string;
  email?: string;
  name?: string;
  provider?: string;
  is_premium?: boolean;
}): void {
  if (!POSTHOG_KEY || typeof window === "undefined") return;
  posthog.identify(String(user.id), {
    email: user.email,
    name: user.name,
    provider: user.provider,
    is_premium: !!user.is_premium,
  });
}

export function resetPostHogUser(): void {
  if (!POSTHOG_KEY || typeof window === "undefined") return;
  posthog.reset();
}

export function capturePageview(url: string): void {
  if (!POSTHOG_KEY || typeof window === "undefined") return;
  posthog.capture("$pageview", { $current_url: url });
}

// ============================================================================
// Track event (dual-write to backend + PostHog)
// ============================================================================

interface TrackingParams {
  session_id?: string;
  [key: string]: string | number | boolean | undefined;
}

export async function trackEvent(
  eventName: string,
  params: TrackingParams = {}
): Promise<void> {
  try {
    const trackingId = getTrackingId();
    const deviceInfo = getDeviceInfo();

    const eventData = {
      event_name: eventName,
      event_params: {
        tracking_id: trackingId,
        ...deviceInfo,
        ...params,
        url: typeof window !== "undefined" ? window.location.pathname : undefined,
      },
      timestamp: new Date().toISOString(),
    };

    // Send to backend (Redis) — fire and forget
    fetch(`${API_URL}/api/analytics/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    }).catch((err) => {
      console.debug("Analytics error:", err);
    });

    // Dual-write to PostHog
    if (POSTHOG_KEY && typeof window !== "undefined") {
      posthog.capture(eventName, {
        tracking_id: trackingId,
        ...deviceInfo,
        ...params,
      });
    }
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Funnel Events
// ============================================================================

/**
 * Track when user opens the app
 */
export function trackAppOpen() {
  trackEvent("funnel_app_open");
}

/**
 * Track when user takes/selects a photo
 */
export function trackPhotoTaken(source: "camera" | "gallery") {
  trackEvent("funnel_photo_taken", { source });
}

/**
 * Track when OCR completes
 */
export function trackOcrComplete(sessionId: string, itemsCount: number, success: boolean) {
  trackEvent("funnel_ocr_complete", {
    session_id: sessionId,
    items_count: itemsCount,
    success,
  });
}

/**
 * Track when user completes step 1 (review)
 */
export function trackStep1Complete(sessionId: string, itemsCount: number) {
  trackEvent("funnel_step1_complete", {
    session_id: sessionId,
    items_count: itemsCount,
  });
}

/**
 * Track when user adds a person
 */
export function trackPersonAdded(sessionId: string, personCount: number) {
  trackEvent("funnel_person_added", {
    session_id: sessionId,
    person_count: personCount,
  });
}

/**
 * Track when user completes all assignments
 */
export function trackAssignmentComplete(sessionId: string, personCount: number, itemsCount: number) {
  trackEvent("funnel_assignment_complete", {
    session_id: sessionId,
    person_count: personCount,
    items_count: itemsCount,
  });
}

/**
 * Track when user completes step 2 (assign)
 */
export function trackStep2Complete(sessionId: string, personCount: number) {
  trackEvent("funnel_step2_complete", {
    session_id: sessionId,
    person_count: personCount,
  });
}

/**
 * Track when user shares the session
 */
export function trackShare(sessionId: string, method: "whatsapp" | "telegram" | "email" | "copy" | "native") {
  trackEvent("funnel_shared", {
    session_id: sessionId,
    method,
  });
}

/**
 * Track when paywall is shown
 */
export function trackPaywallShown(sessionId: string) {
  trackEvent("funnel_paywall_shown", { session_id: sessionId });
}

/**
 * Track when user clicks pay button
 */
export function trackPaymentStarted(sessionId: string, method: "mercadopago" | "webpay") {
  trackEvent("funnel_payment_started", {
    session_id: sessionId,
    method,
  });
}

/**
 * Track when payment completes successfully
 */
export function trackPaymentComplete(sessionId: string, method: string) {
  trackEvent("funnel_payment_complete", {
    session_id: sessionId,
    method,
  });
}

/**
 * Track when user signs in with OAuth
 */
export function trackSignIn(provider: string, hasPremium: boolean) {
  trackEvent("funnel_signin", {
    provider,
    has_premium: hasPremium,
  });
}

/**
 * Track when guest joins a session
 */
export function trackGuestJoined(sessionId: string, isNewPerson: boolean) {
  trackEvent("funnel_guest_joined", {
    session_id: sessionId,
    is_new_person: isNewPerson,
  });
}

/**
 * Track session bill details (for analytics on bill sizes)
 */
export function trackSessionDetails(
  sessionId: string,
  details: {
    total: number;
    itemsCount: number;
    personCount: number;
    hasCharges: boolean;
  }
) {
  trackEvent("session_details", {
    session_id: sessionId,
    bill_total: details.total,
    items_count: details.itemsCount,
    person_count: details.personCount,
    has_charges: details.hasCharges,
  });
}
