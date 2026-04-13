"use client";

import { useRouter } from "next/navigation";

export default function DeleteAccountPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/")}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 mb-6"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Volver
      </button>

      <h1 className="text-2xl font-bold mb-6">Eliminar cuenta y datos</h1>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">Cómo solicitar la eliminación</h2>
          <p className="mb-3">
            Para eliminar tu cuenta Bill-e y todos los datos asociados, envíanos un correo a:
          </p>
          <a
            href="mailto:hi@billeocr.com?subject=Eliminar%20cuenta%20Bill-e"
            className="inline-block bg-primary text-primary-foreground font-medium py-3 px-6 rounded-xl hover:bg-primary/90 transition-colors"
          >
            hi@billeocr.com
          </a>
          <p className="mt-3 text-muted-foreground">
            Incluye en el correo el email con el que iniciaste sesión en Bill-e.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Datos que eliminamos</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Tu cuenta (email, nombre, foto de perfil de Google).</li>
            <li>Tu historial de boletas procesadas.</li>
            <li>Tu estado de suscripción premium.</li>
            <li>Identificadores de dispositivo asociados a tu cuenta.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Datos que se eliminan automáticamente</h2>
          <p>
            Las sesiones activas (items, participantes, asignaciones) se eliminan automáticamente después de 1 hora. Las imágenes de boletas no se almacenan permanentemente.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Tiempo de respuesta</h2>
          <p>
            Procesaremos tu solicitud dentro de 30 días. Recibirás una confirmación por correo cuando se complete.
          </p>
        </section>
      </div>

      <footer className="mt-12 mb-8 text-center text-xs text-muted-foreground">
        Bill-e &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
