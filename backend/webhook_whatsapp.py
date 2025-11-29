from fastapi import Query, Response, Request, HTTPException
from datetime import datetime, timedelta
import uuid
import json
import os
import httpx
import redis
import base64

# Importar OCR service
try:
    from ocr_service import ocr_service
except ImportError:
    print("Warning: OCR service not available")
    ocr_service = None

# Importar Analytics
try:
    from analytics import analytics
    analytics_available = True
except ImportError:
    print("Warning: Analytics not available")
    analytics_available = False

# Importar WhatsApp Analytics
try:
    from whatsapp_analytics import whatsapp_analytics
    whatsapp_analytics_available = True
except ImportError:
    print("Warning: WhatsApp Analytics not available")
    whatsapp_analytics_available = False

# Variables de entorno
WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN")
WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN")
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID")

# Conexión Redis
redis_client = redis.from_url(os.getenv("REDIS_URL"))

# Función para verificar el webhook (GET)
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"), 
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    """Verificación inicial del webhook de WhatsApp"""
    
    print(f"🔍 DEBUG - Verificando webhook:")
    print(f"  - hub_mode recibido: '{hub_mode}'")
    print(f"  - hub_challenge recibido: '{hub_challenge}'")
    print(f"  - hub_verify_token recibido: '{hub_verify_token}'")
    print(f"  - WHATSAPP_VERIFY_TOKEN esperado: '{WHATSAPP_VERIFY_TOKEN}'")
    
    if hub_mode == "subscribe" and hub_verify_token == WHATSAPP_VERIFY_TOKEN:
        print("✅ Webhook verificado correctamente")
        return Response(content=hub_challenge, media_type="text/plain")
    else:
        print("❌ Verificación fallida")
        raise HTTPException(status_code=403, detail="Forbidden")

# Función para manejar mensajes entrantes (POST)
async def handle_webhook(request: Request):
    """Manejar mensajes entrantes de WhatsApp"""

    try:
        body = await request.json()
        print(f"📨 Mensaje recibido: {json.dumps(body, indent=2)}")

        # Verificar si hay mensajes
        entry = body.get("entry", [])
        if not entry:
            return {"status": "no_entry"}

        changes = entry[0].get("changes", [])
        if not changes:
            return {"status": "no_changes"}

        value = changes[0].get("value", {})
        messages = value.get("messages", [])

        if messages:
            message_data = messages[0]
            from_number = message_data["from"]
            message_type = message_data.get("type", "unknown")

            # Track inbound WhatsApp message
            if analytics_available:
                analytics.track_whatsapp_message(
                    phone_number=from_number,
                    direction='inbound',
                    message_type=message_type,
                    success=True
                )

            # Procesar diferentes tipos de mensajes
            if message_type == "text":
                # Mensaje de texto
                message_text = message_data["text"]["body"]
                print(f"💬 Mensaje de texto de {from_number}: {message_text}")
                await process_text_message(from_number, message_text)

            elif message_type == "image":
                # Mensaje con imagen (¡BOLETA!)
                print(f"📸 Imagen recibida de {from_number}")
                await process_image_message(from_number, message_data["image"])

            elif "document" in message_data:
                # Documento (podría ser PDF de boleta)
                print(f"📄 Documento recibido de {from_number}")
                await process_document_message(from_number, message_data["document"])

        return {"status": "ok"}

    except Exception as e:
        print(f"❌ Error procesando webhook: {e}")

        # Track error
        if analytics_available:
            analytics.track_whatsapp_message(
                phone_number='unknown',
                direction='inbound',
                message_type='unknown',
                success=False,
                error=str(e)
            )

        return {"status": "error", "message": str(e)}

# Nueva función para procesar imágenes con OCR
async def process_image_message(phone_number: str, image_data: dict):
    """Procesar imagen de boleta con OCR + Complete Journey Tracking"""

    import time
    start_time = time.time()

    try:
        # ===== STEP 1: START USER JOURNEY TRACKING =====
        if whatsapp_analytics_available:
            journey_id = whatsapp_analytics.start_journey(phone_number)
            print(f"📊 Journey started: {journey_id}")

        # Enviar mensaje de procesamiento
        await send_whatsapp_message(
            phone_number,
            "🤖 ¡Perfecto! Estoy procesando tu boleta...\n⏳ Esto tomará unos segundos."
        )

        # Descargar la imagen
        image_url = await get_whatsapp_media_url(image_data["id"])
        image_bytes = await download_whatsapp_media(image_url)

        if not image_bytes:
            # Track OCR failure
            if whatsapp_analytics_available:
                whatsapp_analytics.track_ocr_attempt(
                    phone_number,
                    success=False,
                    processing_time_ms=0,
                    error="Image download failed"
                )

            await send_whatsapp_message(
                phone_number,
                "❌ No pude descargar la imagen. Intenta enviarla nuevamente."
            )
            return

        # Procesar con OCR
        if not ocr_service:
            # Track OCR unavailable
            if whatsapp_analytics_available:
                whatsapp_analytics.track_ocr_attempt(
                    phone_number,
                    success=False,
                    processing_time_ms=0,
                    error="OCR service unavailable"
                )

            await send_whatsapp_message(
                phone_number,
                "❌ Servicio de OCR no disponible. Intenta más tarde."
            )
            return

        # ===== STEP 2: OCR PROCESSING =====
        print("🔍 Procesando imagen con OCR...")
        ocr_start = time.time()
        ocr_result = ocr_service.process_image(image_bytes)
        ocr_time_ms = (time.time() - ocr_start) * 1000

        if not ocr_result:
            # Track OCR failure
            if whatsapp_analytics_available:
                whatsapp_analytics.track_ocr_attempt(
                    phone_number,
                    success=False,
                    processing_time_ms=ocr_time_ms,
                    error="No text detected"
                )

            await send_whatsapp_message(
                phone_number,
                "❌ No pude leer el texto de la imagen.\n💡 Asegúrate de que la boleta se vea clara y completa."
            )
            return

        # Parsear datos de la boleta
        parsed_data = ocr_service.parse_receipt_text(ocr_result)

        if not parsed_data['success']:
            # Track parsing failure
            if whatsapp_analytics_available:
                whatsapp_analytics.track_ocr_attempt(
                    phone_number,
                    success=False,
                    processing_time_ms=ocr_time_ms,
                    error=parsed_data.get('error', 'Parsing failed')
                )

            await send_whatsapp_message(
                phone_number,
                f"❌ No pude procesar la boleta.\n{parsed_data.get('error', 'Error desconocido')}\n\n💡 Intenta con una imagen más clara."
            )
            return

        # ===== STEP 3: TRACK SUCCESSFUL OCR =====
        items_found = len(parsed_data.get('items', []))
        if whatsapp_analytics_available:
            whatsapp_analytics.track_ocr_attempt(
                phone_number,
                success=True,
                processing_time_ms=ocr_time_ms,
                items_found=items_found
            )

        # Crear sesión con datos de la boleta
        session_id = await create_session_with_bill_data(phone_number, parsed_data)

        # ===== STEP 4: TRACK LINK SENT =====
        if whatsapp_analytics_available:
            whatsapp_analytics.track_link_sent(phone_number, session_id)

        # Preparar mensaje de éxito
        success_message = format_success_message(parsed_data, session_id)

        # Enviar resultado
        await send_whatsapp_message(phone_number, success_message)

        total_time = (time.time() - start_time) * 1000
        print(f"✅ Complete journey step: Photo → Link sent in {total_time:.0f}ms")
        
    except Exception as e:
        print(f"❌ Error procesando imagen: {e}")
        await send_whatsapp_message(
            phone_number,
            "❌ Hubo un error procesando tu boleta. Intenta nuevamente."
        )

async def get_whatsapp_media_url(media_id: str) -> str:
    """Obtener URL para descargar media de WhatsApp"""
    
    url = f"https://graph.facebook.com/v18.0/{media_id}"
    headers = {"Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}"}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                return data.get("url")
            else:
                print(f"❌ Error obteniendo URL de media: {response.text}")
                return None
                
    except Exception as e:
        print(f"❌ Error en get_whatsapp_media_url: {e}")
        return None

async def download_whatsapp_media(media_url: str) -> bytes:
    """Descargar archivo de media de WhatsApp"""
    
    if not media_url:
        return None
        
    headers = {"Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}"}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(media_url, headers=headers)
            
            if response.status_code == 200:
                return response.content
            else:
                print(f"❌ Error descargando media: {response.status_code}")
                return None
                
    except Exception as e:
        print(f"❌ Error en download_whatsapp_media: {e}")
        return None

async def create_session_with_bill_data(phone_number: str, bill_data: dict) -> str:
    """Crear sesión con datos de boleta ya procesados"""
    
    session_id = str(uuid.uuid4())
    
    # Convertir items a formato de sesión
    items = [
        {
            'id': str(uuid.uuid4()),
            'name': item['name'],
            'price': item['price'],
            'assigned_to': []
        }
        for item in bill_data['items']
    ]
    
    session_data = {
        "id": session_id,
        "total": bill_data['total'],
        "subtotal": bill_data['subtotal'],
        "tip": bill_data['tip'],
        "people": [],
        "items": items,
        "created_at": datetime.utcnow().isoformat(),
        "expires_at": (datetime.utcnow() + timedelta(hours=2)).isoformat(),
        "phone_number": phone_number,
        "ocr_confidence": bill_data.get('confidence', 'unknown'),
        "raw_text": bill_data.get('raw_text', '')
    }
    
    # Guardar en Redis por 2 horas
    redis_client.setex(f"session:{session_id}", 7200, json.dumps(session_data))
    
    print(f"✅ Sesión con boleta creada: {session_id}")
    return session_id

def format_success_message(bill_data: dict, session_id: str) -> str:
    """Formatear mensaje de éxito con resumen de la boleta en formato chileno"""
    
    def format_chilean_currency(amount):
        """Formatear moneda en estilo chileno: $111.793"""
        return f"${amount:,.0f}".replace(',', '.')
    
    # Contar items
    items_count = len(bill_data['items'])
    
    # Crear lista de items (máximo 3 para el mensaje)
    items_preview = ""
    for i, item in enumerate(bill_data['items'][:3]):
        price_formatted = format_chilean_currency(item['price'])
        items_preview += f"• {item['name']}: {price_formatted}\n"
    
    if items_count > 3:
        items_preview += f"• ... y {items_count - 3} más\n"
    
    frontend_url = f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/s/{session_id}"
    
    # Formatear números en estilo chileno
    total_formatted = format_chilean_currency(bill_data['total'])
    subtotal_formatted = format_chilean_currency(bill_data['subtotal'])
    tip_formatted = format_chilean_currency(bill_data['tip'])
    
    message = f"""🎉 ¡Boleta procesada exitosamente!

📊 **Resumen:**
💰 Total: {total_formatted}
🧾 Subtotal: {subtotal_formatted}
💸 Propina: {tip_formatted}
📝 Items: {items_count}

{items_preview}
🔗 **Divide tu cuenta aquí:**
👉 {frontend_url}

💡 Comparte este link con tus amigos para que vean cuánto debe pagar cada uno."""
    
    return message

# Función mejorada para procesar mensajes de texto
async def process_text_message(phone_number: str, message: str):
    """Procesar mensajes de texto"""
    
    message_lower = message.lower()
    
    if any(word in message_lower for word in ["hola", "hello", "hi", "start", "empezar"]):
        welcome_message = (
            "🤖 ¡Hola! Soy Bill-e, tu asistente para dividir cuentas.\n\n"
            "📸 **Para empezar:**\n"
            "1️⃣ Toma una foto clara de tu boleta\n"
            "2️⃣ Envíamela por este chat\n"
            "3️⃣ Te crearé un link para dividir automáticamente\n\n"
            "💡 También puedes escribir 'ayuda' para más información."
        )
        await send_whatsapp_message(phone_number, welcome_message)
        
    elif any(word in message_lower for word in ["ayuda", "help", "como", "instructions"]):
        help_message = (
            "🆘 **Cómo usar Bill-e:**\n\n"
            "1️⃣ Toma una foto de tu boleta de restaurante\n"
            "2️⃣ Envíamela por WhatsApp\n"
            "3️⃣ Procesaré automáticamente los items y precios\n"
            "4️⃣ Te daré un link para dividir la cuenta\n"
            "5️⃣ ¡Comparte el link con tus amigos!\n\n"
            "📸 **Tips para mejores resultados:**\n"
            "• Asegúrate de que la boleta esté bien iluminada\n"
            "• Que se vean claramente los precios y nombres\n"
            "• Evita sombras o reflejos\n\n"
            "🚀 **¿Listo?** ¡Envía tu boleta!"
        )
        await send_whatsapp_message(phone_number, help_message)
        
    else:
        default_message = (
            "🤔 Para dividir una cuenta, envíame una foto de tu boleta.\n\n"
            "📸 Solo toma la foto y envíamela - yo haré el resto.\n"
            "💡 Escribe 'ayuda' si necesitas más información."
        )
        await send_whatsapp_message(phone_number, default_message)

# Función para procesar documentos (PDFs de boletas)
async def process_document_message(phone_number: str, document_data: dict):
    """Procesar documentos (como PDFs de boletas)"""
    
    document_name = document_data.get("filename", "documento")
    
    message = (
        f"📄 Recibí tu documento: {document_name}\n\n"
        "🤖 Por ahora solo puedo procesar imágenes de boletas.\n"
        "📸 ¿Puedes enviarme una foto de la boleta en su lugar?"
    )
    
    await send_whatsapp_message(phone_number, message)

# Función para enviar mensajes por WhatsApp (sin cambios)
async def send_whatsapp_message(phone_number: str, message: str):
    """Enviar mensaje por WhatsApp"""

    if not WHATSAPP_ACCESS_TOKEN or not WHATSAPP_PHONE_NUMBER_ID:
        print("⚠️ Tokens de WhatsApp no configurados")

        if analytics_available:
            analytics.track_whatsapp_message(
                phone_number=phone_number,
                direction='outbound',
                message_type='text',
                success=False,
                error='WhatsApp tokens not configured'
            )
        return

    url = f"https://graph.facebook.com/v18.0/{WHATSAPP_PHONE_NUMBER_ID}/messages"

    headers = {
        "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    data = {
        "messaging_product": "whatsapp",
        "to": phone_number,
        "text": {"body": message}
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=data)

            success = response.status_code == 200

            if success:
                print(f"✅ Mensaje enviado a {phone_number}")

                # Track cost (WhatsApp pricing: ~$0.005 per message for user-initiated)
                if analytics_available:
                    analytics.track_cost(
                        service='whatsapp',
                        operation='send_message',
                        cost_usd=0.005,
                        units=1
                    )
            else:
                print(f"❌ Error enviando mensaje: {response.text}")

            # Track outbound message
            if analytics_available:
                analytics.track_whatsapp_message(
                    phone_number=phone_number,
                    direction='outbound',
                    message_type='text',
                    success=success,
                    error=None if success else response.text
                )

            return response.json()

    except Exception as e:
        print(f"❌ Error en send_whatsapp_message: {e}")

        # Track error
        if analytics_available:
            analytics.track_whatsapp_message(
                phone_number=phone_number,
                direction='outbound',
                message_type='text',
                success=False,
                error=str(e)
            )

# Función legacy para mantener compatibilidad
async def create_new_session(phone_number: str) -> str:
    """Crear nueva sesión simple (para compatibilidad)"""
    
    session_id = str(uuid.uuid4())[:8]
    
    session_data = {
        "id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "phone_number": phone_number,
        "status": "waiting_receipt",
        "total": 0,
        "subtotal": 0,
        "tip": 0,
        "people": [],
        "items": [],
        "expires_at": (datetime.utcnow() + timedelta(hours=1)).isoformat()
    }
    
    redis_client.setex(f"session:{session_id}", 3600, json.dumps(session_data))
    
    print(f"✅ Sesión simple creada: {session_id}")
    return session_id