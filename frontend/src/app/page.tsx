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

async function compressImage(base64: string, maxWidth = 1200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxWidth / img.width, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = base64;
  });
}

export default function LandingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleScanClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setStatus("Preparando imagen...");

    try {
      // Convert and compress image
      const rawBase64 = await fileToBase64(file);
      const base64 = await compressImage(rawBase64);

      // Step 1: Create empty session
      setStatus("Conectando al servidor...");
      const sessionResponse = await fetch(`${API_URL}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        throw new Error(`Error creando sesión: ${errorText}`);
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.session_id;

      // Step 2: Process with OCR
      setStatus("Analizando boleta...");
      const ocrResponse = await fetch(`${API_URL}/api/session/${sessionId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });

      if (!ocrResponse.ok) {
        const errorText = await ocrResponse.text();
        throw new Error(`Error en OCR: ${errorText}`);
      }

      const ocrData = await ocrResponse.json();
      const data = ocrData.data || ocrData;

      // Step 3: Create collaborative session with OCR data
      setStatus("Creando sesión...");
      const session = await createCollaborativeSession({
        items: data.items || [],
        total: data.total || 0,
        subtotal: data.subtotal || 0,
        tip: data.tip || 0,
        charges: data.charges || [],
        raw_text: data.raw_text || "",
        decimal_places: data.decimal_places || 0,
      });

      // Redirect to session
      router.push(`/s/${session.session_id}?owner=${session.owner_token}`);
    } catch (err) {
      console.error("Error:", err);
      const message = err instanceof Error ? err.message : "Error al procesar";
      // Simplify error message for users
      if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        setError("Error de conexión. El servidor puede estar iniciando, intenta de nuevo en 30 segundos.");
      } else {
        setError(message);
      }
      setIsLoading(false);
      setStatus("");
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
              {status || "Procesando..."}
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
