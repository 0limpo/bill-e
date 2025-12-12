from fastapi import FastAPI, Request, Query, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import uuid
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

# Importar OCR service (nuevo: solo Gemini)
try:
    from ocr_gemini import ocr_service
except ImportError as e:
    print(f"Warning: OCR service not available: {e}")
    ocr_service = None

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
            expires_at=(datetime.now() + timedelta(hours=1)).isoformat()
        )
        
        # Guardar en Redis (expira en 1 hora)
        if redis_client:
            redis_client.setex(
                f"session:{session_id}",
                3600,  # 1 hora en segundos
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

        # Procesar con Gemini OCR
        try:
            ocr_result = ocr_service.process_receipt(image_bytes)

            if not ocr_result.get('success'):
                raise HTTPException(status_code=400, detail=ocr_result.get('error', 'Error en OCR'))

            # Actualizar sesión con resultado
            if redis_client and session_data:
                session = json.loads(session_data.decode('utf-8'))
                session['total'] = ocr_result.get('total', 0)
                session['subtotal'] = ocr_result.get('subtotal', 0)
                session['tip'] = ocr_result.get('tip', 0)

                # Convertir items al formato de sesión
                session_items = []
                for i, item in enumerate(ocr_result.get('items', [])):
                    quantity = item.get('quantity', 1)
                    price = item['price']
                    session_items.append({
                        'id': f"item-{i}",
                        'name': item['name'],
                        'price': price,
                        'quantity': quantity,
                        'assigned_to': [],
                        'group_total': price * quantity
                    })

                session['items'] = session_items

                # Guardar sesión actualizada
                redis_client.setex(
                    f"session:{session_id}",
                    3600,
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

        # Procesar con Gemini OCR
        try:
            ocr_result = ocr_service.process_receipt(image_bytes)

            if not ocr_result.get('success'):
                raise HTTPException(status_code=400, detail=ocr_result.get('error', 'Error en OCR'))

            # Actualizar sesión con resultado
            if redis_client and session_data:
                session = json.loads(session_data.decode('utf-8'))
                session['total'] = ocr_result.get('total', 0)
                session['subtotal'] = ocr_result.get('subtotal', 0)
                session['tip'] = ocr_result.get('tip', 0)

                # Convertir items al formato de sesión
                session_items = []
                for i, item in enumerate(ocr_result.get('items', [])):
                    quantity = item.get('quantity', 1)
                    price = item['price']
                    session_items.append({
                        'id': f"item-{i}",
                        'name': item['name'],
                        'price': price,
                        'quantity': quantity,
                        'assigned_to': [],
                        'group_total': price * quantity
                    })

                session['items'] = session_items

                # Guardar sesión actualizada
                redis_client.setex(
                    f"session:{session_id}",
                    3600,
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
            
            # Actualizar sesión
            redis_client.setex(
                f"session:{session_id}",
                3600,  # Renovar por 1 hora más
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
            raw_text=data.get("raw_text", "")
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}/collaborative")
async def get_collaborative_session(session_id: str, owner: str = None):
    try:
        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada o expirada")

        is_owner = owner and verify_owner(session_data, owner)

        response = {
            "session_id": session_id,
            "status": session_data["status"],
            "items": session_data["items"],
            "participants": session_data["participants"],
            "assignments": session_data["assignments"],
            "tip_percentage": session_data.get("tip_percentage", 10),
            "tip_mode": session_data.get("tip_mode", "percent"),  # "percent" or "fixed"
            "tip_value": session_data.get("tip_value", 10.0),  # Default 10%
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
        data = await request.json()
        name = data.get("name", "").strip()
        phone = data.get("phone", "").strip() or "N/A"  # Phone is now optional

        if not name:
            raise HTTPException(status_code=400, detail="El nombre es requerido")
        # Phone validation removed - now optional

        result = add_participant(redis_client, session_id, name, phone)

        if "error" in result:
            raise HTTPException(status_code=result.get("code", 400), detail=result["error"])

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
            "totals": session_data.get("totals"),  # Include totals for finalized state
            "tip_mode": session_data.get("tip_mode", "percent"),
            "tip_value": session_data.get("tip_value", 10.0),
            "tip_percentage": session_data.get("tip_percentage", 10),
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
    """Owner actualiza un item (nombre, precio, cantidad)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        item_id = data.get("item_id")
        updates = data.get("updates", {})

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        # Actualizar el item
        for item in session_data["items"]:
            if (item.get("id") or item.get("name")) == item_id:
                if "name" in updates:
                    item["name"] = updates["name"]
                if "price" in updates:
                    item["price"] = updates["price"]
                if "quantity" in updates:
                    item["quantity"] = updates["quantity"]
                if "mode" in updates:
                    item["mode"] = updates["mode"]  # "individual" or "group"
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)