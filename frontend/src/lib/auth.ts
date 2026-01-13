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
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
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
