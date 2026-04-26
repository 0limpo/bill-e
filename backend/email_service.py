"""
Transactional email service for Bill-e.
Sends boleta PDF to users after successful DTE emission.
Compliance: Res. Exenta SII N°12/2025 (deadline 1-mar-2026).
"""
import os
import resend
from typing import Optional

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "Bill-e <onboarding@resend.dev>")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def send_boleta_email(
    recipient_email: str,
    folio: str,
    pdf_url: str,
    monto_total: int,
    descripcion: str = "Bill-e Premium",
) -> dict:
    """Send boleta PDF link. Non-blocking: failures are logged."""
    if not RESEND_API_KEY:
        print("WARNING: RESEND_API_KEY not set, skipping email send")
        return {"success": False, "error": "RESEND_API_KEY not configured"}
    if not recipient_email or "@" not in recipient_email:
        return {"success": False, "error": "invalid recipient email"}

    monto_fmt = f"${monto_total:,.0f}".replace(",", ".")
    subject = f"Boleta Bill-e #{folio} — {monto_fmt}"
    html = f'''
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c1c1e;">
      <h1 style="font-size:20px;margin:0 0 16px;">¡Gracias por tu pago!</h1>
      <p style="font-size:14px;line-height:1.5;color:#555;">
        Tu boleta electrónica está lista. La emitimos al SII y aquí te dejamos el PDF para tus registros.
      </p>
      <div style="background:#f5f5f7;border-radius:12px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:13px;color:#888;">Folio</p>
        <p style="margin:0 0 12px;font-size:18px;font-weight:600;">{folio}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#888;">Monto total</p>
        <p style="margin:0 0 12px;font-size:18px;font-weight:600;">{monto_fmt}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#888;">Descripción</p>
        <p style="margin:0;font-size:14px;">{descripcion}</p>
      </div>
      <a href="{pdf_url}" style="display:inline-block;padding:12px 24px;background:#3F7BF6;color:white;text-decoration:none;border-radius:8px;font-weight:500;font-size:14px;">Descargar boleta PDF</a>
      <p style="font-size:12px;color:#888;margin-top:32px;line-height:1.5;">
        Si tienes dudas, responde este correo. Bill-e — divide cuentas fácilmente.
      </p>
    </div>
    '''
    try:
        result = resend.Emails.send({
            "from": RESEND_FROM,
            "to": recipient_email,
            "subject": subject,
            "html": html,
        })
        print(f"Boleta email sent to {recipient_email}: {result}")
        return {"success": True, "id": result.get("id")}
    except Exception as e:
        print(f"Boleta email error: {e}")
        return {"success": False, "error": str(e)}
