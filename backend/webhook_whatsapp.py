from fastapi import Query, Response, Request, HTTPException
from datetime import datetime, timedelta
import uuid
import json
import os
import httpx
import redis
import base64

# Importar OCR service (Gemini)
try:
    from gemini_service import process_image, validate_receipt
except ImportError:
    print("Warning: OCR service not available")
    process_image = None
    validate_receipt = None

# Importar sesiones colaborativas
try:
    from collaborative_session import create_collaborative_session
except ImportError:
    print("Warning: Collaborative session not available")
    create_collaborative_session = None

# Importar Analytics
try:
    from analytics import analytics
    analytics_available = True
except ImportError:
    print("Warning: Analytics not available")
    analytics_available = False

# Importar i18n para WhatsApp
try:
    from whatsapp_i18n import (
        detect_language,
        get_message,
        format_collaborative_message_i18n
    )
    i18n_available = True
except ImportError:
    print("Warning: WhatsApp i18n not available")
    i18n_available = False

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

# Rate limit configuration
RATE_LIMIT_PHOTOS_PER_HOUR = 5
RATE_LIMIT_WINDOW_SECONDS = 3600  # 1 hour

def check_rate_limit(phone_number: str) -> dict:
    """
    Check if phone number has exceeded photo rate limit.

    Args:
        phone_number: WhatsApp phone number

    Returns:
        dict with 'allowed', 'count', 'remaining', 'reset_in_seconds'
    """
    rate_key = f"rate_limit:photos:{phone_number}"

    try:
        # Get current count
        current_count = redis_client.get(rate_key)
        count = int(current_count) if current_count else 0

        if count >= RATE_LIMIT_PHOTOS_PER_HOUR:
            # Get TTL to tell user when they can try again
            ttl = redis_client.ttl(rate_key)
            return {
                'allowed': False,
                'count': count,
                'remaining': 0,
                'reset_in_seconds': ttl if ttl > 0 else RATE_LIMIT_WINDOW_SECONDS
            }

        return {
            'allowed': True,
            'count': count,
            'remaining': RATE_LIMIT_PHOTOS_PER_HOUR - count
        }

    except Exception as e:
        print(f"⚠️ Error checking rate limit: {e}")
        # Allow on error to not block users
        return {'allowed': True, 'count': 0, 'remaining': RATE_LIMIT_PHOTOS_PER_HOUR}


def increment_rate_limit(phone_number: str) -> int:
    """
    Increment the photo count for rate limiting.

    Args:
        phone_number: WhatsApp phone number

    Returns:
        New count after increment
    """
    rate_key = f"rate_limit:photos:{phone_number}"

    try:
        # Increment count
        new_count = redis_client.incr(rate_key)

        # Set expiry on first increment
        if new_count == 1:
            redis_client.expire(rate_key, RATE_LIMIT_WINDOW_SECONDS)

        print(f"📊 Rate limit: {phone_number} -> {new_count}/{RATE_LIMIT_PHOTOS_PER_HOUR} photos this hour")
        return new_count

    except Exception as e:
        print(f"⚠️ Error incrementing rate limit: {e}")
        return 0


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

        # Ignorar webhooks de status (delivered, sent, read)
        if "statuses" in value and "messages" not in value:
            print("📋 Webhook de status ignorado (delivered/sent/read)")
            return {"status": "status_ignored"}

        messages = value.get("messages", [])

        if messages:
            message_data = messages[0]
            from_number = message_data["from"]
            message_type = message_data.get("type", "unknown")

            # 🔒 DEDUPLICACIÓN: Evitar procesar el mismo mensaje múltiples veces
            message_id = message_data.get("id")
            if message_id:
                cache_key = f"processed_msg:{message_id}"
                # Verificar si ya se procesó
                if redis_client.exists(cache_key):
                    print(f"⚠️ Mensaje {message_id} ya procesado, ignorando duplicado")
                    return {"status": "already_processed"}
                # Marcar como procesado con TTL de 24 horas (evita duplicados si servidor reinicia)
                redis_client.setex(cache_key, 86400, "1")
                print(f"✅ Mensaje {message_id} marcado como procesado")

            # Track inbound WhatsApp message
            if analytics_available:
                analytics.track_whatsapp_message(
                    phone_number=from_number,
                    direction='inbound',
                    message_type=message_type,
                    success=True
                )

            # Procesar diferentes tipos de mensajes
            # NOTA: Solo respondemos a imágenes para evitar costos de conversación innecesarios
            if message_type == "text":
                # Mensaje de texto - IGNORAR (no responder = $0)
                message_text = message_data["text"]["body"]
                print(f"💬 Texto ignorado de {from_number}: {message_text[:50]}...")
                # No respondemos para no iniciar conversación cobrable

            elif message_type == "image":
                # Mensaje con imagen (¡BOLETA!) - ÚNICO TIPO QUE RESPONDEMOS
                print(f"📸 Imagen recibida de {from_number}")
                await process_image_message(from_number, message_data["image"])

            elif "document" in message_data:
                # Documento - IGNORAR (no responder = $0)
                document_name = message_data["document"].get("filename", "unknown")
                print(f"📄 Documento ignorado de {from_number}: {document_name}")
                # No respondemos para no iniciar conversación cobrable

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

async def process_image_message(phone_number: str, image_data: dict):
    """Procesa mensaje con imagen (boleta) usando Gemini OCR."""
    try:
        # Detect language from phone number
        lang = detect_language(phone_number) if i18n_available else "es"

        # 1. Check rate limit FIRST (before any processing)
        rate_check = check_rate_limit(phone_number)
        if not rate_check['allowed']:
            minutes_remaining = rate_check['reset_in_seconds'] // 60
            error_msg = get_message("error_rate_limit", lang, minutes=minutes_remaining) if i18n_available else f"Has enviado muchas fotos. Intenta de nuevo en {minutes_remaining} minutos."
            await send_whatsapp_message(phone_number, f"⏳ {error_msg}")
            print(f"🚫 Rate limit exceeded for {phone_number}: {rate_check['count']}/{RATE_LIMIT_PHOTOS_PER_HOUR}")
            return

        # Obtener ID de la imagen
        media_id = image_data.get('id')
        if not media_id:
            error_msg = get_message("error_no_image", lang) if i18n_available else "No pude obtener la imagen. Intenta de nuevo."
            await send_whatsapp_message(phone_number, f"❌ {error_msg}")
            return

        # Descargar imagen
        media_url = await get_whatsapp_media_url(media_id)
        if not media_url:
            error_msg = get_message("error_download", lang) if i18n_available else "No pude descargar la imagen."
            await send_whatsapp_message(phone_number, f"❌ {error_msg}")
            return

        image_bytes = await download_whatsapp_media(media_url)
        if not image_bytes:
            error_msg = get_message("error_download", lang) if i18n_available else "Error al descargar la imagen."
            await send_whatsapp_message(phone_number, f"❌ {error_msg}")
            return

        print(f"📥 Imagen descargada: {len(image_bytes)} bytes")

        # 2. Increment rate limit after successful download (counts any image)
        increment_rate_limit(phone_number)

        # 3. Quick validation: Is this a receipt? (~$0.0001 cost)
        if validate_receipt:
            is_valid_receipt = validate_receipt(image_bytes)
            if not is_valid_receipt:
                error_msg = get_message("error_not_receipt", lang) if i18n_available else "Esta imagen no parece ser una boleta. Por favor envía una foto de tu cuenta o recibo."
                await send_whatsapp_message(phone_number, f"🧾 {error_msg}")
                print(f"❌ Image from {phone_number} is not a receipt")
                return
            print(f"✅ Image validated as receipt")

        # 4. Now send processing message (only after validation passes)
        processing_msg = get_message("processing", lang) if i18n_available else "Estoy procesando tu boleta..."
        await send_whatsapp_message(
            phone_number,
            f"⏳ {processing_msg}"
        )

        # 5. Full OCR processing
        try:
            result = process_image(image_bytes)

            # Extraer datos
            total = result.get('total', 0)
            subtotal = result.get('subtotal', 0)
            tip = result.get('tip', 0)
            items = result.get('items', [])
            validation = result.get('validation', {})
            ocr_source = result.get('ocr_source', 'unknown')

            print(f"✅ OCR completado con {ocr_source}: {len(items)} items, score: {validation.get('quality_score', 0)}")

            # Formatear items para sesión colaborativa
            formatted_items = []
            for i, item in enumerate(items):
                formatted_items.append({
                    "id": f"item_{i}",
                    "name": item.get("name", f"Item {i+1}"),
                    "price": item.get("price", 0),
                    "quantity": item.get("quantity", 1)
                })

            # Crear sesión colaborativa (con 2 links: owner y editor)
            session_result = create_collaborative_session(
                redis_client=redis_client,
                owner_phone=phone_number,
                items=formatted_items,
                total=total,
                subtotal=subtotal,
                tip=tip,
                raw_text=result.get('raw_text', ''),
                charges=result.get('charges', []),
                decimal_places=result.get('decimal_places', 0),
                has_tip=result.get('has_tip', False),
                number_format=result.get('number_format', {'thousands': ',', 'decimal': '.'}),
                price_mode=result.get('price_mode', 'unitario')
            )

            quality_score = validation.get('quality_score', 0) if validation else 0
            decimal_places = result.get('decimal_places', 0)
            number_format = result.get('number_format', {'thousands': ',', 'decimal': '.'})
            message = format_collaborative_message_i18n(
                lang=lang,
                total=total,
                subtotal=subtotal,
                tip=tip,
                items_count=len(items),
                owner_url=session_result['owner_url'],
                editor_url=session_result['editor_url'],
                is_verified=(quality_score == 100),
                decimal_places=decimal_places,
                number_format=number_format
            )
            print(f"✅ Sesión colaborativa creada: {session_result['session_id']}")

            await send_whatsapp_message(phone_number, message)
            print(f"✅ Boleta procesada exitosamente para {phone_number}")

        except Exception as ocr_error:
            print(f"❌ Error en OCR: {str(ocr_error)}")
            error_msg = get_message("error_ocr", lang, error=str(ocr_error)) if i18n_available else f"Error al procesar la boleta: {str(ocr_error)}\n\nPor favor intenta con una foto más clara."
            await send_whatsapp_message(
                phone_number,
                f"❌ {error_msg}"
            )

    except Exception as e:
        print(f"❌ Error procesando imagen: {str(e)}")
        # Note: lang might not be defined if error happened before language detection
        error_lang = lang if 'lang' in dir() else "es"
        error_msg = get_message("error_general", error_lang) if i18n_available else "Ocurrió un error. Por favor intenta de nuevo."
        await send_whatsapp_message(
            phone_number,
            f"❌ {error_msg}"
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


async def process_text_message(phone_number: str, message: str):
    """Procesar mensajes de texto"""

    # Detect language from phone number
    lang = detect_language(phone_number) if i18n_available else "es"
    message_lower = message.lower()

    # Keywords for each language
    hello_words = ["hola", "hello", "hi", "start", "empezar", "oi", "olá", "你好", "नमस्ते", "salut", "bonjour", "привет", "こんにちは", "hallo", "hai"]
    help_words = ["ayuda", "help", "como", "instructions", "ajuda", "帮助", "मदद", "aide", "помощь", "ヘルプ", "hilfe", "bantuan"]

    if any(word in message_lower for word in hello_words):
        welcome_message = get_message("welcome", lang) if i18n_available else (
            "🤖 ¡Hola! Soy Bill-e, tu asistente para dividir cuentas.\n\n"
            "📸 **Para empezar:**\n"
            "1️⃣ Toma una foto clara de tu boleta\n"
            "2️⃣ Envíamela por este chat\n"
            "3️⃣ Te crearé un link para dividir automáticamente\n\n"
            "💡 También puedes escribir 'ayuda' para más información."
        )
        await send_whatsapp_message(phone_number, f"🤖 {welcome_message}")

    elif any(word in message_lower for word in help_words):
        help_message = get_message("help", lang) if i18n_available else (
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
        await send_whatsapp_message(phone_number, f"🆘 {help_message}")

    else:
        default_message = get_message("default", lang) if i18n_available else (
            "🤔 Para dividir una cuenta, envíame una foto de tu boleta.\n\n"
            "📸 Solo toma la foto y envíamela - yo haré el resto.\n"
            "💡 Escribe 'ayuda' si necesitas más información."
        )
        await send_whatsapp_message(phone_number, f"🤔 {default_message}")

# Función para procesar documentos (PDFs de boletas)
async def process_document_message(phone_number: str, document_data: dict):
    """Procesar documentos (como PDFs de boletas)"""

    # Detect language from phone number
    lang = detect_language(phone_number) if i18n_available else "es"
    document_name = document_data.get("filename", "documento")

    message = get_message("document_received", lang, filename=document_name) if i18n_available else (
        f"📄 Recibí tu documento: {document_name}\n\n"
        "🤖 Por ahora solo puedo procesar imágenes de boletas.\n"
        "📸 ¿Puedes enviarme una foto de la boleta en su lugar?"
    )

    await send_whatsapp_message(phone_number, f"📄 {message}")

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

                # Track cost (WhatsApp Business API Chile: ~$0.0088 USD per utility message)
                if analytics_available:
                    analytics.track_cost(
                        service='whatsapp',
                        operation='send_message',
                        cost_usd=0.0088,
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
