from fastapi import FastAPI, Request, Query, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import uuid
import random
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Importar servicios existentes
try:
    from database import Database
    from models import SessionData
    from webhook_whatsapp import verify_webhook, handle_webhook, redis_client
except ImportError as e:
    print(f"Warning: Could not import some modules: {e}")
    redis_client = None

# Importar OCR service (Gemini)
try:
    from gemini_service import process_image
    ocr_available = True
except ImportError as e:
    print(f"Warning: OCR service not available: {e}")
    process_image = None
    ocr_available = False

# Importar Analytics
try:
    from analytics_routes import router as analytics_router
    from analytics_middleware import AnalyticsMiddleware
    from alerting import init_alerting
    analytics_available = True
except ImportError as e:
    print(f"Warning: Analytics not available: {e}")
    analytics_available = False

# Importar WhatsApp Analytics Dashboard
try:
    from whatsapp_dashboard_routes import router as whatsapp_dashboard_router
    whatsapp_dashboard_available = True
except ImportError as e:
    print(f"Warning: WhatsApp Dashboard not available: {e}")
    whatsapp_dashboard_available = False

# Importar Collaborative Sessions
try:
    from collaborative_session import (
        create_collaborative_session,
        get_session as get_collab_session,
        verify_owner,
        verify_owner_device,
        add_participant,
        update_assignment,
        finalize_session,
        calculate_totals,
        get_participant_summary,
        SessionStatus
    )
    collaborative_available = True
except ImportError as e:
    print(f"Warning: Collaborative sessions not available: {e}")
    collaborative_available = False

load_dotenv()

app = FastAPI(title="Bill-e API", version="1.0.0")

# Add Analytics Middleware FIRST (before CORS)
if analytics_available:
    app.add_middleware(AnalyticsMiddleware)

# CORS para el frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modelos para OCR
class OCRRequest(BaseModel):
    image: str  # Base64 encoded image

class Person(BaseModel):
    id: str
    name: str

class Item(BaseModel):
    id: str
    name: str
    price: float
    assigned_to: List[str] = []

class BillSession(BaseModel):
    id: str
    total: float = 0
    subtotal: float = 0
    tip: float = 0
    people: List[Person] = []
    items: List[Item] = []
    created_at: str
    expires_at: str

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "bill-e-backend"}

# ================ ENDPOINTS ORIGINALES DE WHATSAPP ================

@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Frontend obtiene datos de la sesión"""
    if not redis_client:
        raise HTTPException(status_code=500, detail="Redis not available")
    
    session_data = redis_client.get(f"session:{session_id}")
    
    if not session_data:
        raise HTTPException(status_code=404, detail="Sesión no encontrada o expirada")
    
    return json.loads(session_data)

@app.post("/api/session/{session_id}/calculate")
async def calculate_bill(session_id: str, request: Request):
    """Frontend envía la división calculada"""
    data = await request.json()
    
    # Si tenemos Database, usar el flujo original
    if 'Database' in globals():
        session = Database.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Sesión expirada")
        
        # Guardar resultado
        session.result = data
        Database.save_session(session)
    
    # También guardar en Redis para compatibilidad
    if redis_client:
        result = {
            "session_id": session_id,
            "timestamp": datetime.now().isoformat(),
            **data
        }
        redis_client.setex(f"result:{session_id}", 86400, json.dumps(result))
    
    return {"status": "ok", "message": "Resultado guardado"}

# ================ NUEVOS ENDPOINTS OCR ================

@app.post("/api/session")
async def create_session():
    """Crear una nueva sesión de división de cuenta"""
    try:
        # Generar ID único para la sesión
        session_id = str(uuid.uuid4())
        
        # Crear sesión con datos iniciales
        session = BillSession(
            id=session_id,
            created_at=datetime.now().isoformat(),
            expires_at=(datetime.now() + timedelta(hours=24)).isoformat()
        )

        # Guardar en Redis (expira en 24 horas)
        if redis_client:
            redis_client.setex(
                f"session:{session_id}",
                86400,  # 24 horas en segundos
                session.json()
            )
        
        return {
            "session_id": session_id,
            "expires_at": session.expires_at,
            "frontend_url": f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/s/{session_id}"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creando sesión: {str(e)}")

@app.post("/api/session/{session_id}/ocr")
async def process_receipt_ocr(session_id: str, request: OCRRequest):
    """Procesar imagen de boleta con Gemini OCR"""
    try:
        # Verificar que la sesión existe
        if redis_client:
            session_data = redis_client.get(f"session:{session_id}")
            if not session_data:
                raise HTTPException(status_code=404, detail="Sesión no encontrada")

        # Decodificar imagen base64
        import base64
        if ',' in request.image:
            image_b64 = request.image.split(',')[1]
        else:
            image_b64 = request.image

        image_bytes = base64.b64decode(image_b64)

        # Procesar con OCR (Vision + Gemini paralelo)
        try:
            ocr_result = process_image(image_bytes)

            if not ocr_result.get('success'):
                raise HTTPException(status_code=400, detail=ocr_result.get('error', 'Error en OCR'))

            # Actualizar sesión con resultado
            if redis_client and session_data:
                session = json.loads(session_data.decode('utf-8'))
                session['total'] = ocr_result.get('total', 0)
                session['subtotal'] = ocr_result.get('subtotal', 0)
                session['tip'] = ocr_result.get('tip', 0)
                session['price_mode'] = ocr_result.get('price_mode', 'unitario')

                # Convertir items al formato de sesión
                session_items = []
                for i, item in enumerate(ocr_result.get('items', [])):
                    quantity = item.get('quantity', 1)
                    price = item['price']
                    price_as_shown = item.get('price_as_shown', price)
                    session_items.append({
                        'id': f"item-{i}",
                        'name': item['name'],
                        'price': price,  # Precio unitario (para cálculos)
                        'price_as_shown': price_as_shown,  # Precio como aparece en boleta
                        'quantity': quantity,
                        'assigned_to': [],
                        'group_total': price * quantity
                    })

                session['items'] = session_items

                # Guardar sesión actualizada (preserve TTL or 24h)
                existing_ttl = redis_client.ttl(f"session:{session_id}")
                redis_client.setex(
                    f"session:{session_id}",
                    existing_ttl if existing_ttl > 0 else 86400,
                    json.dumps(session)
                )

            return {
                "success": True,
                "data": ocr_result,
                "session": session if redis_client else None,
                "ocr_source": ocr_result.get('ocr_source')
            }

        except HTTPException:
            raise
        except Exception as ocr_error:
            print(f"OCR Error: {str(ocr_error)}")
            raise HTTPException(status_code=400, detail=f"Error en OCR: {str(ocr_error)}")

    except HTTPException:
        raise
    except Exception as e:
        print(f"OCR processing error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/session/{session_id}/upload")
async def upload_receipt_image(session_id: str, file: UploadFile = File(...)):
    """Upload y procesa imagen con Gemini OCR."""
    try:
        # Verificar que la sesión existe
        if redis_client:
            session_data = redis_client.get(f"session:{session_id}")
            if not session_data:
                raise HTTPException(status_code=404, detail="Sesión no encontrada")

        # Verificar tipo de archivo
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")

        # Leer imagen
        image_bytes = await file.read()

        # Procesar con OCR (Vision + Gemini paralelo)
        try:
            ocr_result = process_image(image_bytes)

            if not ocr_result.get('success'):
                raise HTTPException(status_code=400, detail=ocr_result.get('error', 'Error en OCR'))

            # Actualizar sesión con resultado
            if redis_client and session_data:
                session = json.loads(session_data.decode('utf-8'))
                session['total'] = ocr_result.get('total', 0)
                session['subtotal'] = ocr_result.get('subtotal', 0)
                session['tip'] = ocr_result.get('tip', 0)
                session['price_mode'] = ocr_result.get('price_mode', 'unitario')

                # Convertir items al formato de sesión
                session_items = []
                for i, item in enumerate(ocr_result.get('items', [])):
                    quantity = item.get('quantity', 1)
                    price = item['price']
                    price_as_shown = item.get('price_as_shown', price)
                    session_items.append({
                        'id': f"item-{i}",
                        'name': item['name'],
                        'price': price,  # Precio unitario (para cálculos)
                        'price_as_shown': price_as_shown,  # Precio como aparece en boleta
                        'quantity': quantity,
                        'assigned_to': [],
                        'group_total': price * quantity
                    })

                session['items'] = session_items

                # Guardar sesión actualizada (preserve TTL or 24h)
                existing_ttl = redis_client.ttl(f"session:{session_id}")
                redis_client.setex(
                    f"session:{session_id}",
                    existing_ttl if existing_ttl > 0 else 86400,
                    json.dumps(session)
                )

            return {
                "success": True,
                "data": ocr_result,
                "session": session if redis_client else None,
                "ocr_source": ocr_result.get('ocr_source')
            }

        except HTTPException:
            raise
        except Exception as ocr_error:
            print(f"OCR Error: {str(ocr_error)}")
            raise HTTPException(status_code=400, detail=f"Error en OCR: {str(ocr_error)}")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/session/{session_id}/update")
async def update_session(session_id: str, request: Request):
    """Actualizar datos de la sesión"""
    try:
        session_data = await request.json()
        
        # Verificar que la sesión existe
        if redis_client:
            existing_session = redis_client.get(f"session:{session_id}")
            if not existing_session:
                raise HTTPException(status_code=404, detail="Sesión no encontrada")
            
            # Actualizar sesión (preserve TTL or 24h)
            existing_ttl = redis_client.ttl(f"session:{session_id}")
            redis_client.setex(
                f"session:{session_id}",
                existing_ttl if existing_ttl > 0 else 86400,
                json.dumps(session_data)
            )
        
        return {"success": True, "session": session_data}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error actualizando sesión: {str(e)}")

# ================ ANALYTICS ROUTER ================

if analytics_available:
    app.include_router(analytics_router)
    print("✅ Analytics router included")

# ================ WHATSAPP ANALYTICS DASHBOARD ================

if whatsapp_dashboard_available:
    app.include_router(whatsapp_dashboard_router)
    print("✅ WhatsApp Analytics Dashboard router included")

# ================ STARTUP EVENT ================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    if analytics_available:
        init_alerting()
        print("✅ Analytics and alerting initialized")

# ================ ENDPOINTS WHATSAPP ORIGINALES ================

@app.get("/webhook/whatsapp")
async def whatsapp_webhook_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"), 
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    if 'verify_webhook' in globals():
        return await verify_webhook(hub_mode, hub_challenge, hub_verify_token)
    else:
        raise HTTPException(status_code=500, detail="WhatsApp webhook not available")

@app.post("/webhook/whatsapp")
async def whatsapp_webhook_handle(request: Request):
    if 'handle_webhook' in globals():
        return await handle_webhook(request)
    else:
        raise HTTPException(status_code=500, detail="WhatsApp webhook not available")

# ============================================
# ENDPOINTS COLABORATIVOS
# ============================================

@app.post("/api/session/collaborative")
async def create_collaborative_session_endpoint(request: Request):
    try:
        data = await request.json()
        result = create_collaborative_session(
            redis_client=redis_client,
            owner_phone=data.get("owner_phone", ""),
            items=data.get("items", []),
            total=data.get("total", 0),
            subtotal=data.get("subtotal", 0),
            tip=data.get("tip", 0),
            raw_text=data.get("raw_text", ""),
            charges=data.get("charges", []),
            decimal_places=data.get("decimal_places", 0)
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}/collaborative")
async def get_collaborative_session(session_id: str, owner: str = None, device_id: str = None):
    try:
        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada o expirada")

        is_owner = False
        if owner:
            # If device_id provided, use strict device verification
            if device_id:
                device_result = verify_owner_device(redis_client, session_id, session_data, owner, device_id)
                if not device_result["valid"]:
                    if device_result["error"] == "device_mismatch":
                        raise HTTPException(status_code=403, detail="session_active_elsewhere")
                    else:
                        raise HTTPException(status_code=403, detail="No autorizado")
                is_owner = True
            else:
                # Legacy: no device_id, just verify token
                is_owner = verify_owner(session_data, owner)

        response = {
            "session_id": session_id,
            "status": session_data["status"],
            "host_step": session_data.get("host_step", 1),  # Track host's current step
            "items": session_data["items"],
            "participants": session_data["participants"],
            "assignments": session_data["assignments"],
            "charges": session_data.get("charges", []),  # taxes, discounts, service charges
            "tip_percentage": session_data.get("tip_percentage", 10),
            "tip_mode": session_data.get("tip_mode", "percent"),  # "percent" or "fixed"
            "tip_value": session_data.get("tip_value", 10.0),  # Default 10%
            "has_tip": session_data.get("has_tip", False),  # True only if receipt shows tip
            "decimal_places": session_data.get("decimal_places", 0),  # 0 for CLP, 2 for USD
            "number_format": session_data.get("number_format", {"thousands": ",", "decimal": "."}),
            "price_mode": session_data.get("price_mode", "unitario"),  # 'unitario' o 'total_linea'
            "expires_at": session_data["expires_at"],
            "last_updated": session_data.get("last_updated"),
            "last_updated_by": session_data.get("last_updated_by"),
            "is_owner": is_owner
        }

        if is_owner:
            response["total"] = session_data["total"]
            response["subtotal"] = session_data["subtotal"]
            response["tip"] = session_data["tip"]
            response["owner_phone"] = session_data.get("owner_phone")

            if session_data["status"] == SessionStatus.FINALIZED.value:
                response["totals"] = session_data.get("totals", [])

        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/join")
async def join_session(session_id: str, request: Request):
    try:
        from collaborative_session import check_editor_device_limit, register_editor_session

        data = await request.json()
        name = data.get("name", "").strip()
        phone = data.get("phone", "").strip() or "N/A"  # Phone is now optional
        device_id = data.get("device_id", "").strip()

        if not name:
            raise HTTPException(status_code=400, detail="El nombre es requerido")

        # Check device limit if device_id provided
        if device_id:
            limit_check = check_editor_device_limit(redis_client, device_id, session_id)

            if not limit_check.get("allowed"):
                # Limit reached - return paywall status
                return {
                    "status": "limit_reached",
                    "sessions_used": limit_check.get("sessions_used", 0),
                    "free_limit": limit_check.get("free_limit", 2),
                    "requires_payment": True
                }

        result = add_participant(redis_client, session_id, name, phone)

        if "error" in result:
            raise HTTPException(status_code=result.get("code", 400), detail=result["error"])

        # Register session for device tracking (if device_id provided and not returning)
        if device_id and not result.get("is_existing"):
            device_status = register_editor_session(redis_client, device_id, session_id)
            result["sessions_used"] = device_status.get("sessions_used", 0)
            result["sessions_remaining"] = device_status.get("remaining", 0)

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/assign")
async def assign_item(session_id: str, request: Request):
    try:
        data = await request.json()

        result = update_assignment(
            redis_client=redis_client,
            session_id=session_id,
            participant_id=data.get("participant_id"),
            item_id=data.get("item_id"),
            quantity=data.get("quantity", 1),
            is_assigned=data.get("is_assigned", True),
            updated_by=data.get("updated_by", "unknown")
        )

        if "error" in result:
            raise HTTPException(status_code=result.get("code", 400), detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/finalize")
async def finalize_session_endpoint(session_id: str, request: Request):
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        if not owner_token:
            raise HTTPException(status_code=400, detail="Token de owner requerido")

        result = finalize_session(redis_client, session_id, owner_token)

        if "error" in result:
            raise HTTPException(status_code=result.get("code", 400), detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/host-step")
async def update_host_step(session_id: str, request: Request):
    """Update which step the host is currently on (owner only)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        step = data.get("step")

        if not owner_token:
            raise HTTPException(status_code=400, detail="Token de owner requerido")

        if step not in [1, 2, 3]:
            raise HTTPException(status_code=400, detail="Step debe ser 1, 2 o 3")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Update the host step
        session_data["host_step"] = step
        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "host_step": step}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/reopen")
async def reopen_session_endpoint(session_id: str, request: Request):
    """Reopen a finalized session (owner only)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        if not owner_token:
            raise HTTPException(status_code=400, detail="Token de owner requerido")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        if session_data.get("status") != "finalized":
            raise HTTPException(status_code=400, detail="La sesion no esta finalizada")

        # Reopen the session
        session_data["status"] = "assigning"
        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Clear the calculated totals (will be recalculated on next finalize)
        if "totals" in session_data:
            del session_data["totals"]
        if "finalized_at" in session_data:
            del session_data["finalized_at"]

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "status": "assigning"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}/poll")
async def poll_session(session_id: str, last_update: str = None):
    try:
        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        current_update = session_data.get("last_updated", "")

        if last_update and current_update == last_update:
            return {"has_changes": False}

        return {
            "has_changes": True,
            "participants": session_data["participants"],
            "assignments": session_data["assignments"],
            "items": session_data["items"],  # Include items for mode/name/price sync
            "status": session_data["status"],
            "host_step": session_data.get("host_step", 1),  # Track host's current step
            "totals": session_data.get("totals"),  # Include totals for finalized state
            "tip_mode": session_data.get("tip_mode", "percent"),
            "tip_value": session_data.get("tip_value", 10.0),
            "tip_percentage": session_data.get("tip_percentage", 10),
            "has_tip": session_data.get("has_tip", False),  # True only if receipt shows tip
            "charges": session_data.get("charges", []),  # Include charges for sync
            "decimal_places": session_data.get("decimal_places", 0),  # Include for currency formatting
            "number_format": session_data.get("number_format", {"thousands": ",", "decimal": "."}),
            "last_updated": current_update,
            "last_updated_by": session_data.get("last_updated_by", "")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}/my-summary/{participant_id}")
async def get_my_summary(session_id: str, participant_id: str):
    try:
        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        summary = get_participant_summary(session_data, participant_id)
        return summary
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/update-item")
async def update_item(session_id: str, request: Request):
    """Actualiza un item. Owner puede cambiar todo, editores solo el mode."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        item_id = data.get("item_id")
        updates = data.get("updates", {})

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        is_owner = verify_owner(session_data, owner_token) if owner_token else False

        # Check if trying to update owner-only fields without being owner
        owner_only_fields = {"name", "price", "quantity"}
        requested_owner_fields = owner_only_fields & set(updates.keys())
        if requested_owner_fields and not is_owner:
            raise HTTPException(status_code=403, detail="Solo el anfitrion puede editar nombre, precio y cantidad")

        # Actualizar el item
        for item in session_data["items"]:
            if (item.get("id") or item.get("name")) == item_id:
                # Owner-only fields
                if is_owner:
                    if "name" in updates:
                        item["name"] = updates["name"]
                    if "price" in updates:
                        item["price"] = updates["price"]
                    if "quantity" in updates:
                        item["quantity"] = updates["quantity"]
                # Anyone can change mode (individual/grupal)
                if "mode" in updates:
                    item["mode"] = updates["mode"]
                break

        # CRITICAL: DO NOT recalculate subtotal here!
        # subtotal is the OCR target value - only changed via update-totals endpoint
        # Frontend calculates displayed total dynamically from items
        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Guardar
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "items": session_data["items"]}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/update-participant")
async def update_participant(session_id: str, request: Request):
    """Actualiza datos de un participante (ej: nombre del owner)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        participant_id = data.get("participant_id")
        new_name = data.get("name")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Actualizar el participante
        for participant in session_data["participants"]:
            if participant["id"] == participant_id:
                if new_name:
                    participant["name"] = new_name
                break

        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Guardar
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "participants": session_data["participants"]}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/session/{session_id}/participant/{participant_id}")
async def patch_participant(session_id: str, participant_id: str, request: Request):
    """Update a participant's name via PATCH (simpler endpoint for frontend)."""
    try:
        data = await request.json()
        new_name = data.get("name", "").strip()

        if not new_name:
            raise HTTPException(status_code=400, detail="El nombre es requerido")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        # Find and update the participant
        participant_found = False
        for participant in session_data["participants"]:
            if participant["id"] == participant_id:
                participant["name"] = new_name
                participant_found = True
                break

        if not participant_found:
            raise HTTPException(status_code=404, detail="Participante no encontrado")

        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = new_name

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "participant": {"id": participant_id, "name": new_name}}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/session/{session_id}/participant/{participant_id}")
async def delete_participant(session_id: str, participant_id: str, request: Request):
    """Remove a participant from the session (owner only)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Cannot remove the owner
        participant_to_remove = None
        for p in session_data["participants"]:
            if p["id"] == participant_id:
                participant_to_remove = p
                break

        if not participant_to_remove:
            raise HTTPException(status_code=404, detail="Participante no encontrado")

        if participant_to_remove.get("role") == "owner":
            raise HTTPException(status_code=400, detail="No puedes eliminar al anfitrion")

        # Remove participant
        session_data["participants"] = [p for p in session_data["participants"] if p["id"] != participant_id]

        # Remove their assignments
        for item_id in session_data.get("assignments", {}):
            session_data["assignments"][item_id] = [
                a for a in session_data["assignments"][item_id]
                if a.get("participant_id") != participant_id
            ]

        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "removed_id": participant_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/session/{session_id}/items/{item_id}")
async def delete_item(session_id: str, item_id: str, request: Request):
    """Remove an item from the session (owner only)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Find and remove the item
        original_items = session_data.get("items", [])
        session_data["items"] = [i for i in original_items if (i.get("id") or i.get("name")) != item_id]

        if len(session_data["items"]) == len(original_items):
            raise HTTPException(status_code=404, detail="Item no encontrado")

        # Remove assignments for this item
        if item_id in session_data.get("assignments", {}):
            del session_data["assignments"][item_id]

        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "removed_id": item_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/update-totals")
async def update_totals(session_id: str, request: Request):
    """Actualizar subtotal, propina y total (solo owner)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Actualizar totales
        if "subtotal" in data:
            session_data["subtotal"] = data["subtotal"]
        if "tip" in data:
            session_data["tip"] = data["tip"]
        if "total" in data:
            session_data["total"] = data["total"]
        # Smart Tip settings
        if "tip_mode" in data:
            session_data["tip_mode"] = data["tip_mode"]  # "percent" or "fixed"
        if "tip_value" in data:
            session_data["tip_value"] = data["tip_value"]
        if "tip_percentage" in data:
            session_data["tip_percentage"] = data["tip_percentage"]
        # Charges (taxes, discounts, service charges, etc.)
        if "charges" in data:
            session_data["charges"] = data["charges"]

        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Guardar
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/add-participant-manual")
async def add_participant_manual(session_id: str, request: Request):
    """Agregar participante manualmente (solo owner)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Crear nuevo participante
        new_participant = {
            "id": str(uuid.uuid4())[:8],
            "name": data.get("name", "Invitado"),
            "phone": data.get("phone"),
            "role": "editor",
            "added_by_owner": True,
            "joined_at": datetime.now().isoformat()
        }

        session_data["participants"].append(new_participant)
        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Guardar
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "participant": new_participant}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/add-item")
async def add_item_to_session(session_id: str, request: Request):
    """Agregar item manualmente (solo owner)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Crear nuevo item
        new_item = {
            "id": f"manual_{uuid.uuid4().hex[:8]}",
            "name": data.get("name", "Item"),
            "quantity": data.get("quantity", 1),
            "price": data.get("price", 0),
            "mode": data.get("mode", "individual")  # Default to individual mode
        }

        session_data["items"].append(new_item)
        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Guardar
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "item": new_item}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/split-item")
async def split_item(session_id: str, request: Request):
    """Expand a group item into N individual items (1 unit each).

    Example: 3x Pizza → 3 separate items of 1x Pizza each
    All new items are 'grupal' mode, inserted at original position.
    """
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        item_id = data.get("item_id")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Find the original item
        original_item = None
        original_index = -1
        for idx, item in enumerate(session_data["items"]):
            if (item.get("id") or item.get("name")) == item_id:
                original_item = item
                original_index = idx
                break

        if not original_item:
            raise HTTPException(status_code=404, detail="Item no encontrado")

        original_qty = int(original_item.get("quantity", 1))
        if original_qty <= 1:
            raise HTTPException(status_code=400, detail="Item ya tiene cantidad 1")

        # Get unit price and name
        unit_price = original_item.get("price", 0)
        item_name = original_item.get("name", "Item")

        # Remove original item and its assignments
        if item_id in session_data.get("assignments", {}):
            del session_data["assignments"][item_id]
        session_data["items"].pop(original_index)

        # Create N new items (one for each unit), all grupal mode
        new_items = []
        for i in range(original_qty):
            new_item = {
                "id": f"split_{uuid.uuid4().hex[:8]}",
                "name": item_name,
                "quantity": 1,
                "price": unit_price,
                "mode": "grupal",  # All children are grupal for group assignment
                "isSplitChild": True if i > 0 else False  # First one is "parent"
            }
            new_items.append(new_item)

        # Insert all new items at original position (in order)
        for i, new_item in enumerate(new_items):
            session_data["items"].insert(original_index + i, new_item)

        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {
            "success": True,
            "new_items": new_items,
            "items": session_data["items"]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================
# EDITOR VERIFICATION ENDPOINTS
# =====================================================

FREE_SESSIONS_LIMIT = 2  # Number of free sessions for editors

@app.post("/api/editor/request-code")
async def request_editor_code(request: Request):
    """
    Request a verification code for editor access.
    - If premium: returns status "premium" (no code needed)
    - If free sessions available: sends code via WhatsApp
    - If no free sessions: returns status "paywall"
    """
    try:
        data = await request.json()
        phone = data.get("phone", "").strip()
        session_id = data.get("session_id", "").strip()

        if not phone or not session_id:
            raise HTTPException(status_code=400, detail="Phone and session_id required")

        # Normalize phone number (remove spaces, ensure + prefix)
        phone = phone.replace(" ", "").replace("-", "")
        if not phone.startswith("+"):
            phone = "+" + phone

        # Get or create user profile
        user = Database.get_or_create_user(phone)

        # Check if premium
        if user.is_premium:
            if user.premium_until and user.premium_until > datetime.now():
                return {"status": "premium", "message": "Premium user, no code needed"}
            else:
                # Premium expired
                user.is_premium = False
                Database.save_user(user)

        # Check free sessions
        if user.free_bills_used >= FREE_SESSIONS_LIMIT:
            return {"status": "paywall", "message": "Free sessions exhausted"}

        # Generate 4-digit code
        code = str(random.randint(1000, 9999))

        # Save pending code
        user.pending_code = code
        user.pending_code_expires = datetime.now() + timedelta(minutes=10)
        user.pending_session_id = session_id
        Database.save_user(user)

        # Send code via WhatsApp
        try:
            from webhook_whatsapp import send_whatsapp_message
            import asyncio

            message = f"🔐 Tu código de Bill-e: *{code}*\n\nVálido por 10 minutos."
            await send_whatsapp_message(phone, message)

            return {
                "status": "code_sent",
                "message": "Code sent via WhatsApp",
                "free_remaining": FREE_SESSIONS_LIMIT - user.free_bills_used
            }
        except Exception as e:
            print(f"Error sending WhatsApp: {e}")
            raise HTTPException(status_code=500, detail="Error sending code")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/editor/verify-code")
async def verify_editor_code(request: Request):
    """
    Verify the code and grant access to the session.
    Increments free_bills_used counter on success.
    """
    try:
        data = await request.json()
        phone = data.get("phone", "").strip()
        code = data.get("code", "").strip()
        session_id = data.get("session_id", "").strip()

        if not phone or not code or not session_id:
            raise HTTPException(status_code=400, detail="Phone, code and session_id required")

        # Normalize phone
        phone = phone.replace(" ", "").replace("-", "")
        if not phone.startswith("+"):
            phone = "+" + phone

        # Get user
        user = Database.get_user(phone)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Check code
        if not user.pending_code:
            raise HTTPException(status_code=400, detail="No pending code")

        if user.pending_code != code:
            raise HTTPException(status_code=400, detail="Invalid code")

        if user.pending_code_expires and user.pending_code_expires < datetime.now():
            raise HTTPException(status_code=400, detail="Code expired")

        if user.pending_session_id != session_id:
            raise HTTPException(status_code=400, detail="Code not for this session")

        # Success! Clear code and increment counter
        user.pending_code = None
        user.pending_code_expires = None
        user.pending_session_id = None
        user.free_bills_used += 1
        user.last_active = datetime.now()
        Database.save_user(user)

        return {
            "status": "verified",
            "message": "Code verified successfully",
            "free_remaining": FREE_SESSIONS_LIMIT - user.free_bills_used
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/editor/status")
async def get_editor_status(phone: str, session_id: str):
    """
    Check editor status for a session.
    Returns: premium, free (with remaining count), or paywall
    """
    try:
        # Normalize phone
        phone = phone.replace(" ", "").replace("-", "")
        if not phone.startswith("+"):
            phone = "+" + phone

        user = Database.get_user(phone)

        if not user:
            # New user - has free sessions
            return {
                "status": "needs_code",
                "free_remaining": FREE_SESSIONS_LIMIT,
                "is_premium": False
            }

        # Check premium
        if user.is_premium:
            if user.premium_until and user.premium_until > datetime.now():
                return {
                    "status": "premium",
                    "is_premium": True
                }

        # Check free sessions
        if user.free_bills_used >= FREE_SESSIONS_LIMIT:
            return {
                "status": "paywall",
                "free_remaining": 0,
                "is_premium": False
            }

        return {
            "status": "needs_code",
            "free_remaining": FREE_SESSIONS_LIMIT - user.free_bills_used,
            "is_premium": False
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)