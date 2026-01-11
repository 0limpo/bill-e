"use client";

import { useState, useEffect } from "react";
import { SignInButtons } from "./SignInButtons";
import { AuthProvider, getAuthProviders } from "@/lib/auth";

interface PostPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSkip: () => void;
  sessionId?: string;
}

export function PostPaymentModal({
  isOpen,
  onClose,
  onSkip,
  sessionId,
}: PostPaymentModalProps) {
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProviders() {
      try {
        const data = await getAuthProviders();
        setProviders(data.providers);
      } catch {
        console.error("Failed to load providers");
      } finally {
        setLoading(false);
      }
    }
    if (isOpen) {
      loadProviders();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Build redirect URL back to session
  const redirectTo = sessionId
    ? `${window.location.origin}/s/${sessionId}?auth=complete`
    : `${window.location.origin}/auth/success`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-2xl w-full max-w-sm p-6 shadow-xl">
        {/* Success Icon */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground">
            Premium Activado
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Tu cuenta premium esta activa por 1 ano
          </p>
        </div>

        {/* Link Account Section */}
        <div className="bg-secondary/50 rounded-xl p-4 mb-6">
          <h3 className="font-medium text-foreground mb-2 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            Protege tu compra
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Vincula tu cuenta para acceder desde cualquier dispositivo y no
            perder tu premium si cambias de celular.
          </p>

          {loading ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : providers.length > 0 ? (
            <SignInButtons
              providers={providers}
              redirectTo={redirectTo}
              onError={setError}
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              Sign-in no disponible
            </p>
          )}

          {error && (
            <p className="text-sm text-red-500 mt-2 text-center">{error}</p>
          )}
        </div>

        {/* Skip Button */}
        <button
          onClick={onSkip}
          className="w-full py-3 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          Ahora no, usar solo este dispositivo
        </button>

        {/* Warning */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          Si no vinculas tu cuenta, perderas el acceso premium si cambias de
          dispositivo o borras los datos del navegador.
        </p>
      </div>
    </div>
  );
}

export default PostPaymentModal;
