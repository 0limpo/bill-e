/**
 * OAuth Authentication Client for Bill-e
 * Handles Google, Facebook, and Microsoft sign-in
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";

// Storage keys
const AUTH_TOKEN_KEY = "bill-e-auth-token";
const AUTH_USER_KEY = "bill-e-auth-user";

export type AuthProvider = "google" | "facebook" | "microsoft";

export interface AuthUser {
  id: string;
  provider: AuthProvider;
  email: string;
  name?: string;
  picture_url?: string;
  device_ids?: string[];
  is_premium: boolean;
  premium_expires?: string;
  supporter_until?: string;  // ISO timestamp; if > now(), show "Supporter ✨" badge
}

/**
 * True iff the user has an active supporter badge.
 * Premium users migrated on 2026-05-23 receive `supporter_until = now + 90d`.
 */
export function isSupporter(user: AuthUser | null | undefined): boolean {
  if (!user?.supporter_until) return false;
  const until = new Date(user.supporter_until).getTime();
  return Number.isFinite(until) && until > Date.now();
}

export interface ProvidersResponse {
  providers: AuthProvider[];
  configured: {
    google: boolean;
    facebook?: boolean;
    microsoft?: boolean;
  };
}

/**
 * Get available OAuth providers
 */
export async function getAuthProviders(): Promise<ProvidersResponse> {
  const response = await fetch(`${API_URL}/api/auth/providers`);
  if (!response.ok) {
    throw new Error("Failed to get auth providers");
  }
  return response.json();
}

/**
 * Start OAuth login flow
 * Returns URL to redirect user to
 */
export async function startOAuthLogin(
  provider: AuthProvider,
  deviceId?: string,
  redirectTo?: string
): Promise<string> {
  const params = new URLSearchParams();
  if (deviceId) params.set("device_id", deviceId);
  if (redirectTo) params.set("redirect_to", redirectTo);

  const response = await fetch(
    `${API_URL}/api/auth/${provider}/login?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Failed to start ${provider} login`);
  }

  const data = await response.json();
  return data.auth_url;
}

/**
 * Verify session token and get user info
 */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${API_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.valid && data.user) {
      return data.user;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Refresh the cached user (from a successful payment, OAuth callback, etc.)
 * by re-verifying the stored token and overwriting the localStorage entry.
 * Returns the fresh user, or null if there's no token / verification failed.
 */
export async function refreshStoredUser(): Promise<AuthUser | null> {
  const token = getStoredToken();
  if (!token) return null;
  const user = await verifyToken(token);
  if (user) {
    setStoredUser(user);
    return user;
  }
  return null;
}

/**
 * Get current user from stored token
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = getStoredToken();
  if (!token) return null;

  const user = await verifyToken(token);
  if (user) {
    // Update stored user
    setStoredUser(user);
    return user;
  }

  // Token invalid, clear storage
  clearAuth();
  return null;
}

/**
 * Link current device to authenticated user
 */
export async function linkDeviceToAccount(
  token: string,
  deviceId: string
): Promise<{ success: boolean; premium_transferred?: boolean }> {
  const response = await fetch(`${API_URL}/api/auth/link-device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, device_id: deviceId }),
  });

  if (!response.ok) {
    throw new Error("Failed to link device");
  }

  return response.json();
}

/**
 * Ensure the current device is linked to the logged-in user. Safe to call
 * on every app startup — short-circuits when nothing to do.
 *
 * Why we need this on top of OAuth's own device-linking:
 * - PWAs can lose localStorage (reinstall, "clear site data", a different
 *   browser engine on Android, etc.). When the device_id rotates, the
 *   stored auth token still works, but the new device_id is not in
 *   user.device_ids. Bills created from this device while logged in then
 *   only carry user_id if it was set on the snapshot — and they never
 *   show up via the device-id lookup on other devices.
 * - We use /api/auth/claim-device instead of /api/auth/link-device because
 *   claim-device also backfills snapshot.user_id for orphan bills already
 *   created on this device. That recovers historic bills automatically.
 */
export async function ensureDeviceLinked(): Promise<void> {
  if (typeof window === "undefined") return;
  const user = getStoredUser();
  const token = getStoredToken();
  if (!user || !token) return;

  // Lazy device_id read to avoid pulling api.ts (would create a cycle).
  const deviceId = localStorage.getItem("bill-e-device-id");
  if (!deviceId) return;

  if (user.device_ids?.includes(deviceId)) return;

  try {
    const response = await fetch(`${API_URL}/api/auth/claim-device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, device_id: deviceId }),
    });
    if (!response.ok) return;
    const json = await response.json();
    if (Array.isArray(json.device_ids)) {
      setStoredUser({ ...user, device_ids: json.device_ids });
    }
  } catch {
    // Best effort. Silent failure means next startup retries.
  }
}

/**
 * Restore premium from user account to current device
 */
export async function restorePremiumToDevice(
  token: string,
  deviceId: string
): Promise<{ success: boolean; premium_expires?: string; error?: string }> {
  const response = await fetch(`${API_URL}/api/auth/restore-premium`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, device_id: deviceId }),
  });

  if (!response.ok) {
    throw new Error("Failed to restore premium");
  }

  return response.json();
}

// ============================================================================
// Token Storage
// ============================================================================

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(AUTH_USER_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  // Identify user in PostHog so future events attach to this person
  import("./tracking").then(({ identifyUserPostHog }) => {
    identifyUserPostHog({
      id: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider,
      is_premium: user.is_premium,
    });
  }).catch(() => {
    // Silent — analytics shouldn't break auth
  });
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  // Reset PostHog identity on logout so subsequent events are anonymous
  import("./tracking").then(({ resetPostHogUser }) => {
    resetPostHogUser();
  }).catch(() => {
    // Silent
  });
}

/**
 * Handle OAuth callback - parse URL params and store token
 */
export function handleAuthCallback(): {
  token?: string;
  userId?: string;
  isPremium?: boolean;
  error?: string;
} | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const userId = params.get("user_id");
  const isPremium = params.get("is_premium") === "True" || params.get("is_premium") === "true";
  const error = params.get("error");

  if (error) {
    return { error };
  }

  if (token && userId) {
    setStoredToken(token);
    return { token, userId, isPremium };
  }

  return null;
}

// ============================================================================
// Provider Info
// ============================================================================

export const PROVIDER_INFO: Record<
  AuthProvider,
  { name: string; icon: string; color: string; bgColor: string }
> = {
  google: {
    name: "Google",
    icon: "G",
    color: "#4285F4",
    bgColor: "#ffffff",
  },
  facebook: {
    name: "Facebook",
    icon: "f",
    color: "#1877F2",
    bgColor: "#1877F2",
  },
  microsoft: {
    name: "Microsoft",
    icon: "M",
    color: "#00A4EF",
    bgColor: "#ffffff",
  },
};
