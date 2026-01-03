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

// Compress like WhatsApp: ~1600px, 70% quality
async function compressImage(base64: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 1600;
      let { width, height } = img;

      // Scale down if larger than maxSize
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = (height / width) * maxSize;
          width = maxSize;
        } else {
          width = (width / height) * maxSize;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64;
  });
}


export default function LandingPage() {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      // Convert and compress image (like WhatsApp)
      setStatus("Comprimiendo imagen...");
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
        ref={cameraInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <input
        type="file"
        ref={galleryInputRef}
        onChange={handleFileSelect}
        accept="image/*"
        className="hidden"
      />

      {/* Logo */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center mb-4">
          <span className="inline-flex items-center justify-center w-10 h-10 bg-primary rounded-full font-bold text-white leading-none" style={{ fontSize: '1.75rem' }}>B</span>
          <span className="font-bold text-foreground" style={{ fontSize: '1.75rem', marginLeft: '2px' }}>ill-e</span>
        </div>
        <p className="text-lg text-muted-foreground">
          Divide cuentas fácilmente
        </p>
      </div>

      {/* CTA */}
      <div className="w-full max-w-sm">
        {isLoading ? (
          <div className="h-14 flex items-center justify-center gap-2 text-muted-foreground">
            <span className="animate-spin">⏳</span>
            {status || "Procesando..."}
          </div>
        ) : (
          <div className="flex gap-3">
            <Button
              size="lg"
              className="flex-1 h-14 text-base font-semibold bg-slate-600 hover:bg-slate-500"
              onClick={() => cameraInputRef.current?.click()}
            >
              Cámara
            </Button>
            <Button
              size="lg"
              className="flex-1 h-14 text-base font-semibold bg-slate-600 hover:bg-slate-500"
              onClick={() => galleryInputRef.current?.click()}
            >
              Galería
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="mt-16 w-full max-w-md">
        <div className="bg-card rounded-2xl p-6 border border-border space-y-5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
              1
            </div>
            <div>
              <p className="font-medium text-foreground">Escanea y verifica</p>
              <p className="text-sm text-muted-foreground">Toma foto de la boleta y revisa los items</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
              2
            </div>
            <div>
              <p className="font-medium text-foreground">Agrega participantes y asigna</p>
              <p className="text-sm text-muted-foreground">Indica quién consumió qué</p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
              3
            </div>
            <div>
              <p className="font-medium text-foreground">Revisa y comparte</p>
              <p className="text-sm text-muted-foreground">Ve el detalle de cada persona y comparte el link</p>
            </div>
          </div>
        </div>
      </div>

      {/* Install Prompt */}
      <div className="mt-10">
        <InstallPrompt />
      </div>

      {/* Footer */}
      <footer className="mt-10 text-center">
        <p className="text-xs text-muted-foreground">
          Hecho con ❤️ para dividir cuentas sin dramas
        </p>
      </footer>
    </div>
  );
}
