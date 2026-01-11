"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get("error") || "unknown";

  const messages: Record<string, string> = {
    access_denied: "Acceso denegado. Cancelaste el inicio de sesion.",
    invalid_state: "La sesion expiro. Por favor intenta de nuevo.",
    token_exchange_failed: "Error al conectar con el proveedor de autenticacion.",
    user_info_failed: "No se pudo obtener la informacion de tu cuenta.",
    database_error: "Error en el servidor. Por favor intenta mas tarde.",
    missing_params: "Respuesta incompleta del proveedor.",
    provider_mismatch: "Error de seguridad. Por favor intenta de nuevo.",
    no_access_token: "No se recibio token de acceso.",
    unknown: "Ocurrio un error desconocido.",
  };

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

        {/* Error Card */}
        <div className="bg-card rounded-2xl p-6 border border-border">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2">
            Error de autenticacion
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {messages[error] || messages.unknown}
          </p>

          <div className="space-y-3">
            <button
              onClick={() => router.back()}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium"
            >
              Intentar de nuevo
            </button>
            <button
              onClick={() => router.push("/")}
              className="w-full py-3 bg-secondary text-foreground rounded-xl font-medium"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}
