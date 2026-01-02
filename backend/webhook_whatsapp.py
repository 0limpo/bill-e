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
    from gemini_service import process_image
except ImportError:
    print("Warning: OCR service not available")
    process_image = None

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

async def process_image_message(phone_number: str, image_data: dict):
    """Procesa mensaje con imagen (boleta) usando Vision + Gemini en paralelo."""
    try:
        # Detect language from phone number
        lang = detect_language(phone_number) if i18n_available else "es"

        # Enviar mensaje de procesamiento
        processing_msg = get_message("processing", lang) if i18n_available else "Estoy procesando tu boleta..."
        await send_whatsapp_message(
            phone_number,
            f"⏳ {processing_msg}"
        )

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

        # Procesar con Vision + Gemini en paralelo
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
            if create_collaborative_session:
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

                # Formatear mensaje con ambos links (i18n)
                quality_score = validation.get('quality_score', 0) if validation else 0
                decimal_places = result.get('decimal_places', 0)
                number_format = result.get('number_format', {'thousands': ',', 'decimal': '.'})
                if i18n_available:
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
                else:
                    message = format_collaborative_message(
                        total=total,
                        subtotal=subtotal,
                        tip=tip,
                        items_count=len(items),
                        owner_url=session_result['owner_url'],
                        editor_url=session_result['editor_url'],
                        validation=validation
                    )

                print(f"✅ Sesión colaborativa creada: {session_result['session_id']}")
            else:
                # Fallback a sesión simple si no está disponible
                session_id = create_session_with_bill_data(
                    phone_number=phone_number,
                    bill_data=result
                )
                message = format_success_message_enhanced(
                    enhanced_result=result,
                    session_id=session_id
                )

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

def create_session_with_bill_data(phone_number: str, bill_data: dict) -> str:
    """
    Crea sesión con datos de boleta procesada.
    """
    session_id = str(uuid.uuid4())

    # Extraer datos
    items = bill_data.get('items', [])
    total = bill_data.get('total', 0)
    subtotal = bill_data.get('subtotal', 0)
    tip = bill_data.get('tip', 0)
    validation = bill_data.get('validation', {})
    ocr_source = bill_data.get('ocr_source', 'unknown')

    # Convertir items al formato de sesión PRESERVANDO consolidación
    session_items = []
    for i, item in enumerate(items):
        session_items.append({
            'id': f"item-{i}",
            'name': item['name'],
            'price': item['price'],
            'quantity': item.get('quantity', 1),
            'assigned_to': [],
            'confidence': item.get('confidence', 'medium'),
            'duplicates_found': item.get('duplicates_found', 0),
            'normalized_name': item.get('normalized_name', ''),
            'group_total': item.get('group_total', item['price'] * item.get('quantity', 1))
        })

    # Crear sesión
    session_data = {
        'session_id': session_id,
        'phone': phone_number,
        'created_at': datetime.now().isoformat(),
        'expires_at': (datetime.now() + timedelta(hours=24)).isoformat(),
        'items': session_items,
        'people': [],
        'total': total,
        'subtotal': subtotal,
        'tip': tip,
        'tip_percentage': 0.1,
        'state': 'SHOWING_RESULT',
        'result': None,
        'ocr_source': ocr_source,
        'validation': validation,
        'raw_text': bill_data.get('raw_text', ''),
        'confidence': bill_data.get('confidence', 'medium')
    }

    # Guardar en Redis con TTL de 24 horas
    try:
        redis_client.setex(
            f"session:{session_id}",
            86400,  # 24 horas
            json.dumps(session_data)
        )
        print(f"✅ Sesión creada: {session_id} (24 horas TTL)")
    except Exception as e:
        print(f"❌ Error guardando sesión: {str(e)}")
        raise

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

def format_success_message_simple(ocr_result: dict, session_id: str) -> str:
    """
    Formatea mensaje de WhatsApp con el resultado del OCR simplificado.
    """
    total = ocr_result.get('total', 0)
    subtotal = ocr_result.get('subtotal', 0)
    tip = ocr_result.get('tip', 0)
    items = ocr_result.get('items', [])
    confidence_score = ocr_result.get('confidence_score', 0)
    confidence = ocr_result.get('confidence', 'medium')
    currency = ocr_result.get('currency', 'CLP')

    # Emoji de calidad
    quality_emoji = "✅" if confidence == "high" else "⚠️" if confidence == "medium" else "❌"

    # Header
    message = f"🎉 ¡Boleta procesada!\n\n"
    message += f"{quality_emoji} Confianza: {confidence_score}/100\n\n"

    # Resumen financiero
    message += f"📊 *Resumen:*\n"
    message += f"💰 Total: ${total:,}\n"

    if subtotal > 0:
        message += f"💵 Subtotal: ${subtotal:,}\n"

    if tip and tip > 0:
        tip_percent = (tip / subtotal * 100) if subtotal and subtotal > 0 else 0
        message += f"🎁 Propina: ${tip:,} ({tip_percent:.0f}%)\n"

    message += f"📝 Items: {len(items)}\n\n"

    # Primeros 3 items
    if items:
        message += f"📦 *Items:*\n"
        for item in items[:3]:
            quantity = item.get('quantity', 1)
            name = item['name']
            price = item['price']
            total_item = price * quantity

            if quantity > 1:
                message += f"• {quantity}x {name} - ${total_item:,}\n"
            else:
                message += f"• {name} - ${price:,}\n"

        if len(items) > 3:
            message += f"... y {len(items) - 3} más\n"

    message += "\n"

    # Link
    frontend_url = os.getenv('FRONTEND_URL', 'https://bill-e.vercel.app')
    message += f"🔗 *Divide tu cuenta aquí:*\n"
    message += f"{frontend_url}/s/{session_id}\n\n"

    # Footer
    message += f"⏰ Link válido por 24 horas"

    return message


def format_success_message_enhanced(enhanced_result: dict, session_id: str) -> str:
    """
    Formatea mensaje de WhatsApp - versión simplificada sin debug.
    """
    total = enhanced_result.get('total', 0)
    subtotal = enhanced_result.get('subtotal', 0)
    tip = enhanced_result.get('tip', 0)
    items = enhanced_result.get('items', [])
    validation = enhanced_result.get('validation', {})

    # Score simplificado: 100 = verified, <100 = review
    quality_score = validation.get('quality_score', 0)

    # Calcular porcentaje de propina
    tip_percent = ((tip or 0) / subtotal * 100) if subtotal and subtotal > 0 else 0

    # URL del frontend
    frontend_url = os.getenv('FRONTEND_URL', 'https://bill-e.vercel.app')
    url = f"{frontend_url}/s/{session_id}"

    if quality_score == 100:
        # Mensaje para totales verificados
        message = f"🧾 ¡Boleta procesada satisfactoriamente!\n\n"
        message += f"✅ *Totales verificados*\n\n"
        message += f"📋 Resumen:\n"
        message += f"💰 Total: ${total:,.0f}\n"
        message += f"📊 Subtotal: ${subtotal:,.0f}\n"
        message += f"🎁 Propina: ${tip:,.0f} ({tip_percent:.0f}%)\n"
        message += f"📝 Items: {len(items)}\n\n"
        message += f"🔗 Divide tu cuenta aquí:\n"
        message += f"{url}\n\n"
        message += f"⏰ Link válido por 24 horas"
    else:
        # Mensaje para revisar
        message = f"🧾 ¡Boleta procesada!\n\n"
        message += f"⚠️ *Verificar totales e items*\n\n"
        message += f"📋 Resumen:\n"
        message += f"💰 Total: ${total:,.0f}\n"
        message += f"📊 Subtotal: ${subtotal:,.0f}\n"
        message += f"🎁 Propina: ${tip:,.0f} ({tip_percent:.0f}%)\n"
        message += f"📝 Items: {len(items)}\n\n"
        message += f"🔗 Edita los datos aquí:\n"
        message += f"{url}\n\n"
        message += f"⏰ Link válido por 24 horas"

    return message


def format_collaborative_message(
    total: float,
    subtotal: float,
    tip: float,
    items_count: int,
    owner_url: str,
    editor_url: str,
    validation: dict = None
) -> str:
    """
    Formatea mensaje de WhatsApp para sesiones colaborativas.
    Incluye 2 links: owner (para el anfitrión) y editor (para compartir).
    """
    # Calcular porcentaje de propina
    tip_percent = ((tip or 0) / subtotal * 100) if subtotal and subtotal > 0 else 0

    # Quality score para verificación
    quality_score = validation.get('quality_score', 0) if validation else 0

    # Emoji de estado
    status_emoji = "✅" if quality_score == 100 else "⚠️"
    status_text = "Totales verificados" if quality_score == 100 else "Revisar totales"

    # Add v=B parameter to URLs
    owner_url_final = f"{owner_url}&v=B" if "?" in owner_url else f"{owner_url}?v=B"
    editor_url_final = f"{editor_url}?v=B"

    message = f"""🧾 *¡Boleta procesada!*

{status_emoji} {status_text}

💰 Total: ${total:,.0f}
📝 {items_count} items

━━━━━━━━━━━━━━━━━━

📌 *Tu link de anfitrión* (guárdalo):
{owner_url_final}

🔗 *Link para compartir* con tus amigos:
{editor_url_final}

⏰ Expira en 24 horas"""

    return message


# Función mejorada para procesar mensajes de texto
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
        "expires_at": (datetime.utcnow() + timedelta(hours=24)).isoformat()
    }

    redis_client.setex(f"session:{session_id}", 86400, json.dumps(session_data))
    
    print(f"✅ Sesión simple creada: {session_id}")
    return session_id