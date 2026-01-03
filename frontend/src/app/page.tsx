"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InstallPrompt } from "@/components/InstallPrompt";
import { createCollaborativeSession } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://bill-e-backend-lfwp.onrender.com";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function LandingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScanClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      // Convert to base64
      const base64 = await fileToBase64(file);

      // Step 1: Create empty session
      const sessionResponse = await fetch(`${API_URL}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!sessionResponse.ok) {
        throw new Error("Error creando sesión");
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.session_id;

      // Step 2: Process with OCR
      const ocrResponse = await fetch(`${API_URL}/api/session/${sessionId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });

      if (!ocrResponse.ok) {
        throw new Error("Error procesando la imagen");
      }

      const ocrData = await ocrResponse.json();

      // Step 3: Create collaborative session with OCR data
      const session = await createCollaborativeSession({
        items: ocrData.items || [],
        total: ocrData.total || 0,
        subtotal: ocrData.subtotal || 0,
        tip: ocrData.tip || 0,
        charges: ocrData.charges || [],
        raw_text: ocrData.raw_text || "",
        decimal_places: ocrData.decimal_places || 0,
      });

      // Redirect to session
      router.push(`/s/${session.session_id}?owner=${session.owner_token}`);
    } catch (err) {
      console.error("Error:", err);
      setError(err instanceof Error ? err.message : "Error al procesar");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <input
        type="file"
        id="gallery-input"
        onChange={handleFileSelect}
        accept="image/*"
        className="hidden"
      />

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
          onClick={handleScanClick}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              Procesando...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              📷 Escanear boleta
            </span>
          )}
        </Button>

        <button
          onClick={() => document.getElementById('gallery-input')?.click()}
          disabled={isLoading}
          className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          o subir imagen existente
        </button>

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive text-center">{error}</p>
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
