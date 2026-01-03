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
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log(msg);
    setDebugLogs(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    addLog(`handleFileSelect called, files: ${e.target.files?.length || 0}`);

    const file = e.target.files?.[0];

    // Reset input to allow re-selection of same file
    e.target.value = "";

    if (!file) {
      addLog("No file selected");
      return;
    }

    addLog(`File: ${file.name}, ${file.type}, ${file.size} bytes`);
    setIsLoading(true);
    setError(null);

    try {
      // Convert and compress image (like WhatsApp)
      setStatus("Comprimiendo imagen...");
      addLog("Starting compression...");
      const rawBase64 = await fileToBase64(file);
      addLog(`Base64 length: ${rawBase64.length}`);
      const base64 = await compressImage(rawBase64);
      addLog(`Compressed: ${base64.length}`);

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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 pt-6 pb-8">
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
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center mb-2">
          <span className="inline-flex items-center justify-center w-11 h-11 bg-primary rounded-full font-bold text-white leading-none" style={{ fontSize: '1.875rem' }}>B</span>
          <span className="font-bold text-foreground" style={{ fontSize: '1.875rem', marginLeft: '2px' }}>ill-e</span>
        </div>
        <p className="text-base text-muted-foreground">
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
            <button
              className="flex-1 h-14 text-lg font-semibold bg-primary/20 hover:bg-primary/30 rounded-xl transition-colors text-foreground"
              onClick={() => {
                addLog("Camera btn clicked");
                cameraInputRef.current?.click();
              }}
            >
              Cámara
            </button>
            <button
              className="flex-1 h-14 text-lg font-semibold bg-primary/20 hover:bg-primary/30 rounded-xl transition-colors text-foreground"
              onClick={() => {
                addLog("Gallery btn clicked");
                galleryInputRef.current?.click();
              }}
            >
              Galería
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="mt-8 w-full max-w-md space-y-2">
        <div className="bg-card rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
            1
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">Escanea y verifica</p>
            <p className="text-xs text-muted-foreground">Toma foto de la boleta y revisa los items</p>
          </div>
        </div>
        <div className="bg-card rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
            2
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">Agrega participantes y asigna</p>
            <p className="text-xs text-muted-foreground">Indica quién consumió qué</p>
          </div>
        </div>
        <div className="bg-card rounded-xl p-3 flex items-start gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
            3
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">Revisa y comparte</p>
            <p className="text-xs text-muted-foreground">Ve el detalle de cada persona y comparte el link</p>
          </div>
        </div>
      </div>

      {/* Install Prompt */}
      <div className="mt-6">
        <InstallPrompt />
      </div>

      {/* Footer */}
      <footer className="mt-6 text-center">
        <p className="text-xs text-muted-foreground">
          Hecho con ❤️
        </p>
      </footer>

      {/* Debug panel - temporary */}
      {debugLogs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/90 text-green-400 p-2 text-xs font-mono max-h-32 overflow-y-auto">
          {debugLogs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}
