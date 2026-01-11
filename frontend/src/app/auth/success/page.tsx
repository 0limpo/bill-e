"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  handleAuthCallback,
  verifyToken,
  setStoredUser,
  restorePremiumToDevice,
  getStoredToken,
} from "@/lib/auth";
import { getDeviceId } from "@/lib/api";

export default function AuthSuccessPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    async function handleCallback() {
      // Parse callback params
      const result = handleAuthCallback();

      if (!result) {
        // Check if already logged in
        const existingToken = getStoredToken();
        if (existingToken) {
          const user = await verifyToken(existingToken);
          if (user) {
            setStoredUser(user);
            setStatus("success");
            setMessage("Sesion activa");
            setIsPremium(user.is_premium);
            setTimeout(() => router.push("/"), 2000);
            return;
          }
        }
        setStatus("error");
        setMessage("No se encontro informacion de autenticacion");
        return;
      }

      if (result.error) {
        setStatus("error");
        setMessage(getErrorMessage(result.error));
        return;
      }

      if (result.token) {
        // Verify token and get user info
        const user = await verifyToken(result.token);

        if (!user) {
          setStatus("error");
          setMessage("No se pudo verificar la sesion");
          return;
        }

        setStoredUser(user);
        setIsPremium(user.is_premium);

        // If user has premium, restore to current device
        if (user.is_premium) {
          const deviceId = getDeviceId();
          try {
            await restorePremiumToDevice(result.token, deviceId);
          } catch (e) {
            console.error("Could not restore premium to device:", e);
          }
        }

        setStatus("success");
        setMessage(user.is_premium ? "Premium restaurado" : "Cuenta vinculada");

        // Redirect after delay
        setTimeout(() => {
          router.push("/");
        }, 2000);
      }
    }

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <div className="mb-8">
          <span className="inline-flex items-center justify-center w-11 h-11 bg-primary rounded-full font-bold text-white text-3xl">
            B
          </span>
          <span className="font-bold text-foreground text-3xl ml-0.5">ill-e</span>
        </div>

        {/* Status */}
        <div className="bg-card rounded-2xl p-6 border border-border">
          {status === "loading" && (
            <>
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Verificando cuenta...</p>
            </>
          )}

          {status === "success" && (
            <>
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
              <h2 className="text-xl font-bold text-foreground mb-2">{message}</h2>
              {isPremium && (
                <p className="text-sm text-green-500 mb-2">Premium activo</p>
              )}
              <p className="text-sm text-muted-foreground">
                Redirigiendo...
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Error</h2>
              <p className="text-sm text-muted-foreground mb-4">{message}</p>
              <button
                onClick={() => router.push("/")}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium"
              >
                Volver al inicio
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    access_denied: "Acceso denegado. Por favor intenta de nuevo.",
    invalid_state: "Sesion expirada. Por favor intenta de nuevo.",
    token_exchange_failed: "Error al conectar con el proveedor.",
    user_info_failed: "No se pudo obtener informacion del usuario.",
    database_error: "Error en el servidor. Por favor intenta mas tarde.",
    missing_params: "Parametros faltantes en la respuesta.",
    provider_mismatch: "Error de proveedor. Por favor intenta de nuevo.",
  };
  return messages[error] || `Error: ${error}`;
}
