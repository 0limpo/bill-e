from fastapi import Query, Response, Request, HTTPException
from datetime import datetime, timedelta
import uuid
import json
import os
import httpx
import redis

# Variables de entorno (las configuraremos después)
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
    
    # Debug logs mejorados
    print(f"🔍 DEBUG - Verificando webhook:")
    print(f"  - hub_mode recibido: '{hub_mode}'")
    print(f"  - hub_challenge recibido: '{hub_challenge}'")
    print(f"  - hub_verify_token recibido: '{hub_verify_token}'")
    print(f"  - WHATSAPP_VERIFY_TOKEN esperado: '{WHATSAPP_VERIFY_TOKEN}'")
    print(f"  - Tokens son iguales: {hub_verify_token == WHATSAPP_VERIFY_TOKEN}")
    
    if hub_mode == "subscribe" and hub_verify_token == WHATSAPP_VERIFY_TOKEN:
        print("✅ Webhook verificado correctamente")
        return Response(content=hub_challenge, media_type="text/plain")
    else:
        print("❌ Verificación fallida")
        print(f"  - hub_mode == 'subscribe': {hub_mode == 'subscribe'}")
        print(f"  - tokens iguales: {hub_verify_token == WHATSAPP_VERIFY_TOKEN}")
        raise HTTPException(status_code=403, detail="Forbidden")

# Función para manejar mensajes entrantes (POST)
async def handle_webhook(request: Request):
    """Manejar mensajes entrantes de WhatsApp"""
    
    try:
        body = await request.json()
        print(f"📨 Mensaje recibido: {body}")
        
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
            
            # Obtener texto del mensaje
            message_text = ""
            if "text" in message_data:
                message_text = message_data["text"]["body"]
            
            print(f"👤 Mensaje de {from_number}: {message_text}")
            
            # Procesar el mensaje para Bill-e
            await process_bill_message(from_number, message_text)
        
        return {"status": "ok"}
        
    except Exception as e:
        print(f"❌ Error procesando webhook: {e}")
        return {"status": "error", "message": str(e)}

# Función principal para procesar mensajes de Bill-e
async def process_bill_message(phone_number: str, message: str):
    """Lógica principal para procesar mensajes de Bill-e"""
    
    message_lower = message.lower()
    
    # Detectar comandos de inicio
    if any(word in message_lower for word in ["hola", "dividir", "split", "cuenta", "bill", "hi"]):
        # Crear nueva sesión
        session_id = await create_new_session(phone_number)
        
        # Enviar mensaje de bienvenida
        welcome_message = (
            "🤖 ¡Hola! Soy Bill-e, tu asistente para dividir cuentas.\n\n"
            f"📸 Envíame una foto de tu boleta o usa este link:\n"
            f"👉 https://bill-e.vercel.app/s/{session_id}\n\n"
            "💡 También puedes escribir 'ayuda' para más información."
        )
        
        await send_whatsapp_message(phone_number, welcome_message)
    
    elif "ayuda" in message_lower or "help" in message_lower:
        help_message = (
            "🆘 *Ayuda de Bill-e*\n\n"
            "1️⃣ Escribe 'hola' para empezar\n"
            "2️⃣ Envía una foto de tu boleta\n"
            "3️⃣ Te envío un link para dividir\n"
            "4️⃣ ¡Listo! 🎉\n\n"
            "💰 Perfecto para salidas con amigos"
        )
        await send_whatsapp_message(phone_number, help_message)
    
    else:
        # Respuesta por defecto
        default_message = (
            "🤔 No entendí tu mensaje.\n\n"
            "Escribe 'hola' para dividir una cuenta o 'ayuda' para más información."
        )
        await send_whatsapp_message(phone_number, default_message)

# Función para crear nueva sesión
async def create_new_session(phone_number: str) -> str:
    """Crear nueva sesión de Bill-e vinculada a número de WhatsApp"""
    
    session_id = str(uuid.uuid4())[:8]
    
    session_data = {
        "id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "phone_number": phone_number,
        "status": "waiting_receipt",
        "bill_data": None,
        "calculations": None,
        "expires_at": (datetime.utcnow() + timedelta(hours=1)).isoformat()
    }
    
    # Aquí deberías guardar en Redis (adapta a tu implementación actual)
    redis_client.setex(f"session:{session_id}", 3600, json.dumps(session_data))
    
    print(f"✅ Sesión creada: {session_id} para {phone_number}")
    return session_id

# Función para enviar mensajes por WhatsApp
async def send_whatsapp_message(phone_number: str, message: str):
    """Enviar mensaje por WhatsApp"""
    
    if not WHATSAPP_ACCESS_TOKEN or not WHATSAPP_PHONE_NUMBER_ID:
        print("⚠️ Tokens de WhatsApp no configurados")
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
            
            if response.status_code == 200:
                print(f"✅ Mensaje enviado a {phone_number}")
            else:
                print(f"❌ Error enviando mensaje: {response.text}")
                
            return response.json()
            
    except Exception as e:
        print(f"❌ Error en send_whatsapp_message: {e}")