from fastapi import Query, Response, Request, HTTPException
from datetime import datetime, timedelta
import uuid
import json
import os
import httpx
import redis
import base64

# Importar OCR service (Vision + Gemini paralelo)
try:
    from ocr_enhanced import process_image_parallel
except ImportError:
    print("Warning: OCR service not available")
    process_image_parallel = None

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
        # Enviar mensaje de procesamiento
        await send_whatsapp_message(
            phone_number,
            "⏳ Estoy procesando tu boleta..."
        )

        # Obtener ID de la imagen
        media_id = image_data.get('id')
        if not media_id:
            await send_whatsapp_message(phone_number, "❌ No pude obtener la imagen. Intenta de nuevo.")
            return

        # Descargar imagen
        media_url = await get_whatsapp_media_url(media_id)
        if not media_url:
            await send_whatsapp_message(phone_number, "❌ No pude descargar la imagen.")
            return

        image_bytes = await download_whatsapp_media(media_url)
        if not image_bytes:
            await send_whatsapp_message(phone_number, "❌ Error al descargar la imagen.")
            return

        print(f"📥 Imagen descargada: {len(image_bytes)} bytes")

        # Procesar con Vision + Gemini en paralelo
        try:
            result = process_image_parallel(image_bytes)

            # Extraer datos
            total = result.get('total', 0)
            subtotal = result.get('subtotal', 0)
            tip = result.get('tip', 0)
            items = result.get('items', [])
            validation = result.get('validation', {})
            ocr_source = result.get('ocr_source', 'unknown')

            print(f"✅ OCR completado con {ocr_source}: {len(items)} items, score: {validation.get('quality_score', 0)}")

            # Crear sesión con datos
            session_id = create_session_with_bill_data(
                phone_number=phone_number,
                bill_data=result
            )

            # Formatear mensaje de respuesta
            message = format_success_message_enhanced(
                enhanced_result=result,
                session_id=session_id
            )

            await send_whatsapp_message(phone_number, message)
            print(f"✅ Boleta procesada exitosamente para {phone_number}")

        except Exception as ocr_error:
            print(f"❌ Error en OCR: {str(ocr_error)}")
            await send_whatsapp_message(
                phone_number,
                f"❌ Error al procesar la boleta: {str(ocr_error)}\n\nPor favor intenta con una foto más clara."
            )

    except Exception as e:
        print(f"❌ Error procesando imagen: {str(e)}")
        await send_whatsapp_message(
            phone_number,
            "❌ Ocurrió un error. Por favor intenta de nuevo."
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
        'expires_at': (datetime.now() + timedelta(hours=2)).isoformat(),
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

    # Guardar en Redis con TTL de 2 horas
    try:
        redis_client.setex(
            f"session:{session_id}",
            7200,  # 2 horas
            json.dumps(session_data)
        )
        print(f"✅ Sesión creada: {session_id} (2 horas TTL)")
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

    if tip > 0:
        tip_percent = (tip / subtotal * 100) if subtotal > 0 else 0
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
    message += f"⏰ Link válido por 2 horas"

    return message


def format_success_message_enhanced(enhanced_result: dict, session_id: str) -> str:
    """
    Formatea mensaje de WhatsApp con información de calidad.
    """
    total = enhanced_result.get('total', 0)
    subtotal = enhanced_result.get('subtotal', 0)
    tip = enhanced_result.get('tip', 0)
    items = enhanced_result.get('items', [])
    validation = enhanced_result.get('validation', {})
    ocr_source = enhanced_result.get('ocr_source', 'vision')

    # Indicador de calidad
    quality_score = validation.get('quality_score', 0)
    quality_level = validation.get('quality_level', 'low')

    quality_emoji = "✅" if quality_level == "high" else "⚠️" if quality_level == "medium" else "❌"

    # Header con calidad
    message = f"🎉 ¡Boleta procesada exitosamente!\n\n"
    message += f"{quality_emoji} **Calidad del escaneo: {quality_score}/100** ({quality_level})\n"
    message += f"🤖 Procesado con: {ocr_source.upper()}\n\n"

    # Resumen financiero CON FUENTE DE DATOS
    message += f"📊 *Resumen:*\n"
    message += f"💰 Total: ${total:,.0f}\n"

    if subtotal > 0:
        message += f"💵 Subtotal: ${subtotal:,.0f}\n"

    if tip > 0:
        tip_percent = (tip / subtotal * 100) if subtotal > 0 else 0
        message += f"🎁 Propina: ${tip:,.0f} ({tip_percent:.0f}%)\n"
    else:
        message += f"🎁 Propina: No detectada\n"

    message += f"📝 Items: {len(items)}\n"

    # AGREGAR DEBUG INFO (temporal)
    message += f"\n🔍 _Debug:_\n"
    message += f"OCR Source: {ocr_source}\n"
    message += f"Quality: {quality_score}/100\n"
    message += f"is_valid: {validation.get('is_valid')}\n"
    message += f"total_difference: ${validation.get('total_difference', 0):,.0f}\n"
    message += f"difference_percent: {validation.get('difference_percent', 0)}%\n"

    # Mostrar si totales calzan
    if validation.get('is_valid'):
        message += f"✅ Totales verificados\n"
    else:
        diff = validation.get('total_difference', 0)
        message += f"⚠️ Diferencia: ${diff:,.0f}\n"

    message += "\n"


    # Warnings si existen
    warnings = validation.get('warnings', [])
    if warnings:
        message += "⚠️ *Avisos:*\n"
        for warning in warnings[:2]:  # Máximo 2 warnings
            message += f"• {warning.get('message', '')}\n"
        message += "\n"

    # Items consolidados
    consolidated_count = validation.get('consolidated_items', 0)
    if consolidated_count > 0:
        message += f"🔗 Se consolidaron {consolidated_count} items duplicados\n\n"

    # Primeros 3 items
    if items:
        message += f"📦 *Items encontrados* (primeros 3):\n"
        for item in items[:3]:
            quantity = item.get('quantity', 1)
            name = item['name']
            price = item['price']  # Precio unitario
            group_total = item.get('group_total', price * quantity)
            duplicates = item.get('duplicates_found', 0)

            item_line = f"• {name}"
            if quantity > 1:
                item_line += f" x{quantity}"
            if duplicates > 0:
                item_line += f" 🔗({duplicates + 1} agrupados)"
            # Mostrar precio total del grupo (no unitario)
            item_line += f" - ${group_total:,.0f}\n"

            message += item_line

        if len(items) > 3:
            message += f"... y {len(items) - 3} items más\n"

    message += "\n"

    # Link
    frontend_url = os.getenv('FRONTEND_URL', 'https://bill-e.vercel.app')
    message += f"🔗 *Divide tu cuenta aquí:*\n"
    message += f"{frontend_url}/s/{session_id}\n\n"

    # Footer
    message += f"⏰ Link expira en 2 horas"

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