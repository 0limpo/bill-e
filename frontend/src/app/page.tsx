"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InstallPrompt } from "@/components/InstallPrompt";

export default function LandingPage() {
  const [showMessage, setShowMessage] = useState(false);

  const handleCreateSession = () => {
    setShowMessage(true);
    // TODO: Connect to backend to create session
    // const session = await createSession();
    // router.push(`/s/${session.id}?owner=${session.owner_token}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="text-center mb-12">
        <div className="text-6xl mb-4">🧾</div>
        <h1 className="text-4xl font-bold text-foreground mb-2">Bill-e</h1>
        <p className="text-lg text-muted-foreground">
          Divide cuentas fácilmente
        </p>
      </div>

      {/* CTA */}
      <div className="w-full max-w-sm">
        <Button
          size="lg"
          className="w-full h-14 text-lg font-semibold"
          onClick={handleCreateSession}
        >
          Crear sesión
        </Button>

        {showMessage && (
          <div className="mt-6 p-4 bg-card rounded-xl border border-border text-center">
            <p className="text-sm text-muted-foreground">
              Próximamente: Conectar con el backend para crear sesiones.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Por ahora, usa una URL existente como:
            </p>
            <code className="text-xs text-primary block mt-1">
              /s/tu-session-id?owner=tu-token
            </code>
          </div>
        )}
      </div>

      {/* Features */}
      <div className="mt-16 grid grid-cols-3 gap-6 text-center max-w-md">
        <div>
          <div className="text-2xl mb-2">📸</div>
          <p className="text-xs text-muted-foreground">Escanea la boleta</p>
        </div>
        <div>
          <div className="text-2xl mb-2">👥</div>
          <p className="text-xs text-muted-foreground">Asigna items</p>
        </div>
        <div>
          <div className="text-2xl mb-2">💬</div>
          <p className="text-xs text-muted-foreground">Comparte por WhatsApp</p>
        </div>
      </div>

      {/* Install Prompt */}
      <div className="mt-10">
        <InstallPrompt />
      </div>

      {/* Footer */}
      <footer className="absolute bottom-6 text-center">
        <p className="text-xs text-muted-foreground">
          Hecho con ❤️ para dividir cuentas sin dramas
        </p>
      </footer>
    </div>
  );
}
