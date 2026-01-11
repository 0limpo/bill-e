"use client";

import { useState } from "react";
import {
  AuthProvider,
  startOAuthLogin,
  PROVIDER_INFO,
} from "@/lib/auth";
import { getDeviceId } from "@/lib/api";

interface SignInButtonsProps {
  providers: AuthProvider[];
  redirectTo?: string;
  onError?: (error: string) => void;
  variant?: "default" | "compact";
  showLabels?: boolean;
}

export function SignInButtons({
  providers,
  redirectTo,
  onError,
  variant = "default",
  showLabels = true,
}: SignInButtonsProps) {
  const [loading, setLoading] = useState<AuthProvider | null>(null);

  const handleSignIn = async (provider: AuthProvider) => {
    setLoading(provider);
    try {
      const deviceId = getDeviceId();
      const authUrl = await startOAuthLogin(provider, deviceId, redirectTo);
      window.location.href = authUrl;
    } catch (error) {
      console.error("Sign in error:", error);
      onError?.(`Error al iniciar sesion con ${PROVIDER_INFO[provider].name}`);
      setLoading(null);
    }
  };

  if (variant === "compact") {
    return (
      <div className="flex gap-3 justify-center">
        {providers.map((provider) => (
          <button
            key={provider}
            onClick={() => handleSignIn(provider)}
            disabled={loading !== null}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50"
            style={{
              backgroundColor: PROVIDER_INFO[provider].bgColor,
              border: `2px solid ${PROVIDER_INFO[provider].color}`,
            }}
          >
            {loading === provider ? (
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <ProviderIcon provider={provider} />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <button
          key={provider}
          onClick={() => handleSignIn(provider)}
          disabled={loading !== null}
          className="w-full h-12 rounded-xl flex items-center justify-center gap-3 font-medium transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{
            backgroundColor: PROVIDER_INFO[provider].bgColor,
            color: provider === "facebook" ? "#ffffff" : "#333333",
            border: provider === "facebook" ? "none" : "1px solid #ddd",
          }}
        >
          {loading === provider ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <ProviderIcon provider={provider} />
              {showLabels && (
                <span>Continuar con {PROVIDER_INFO[provider].name}</span>
              )}
            </>
          )}
        </button>
      ))}
    </div>
  );
}

function ProviderIcon({ provider }: { provider: AuthProvider }) {
  if (provider === "google") {
    return (
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
    );
  }

  if (provider === "facebook") {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#ffffff">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    );
  }

  if (provider === "microsoft") {
    return (
      <svg className="w-5 h-5" viewBox="0 0 21 21">
        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
      </svg>
    );
  }

  return null;
}

export default SignInButtons;
