"use client";

import { useRouter } from "next/navigation";

export default function PrivacyPage() {
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

      <h1 className="text-2xl font-bold mb-6">Política de Privacidad</h1>
      <p className="text-sm text-muted-foreground mb-8">Última actualización: 11 de abril de 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">1. Información que recopilamos</h2>
          <p className="mb-2">Bill-e recopila la siguiente información para funcionar correctamente:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Imágenes de boletas:</strong> procesadas con OCR para extraer items y montos. Las imágenes no se almacenan permanentemente.</li>
            <li><strong>Datos de sesión:</strong> items, participantes y asignaciones. Se almacenan temporalmente (máximo 1 hora) y se eliminan automáticamente.</li>
            <li><strong>Cuenta Google:</strong> si inicias sesión, almacenamos tu email y nombre para gestionar tu suscripción premium.</li>
            <li><strong>Identificador de dispositivo:</strong> un ID anónimo generado localmente para rastrear el uso de sesiones gratuitas.</li>
            <li><strong>Datos de uso:</strong> tipo de dispositivo, sistema operativo, idioma y tamaño de pantalla para mejorar la experiencia.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">2. Cómo usamos la información</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Procesar y dividir cuentas entre participantes.</li>
            <li>Gestionar suscripciones premium y pagos.</li>
            <li>Mejorar la precisión del OCR y la experiencia de usuario.</li>
            <li>Enviar resúmenes por WhatsApp cuando el usuario lo solicita.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">3. Almacenamiento y retención</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Las sesiones activas se eliminan automáticamente después de 1 hora.</li>
            <li>Los snapshots de boletas finalizadas se guardan para el historial del usuario.</li>
            <li>Los datos de pago son procesados por MercadoPago y Transbank (Flow.cl). Bill-e no almacena datos de tarjetas.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">4. Servicios de terceros</h2>
          <p className="mb-2">Bill-e utiliza los siguientes servicios externos:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Google Cloud:</strong> autenticación OAuth y procesamiento OCR.</li>
            <li><strong>MercadoPago:</strong> procesamiento de pagos.</li>
            <li><strong>Transbank (Flow.cl):</strong> pagos con Webpay.</li>
            <li><strong>WhatsApp (Meta):</strong> envío de mensajes cuando el usuario lo solicita.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">5. Seguridad</h2>
          <p>Protegemos tu información mediante conexiones cifradas (HTTPS), almacenamiento seguro de credenciales y acceso restringido a los datos.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">6. Tus derechos</h2>
          <p>Puedes solicitar la eliminación de tu cuenta y datos asociados contactándonos. Las sesiones temporales se eliminan automáticamente.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">7. Contacto</h2>
          <p>Para consultas sobre privacidad, contáctanos en <strong>hi@billeocr.com</strong></p>
        </section>
      </div>

      <footer className="mt-12 mb-8 text-center text-xs text-muted-foreground">
        Bill-e &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
