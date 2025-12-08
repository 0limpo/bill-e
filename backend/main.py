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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)