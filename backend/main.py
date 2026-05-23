from fastapi import FastAPI, Request, Query, HTTPException, UploadFile, File, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import json
import time
import uuid
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Importar servicios existentes
try:
    from database import Database, redis_client
    from models import SessionData
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

# Importar Turnstile (proteccion anti-bot, opcional segun TURNSTILE_SECRET)
try:
    import turnstile_service
    turnstile_available = True
except ImportError as e:
    print(f"Warning: Turnstile not available: {e}")
    turnstile_service = None
    turnstile_available = False

# Importar Analytics
try:
    from analytics_routes import router as analytics_router
    from analytics_middleware import AnalyticsMiddleware
    from analytics import analytics as analytics_tracker
    from alerting import init_alerting
    analytics_available = True
except ImportError as e:
    print(f"Warning: Analytics not available: {e}")
    analytics_available = False
    analytics_tracker = None

# Importar Collaborative Sessions
try:
    from collaborative_session import (
        create_collaborative_session,
        get_session as get_collab_session,
        verify_owner,
        verify_owner_device,
        add_participant,
        attach_user_id_to_participant,
        update_assignment,
        finalize_session,
        calculate_totals,
        get_participant_summary,
        set_premium_by_email,
        check_premium_by_email,
        get_premium_by_email,
        clear_premium_by_email as redis_clear_premium_by_email,
        SessionStatus
    )
    collaborative_available = True
except ImportError as e:
    print(f"Warning: Collaborative sessions not available: {e}")
    collaborative_available = False

# Importar Payment Integration (Flow.cl)
try:
    from flow_payment import (
        create_payment as flow_create_payment,
        get_payment_status as flow_get_payment_status,
        build_payment_url,
        get_premium_price,
        FlowPaymentStatus
    )
    payment_available = True
except ImportError as e:
    print(f"Warning: Payment integration not available: {e}")
    payment_available = False

# Importar SimpleAPI para boletas
try:
    from simpleapi_boleta import emit_boleta_async
    boleta_available = True
except ImportError as e:
    print(f"Warning: Boleta integration not available: {e}")
    boleta_available = False

# Importar Polar.sh (international payments via Merchant of Record)
try:
    import polar_service
    polar_available = True
except ImportError as e:
    print(f"Warning: Polar integration not available: {e}")
    polar_available = False

# Importar MercadoPago Integration
try:
    from mercadopago_payment import (
        create_preference as mp_create_preference,
        process_card_payment as mp_process_card_payment,
        get_payment as mp_get_payment,
        get_public_key as mp_get_public_key,
        get_premium_price as mp_get_premium_price,
        verify_webhook_signature as mp_verify_signature,
        MPPaymentStatus
    )
    mercadopago_available = True
except ImportError as e:
    print(f"Warning: MercadoPago integration not available: {e}")
    mercadopago_available = False

# Importar PostgreSQL Database
try:
    import postgres_db
    postgres_available = True
except ImportError as e:
    print(f"Warning: PostgreSQL not available: {e}")
    postgres_available = False

# Importar utilidades de imagen e IP (para captura de boletas fallidas)
try:
    from image_utils import detect_image_mime
    from ip_utils import extract_client_ip, hash_ip
    capture_utils_available = True
except ImportError as e:
    print(f"Warning: capture utils not available: {e}")
    detect_image_mime = None
    extract_client_ip = None
    hash_ip = None
    capture_utils_available = False

# Importar OAuth Authentication
try:
    import auth as oauth_auth
    auth_available = True
except ImportError as e:
    print(f"Warning: OAuth authentication not available: {e}")
    auth_available = False

load_dotenv()

# Limite hard de tamaño de upload (proteccion contra DoS de memoria —
# PIL decodea la imagen entera antes de comprimir). El backend resizea
# a 2048px en gemini_service, asi que el costo Gemini esta acotado
# independiente de los bytes de entrada. 20MB cubre HDR phone photos
# y deja un colchon para casos raros sin abrir DoS de memoria.
MAX_OCR_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

# Rate limiting (slowapi). Cada call OCR cuesta dinero a Gemini, por lo que
# limitamos por IP. Limites generosos para usuarios reales (split de cuenta
# tipico = 1-2 OCRs por sesion) pero cortan scripts abusivos.
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address

    def _client_ip_for_rate_limit(request: Request) -> str:
        """Extrae IP real detras del proxy de Render/Cloudflare."""
        fwd = request.headers.get("x-forwarded-for") or request.headers.get("cf-connecting-ip")
        if fwd:
            return fwd.split(",")[0].strip()
        return get_remote_address(request)

    limiter = Limiter(key_func=_client_ip_for_rate_limit)
    rate_limit_available = True
except ImportError as e:
    print(f"Warning: slowapi not available, rate limiting disabled: {e}")
    limiter = None
    rate_limit_available = False

app = FastAPI(title="Bill-e API", version="1.0.0")

if rate_limit_available and limiter:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    # 3/min cubre uso real (split de cuenta tipico = 1-2 OCRs).
    # 15/hora limita un atacante single-IP a ~$0.18/dia max.
    ocr_rate_limit = limiter.limit("3/minute;15/hour")
else:
    def ocr_rate_limit(func):
        return func


async def _enforce_turnstile(request: Request, body_token: Optional[str] = None) -> None:
    """Valida Turnstile si esta configurado. Tira 403 si falla.

    No-op cuando TURNSTILE_SECRET no esta seteado (dev/staging).
    """
    if not (turnstile_available and turnstile_service and turnstile_service.is_configured()):
        return
    token = request.headers.get("cf-turnstile-token") or body_token
    client_ip = (
        _client_ip_for_rate_limit(request) if rate_limit_available else None
    )
    if not await turnstile_service.verify_token(token, client_ip):
        raise HTTPException(status_code=403, detail="Verificacion anti-bot fallida")

# Add Analytics Middleware FIRST (before CORS)
if analytics_available:
    app.add_middleware(AnalyticsMiddleware)

# CORS para el frontend
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://billeocr.com,https://www.billeocr.com,https://bill-e.vercel.app,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================ ADMIN AUTHENTICATION ================

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def verify_admin_token(x_admin_token: Optional[str] = Header(None)) -> None:
    """FastAPI dependency: valida el header X-Admin-Token contra ADMIN_TOKEN env."""
    if not ADMIN_TOKEN:
        # Si la env var no está seteada en el server, rechazar todo
        raise HTTPException(status_code=503, detail="Admin endpoints not configured")
    if not x_admin_token or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")


# Modelos para OCR
class OCRRequest(BaseModel):
    image: str  # Base64 encoded image
    turnstile_token: Optional[str] = None  # Cloudflare Turnstile token (opcional, header preferido)

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

# ================ ENDPOINTS DE SESIÓN ================

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
        redis_client.setex(f"result:{session_id}", 3600, json.dumps(result))
    
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
@ocr_rate_limit
async def process_receipt_ocr(session_id: str, request: Request, ocr_req: OCRRequest):
    """Procesar imagen de boleta con Gemini OCR"""
    try:
        # Verificar que la sesión existe
        if redis_client:
            session_data = redis_client.get(f"session:{session_id}")
            if not session_data:
                raise HTTPException(status_code=404, detail="Sesión no encontrada")

        await _enforce_turnstile(request, ocr_req.turnstile_token)

        # Decodificar imagen base64
        import base64
        if ',' in ocr_req.image:
            image_b64 = ocr_req.image.split(',')[1]
        else:
            image_b64 = ocr_req.image

        image_bytes = base64.b64decode(image_b64)

        if len(image_bytes) > MAX_OCR_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"La imagen excede el limite de {MAX_OCR_IMAGE_BYTES // (1024*1024)}MB. "
                       f"Comprimila o reducila antes de subirla."
            )

        # Procesar con OCR (Vision + Gemini paralelo)
        _ocr_start = time.time()
        _ocr_succeeded = False
        _ocr_error_msg: Optional[str] = None
        ocr_result: Dict[str, Any] = {}
        try:
            ocr_result = process_image(image_bytes)

            if not ocr_result.get('success'):
                _ocr_error_msg = ocr_result.get('error', 'Error en OCR')
                raise HTTPException(status_code=400, detail=_ocr_error_msg)

            _ocr_succeeded = True

            # Actualizar sesión con resultado
            if redis_client and session_data:
                session = json.loads(session_data)
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
                        'original_indices': item.get('original_indices', []),
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
            _ocr_error_msg = str(ocr_error)
            print(f"OCR Error: {_ocr_error_msg}")
            raise HTTPException(status_code=400, detail=f"Error en OCR: {_ocr_error_msg}")
        finally:
            if analytics_available and analytics_tracker:
                try:
                    analytics_tracker.track_ocr_usage(
                        session_id=session_id,
                        success=_ocr_succeeded,
                        processing_time_ms=(time.time() - _ocr_start) * 1000,
                        item_count=len(ocr_result.get('items', [])) if _ocr_succeeded else 0,
                        image_size_bytes=len(image_bytes),
                        error=_ocr_error_msg,
                    )
                except Exception as track_err:
                    print(f"Failed to track OCR usage: {track_err}")
            # Captura de boletas fallidas o needs_review para mejorar OCR
            try:
                should_capture = (
                    not _ocr_succeeded
                    or bool(ocr_result.get("needs_review"))
                )
                if should_capture and capture_utils_available and postgres_available:
                    postgres_db.persist_failed_capture(
                        image_bytes=image_bytes,
                        image_mime=detect_image_mime(image_bytes),
                        reason="hard_fail" if not _ocr_succeeded else "needs_review",
                        error_msg=_ocr_error_msg,
                        gemini_raw=ocr_result if _ocr_succeeded else None,
                        session_id=session_id,
                        endpoint="ocr",
                        ip_hash=hash_ip(extract_client_ip(request)),
                    )
            except Exception as cap_err:
                print(f"persist_failed_capture (ocr) failed: {cap_err}")

    except HTTPException:
        raise
    except Exception as e:
        print(f"OCR processing error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/session/{session_id}/upload")
@ocr_rate_limit
async def upload_receipt_image(session_id: str, request: Request, file: UploadFile = File(...)):
    """Upload y procesa imagen con Gemini OCR."""
    try:
        await _enforce_turnstile(request)

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

        if len(image_bytes) > MAX_OCR_IMAGE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"La imagen excede el limite de {MAX_OCR_IMAGE_BYTES // (1024*1024)}MB. "
                       f"Comprimila o reducila antes de subirla."
            )

        # Procesar con OCR (Vision + Gemini paralelo)
        _ocr_start = time.time()
        _ocr_succeeded = False
        _ocr_error_msg: Optional[str] = None
        ocr_result: Dict[str, Any] = {}
        try:
            ocr_result = process_image(image_bytes)

            if not ocr_result.get('success'):
                _ocr_error_msg = ocr_result.get('error', 'Error en OCR')
                raise HTTPException(status_code=400, detail=_ocr_error_msg)

            _ocr_succeeded = True

            # Actualizar sesión con resultado
            if redis_client and session_data:
                session = json.loads(session_data)
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
                        'original_indices': item.get('original_indices', []),
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
            _ocr_error_msg = str(ocr_error)
            print(f"OCR Error: {_ocr_error_msg}")
            raise HTTPException(status_code=400, detail=f"Error en OCR: {_ocr_error_msg}")
        finally:
            if analytics_available and analytics_tracker:
                try:
                    analytics_tracker.track_ocr_usage(
                        session_id=session_id,
                        success=_ocr_succeeded,
                        processing_time_ms=(time.time() - _ocr_start) * 1000,
                        item_count=len(ocr_result.get('items', [])) if _ocr_succeeded else 0,
                        image_size_bytes=len(image_bytes),
                        error=_ocr_error_msg,
                    )
                except Exception as track_err:
                    print(f"Failed to track OCR usage: {track_err}")
            # Captura de boletas fallidas o needs_review para mejorar OCR
            try:
                should_capture = (
                    not _ocr_succeeded
                    or bool(ocr_result.get("needs_review"))
                )
                if should_capture and capture_utils_available and postgres_available:
                    postgres_db.persist_failed_capture(
                        image_bytes=image_bytes,
                        image_mime=detect_image_mime(image_bytes),
                        reason="hard_fail" if not _ocr_succeeded else "needs_review",
                        error_msg=_ocr_error_msg,
                        gemini_raw=ocr_result if _ocr_succeeded else None,
                        session_id=session_id,
                        endpoint="upload",
                        ip_hash=hash_ip(extract_client_ip(request)),
                    )
            except Exception as cap_err:
                print(f"persist_failed_capture (upload) failed: {cap_err}")

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

# ================ STARTUP EVENT ================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    if analytics_available:
        init_alerting()
        print("✅ Analytics and alerting initialized")

    # Initialize PostgreSQL
    if postgres_available:
        if postgres_db.init_db():
            print("✅ PostgreSQL database initialized")
        else:
            print("⚠️ PostgreSQL not configured (payments will only use Redis)")

# ============================================
# ENDPOINTS COLABORATIVOS
# ============================================

@app.post("/api/session/collaborative")
async def create_collaborative_session_endpoint(request: Request):
    try:
        data = await request.json()
        device_id = data.get("device_id", "")
        auth_token = data.get("auth_token")

        # Resolve user_id from auth_token. Setting it at session creation
        # means the snapshot carries the user from the very first sync,
        # so the bill is reachable cross-device immediately.
        user_id = ""
        if auth_token and auth_available:
            try:
                payload = oauth_auth.verify_session_token(auth_token)
                if payload:
                    user_id = payload.get("user_id") or payload.get("sub") or ""
            except Exception:
                user_id = ""

        # If we resolved a user_id and have a device_id, link them — the
        # user is creating bills from this device while logged in, so the
        # device should belong to them going forward.
        if postgres_available and user_id and device_id:
            try:
                postgres_db.link_device_to_user(user_id, device_id)
            except Exception:
                pass

        result = create_collaborative_session(
            redis_client=redis_client,
            owner_phone=data.get("owner_phone", ""),
            items=data.get("items", []),
            total=data.get("total", 0),
            subtotal=data.get("subtotal", 0),
            tip=data.get("tip", 0),
            raw_text=data.get("raw_text", ""),
            charges=data.get("charges", []),
            decimal_places=data.get("decimal_places", 0),
            device_id=device_id,
            merchant_name=data.get("merchant_name", ""),
            user_id=user_id,
            items_include_charges=data.get("items_include_charges", False),
        )

        # Track user in PostgreSQL (host creating session)
        if postgres_available and device_id:
            user_agent = request.headers.get("user-agent", "")
            accept_lang = request.headers.get("accept-language", "")
            language = accept_lang.split(",")[0].split("-")[0] if accept_lang else None

            postgres_db.track_user(
                device_id=device_id,
                role="host",
                session_id=result.get("session_id"),
                user_agent=user_agent,
                language=language
            )

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/session/{session_id}/collaborative")
async def get_collaborative_session(
    session_id: str,
    owner: str = None,
    device_id: str = None,
    token: str = None,
):
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

        # JWT-based ownership: lets a logged-in user open their own bill from
        # a device that doesn't hold the original session owner_token (cross-
        # device /my bills view inside Redis TTL window). Mirrors the 3-way
        # check in get_session_snapshot_by_id so both paths agree.
        if not is_owner and token and auth_available:
            try:
                payload = oauth_auth.verify_session_token(token)
            except Exception:
                payload = None
            if payload:
                uid = payload.get("sub") or payload.get("user_id")
                owner_device_id = session_data.get("owner_device_id")
                if uid and session_data.get("user_id") == uid:
                    is_owner = True
                elif uid and owner_device_id and postgres_available:
                    try:
                        with postgres_db.get_db() as db:
                            if db is not None:
                                user_row = (
                                    db.query(postgres_db.User)
                                    .filter(postgres_db.User.id == uuid.UUID(uid))
                                    .first()
                                )
                                if user_row and user_row.device_ids and owner_device_id in user_row.device_ids:
                                    is_owner = True
                    except Exception:
                        pass

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
            "items_include_charges": session_data.get("items_include_charges", False),  # IVA/tax incluido en items
            "bill_cost_shared": session_data.get("bill_cost_shared", False),  # Whether to share Bill-e cost
            "bill_name": session_data.get("bill_name", ""),
            "merchant_name": session_data.get("merchant_name", ""),
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

            # Free-tier status is no longer surfaced via the session
            # payload — clients fetch it from /enter-share on p3 entry.

            if session_data["status"] == SessionStatus.FINALIZED.value:
                response["totals"] = session_data.get("totals", [])

        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/bill-name")
async def update_bill_name(session_id: str, request: Request):
    """Update the bill name for a session (owner only)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        bill_name = data.get("bill_name", "").strip()

        session_data = get_collab_session(redis_client, session_id)
        if not session_data:
            raise HTTPException(status_code=404, detail="Session not found")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="Not authorized")

        session_data["bill_name"] = bill_name
        session_data["last_updated"] = datetime.now().isoformat()

        # Save back to Redis (preserve TTL)
        existing_ttl = redis_client.ttl(f"session:{session_id}")
        redis_client.setex(
            f"session:{session_id}",
            existing_ttl if existing_ttl > 0 else 3600,
            json.dumps(session_data)
        )

        return {"success": True, "bill_name": bill_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/bills/history")
async def get_bill_history_endpoint(device_id: str = None, user_id: str = None, limit: int = 50):
    """Get bill history for a user by device_id or user_id."""
    try:
        if not postgres_available:
            return {"bills": [], "count": 0}

        # Collect all device_ids for this user
        device_ids = []
        resolved_user_id = user_id

        if device_id:
            device_ids.append(device_id)
            # Also look up user to get all their device_ids
            if not resolved_user_id:
                resolved_user_id = postgres_db.get_user_id_for_device(device_id)

        if resolved_user_id:
            # Get all device_ids for this user
            with postgres_db.get_db() as db:
                if db:
                    user = db.query(postgres_db.User).filter(
                        postgres_db.User.id == (uuid.UUID(resolved_user_id) if isinstance(resolved_user_id, str) else resolved_user_id)
                    ).first()
                    if user and user.device_ids:
                        for did in user.device_ids:
                            if did not in device_ids:
                                device_ids.append(did)

        bills = postgres_db.get_bill_history(
            device_ids=device_ids if device_ids else None,
            user_id=resolved_user_id,
            limit=limit
        )

        return {"bills": bills or [], "count": len(bills or [])}
    except Exception as e:
        print(f"Error getting bill history: {e}")
        return {"bills": [], "count": 0}


class TogglePaidRequest(BaseModel):
    token: Optional[str] = None
    device_id: Optional[str] = None


@app.post("/api/session/{session_id}/participant/{participant_id}/toggle-paid")
async def toggle_participant_paid(
    session_id: str,
    participant_id: str,
    req: TogglePaidRequest,
):
    """Toggle paid_at on a participant. Only the original host may call this."""
    if not postgres_available:
        raise HTTPException(status_code=503, detail="Database not available")

    user_id: Optional[str] = None
    if req.token and auth_available:
        try:
            payload = oauth_auth.verify_session_token(req.token)
            if payload:
                user_id = payload.get("sub") or payload.get("user_id")
        except Exception:
            user_id = None

    snapshot = postgres_db.get_session_snapshot_by_id(
        session_id,
        user_id=user_id,
        device_id=req.device_id,
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if not snapshot.get("is_owner"):
        raise HTTPException(status_code=403, detail="Only the host can mark participants as paid")

    result = postgres_db.toggle_participant_paid(session_id, participant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Participant not found")
    return result


@app.get("/api/session/{session_id}/snapshot")
async def get_session_snapshot(
    session_id: str,
    token: Optional[str] = None,
    device_id: Optional[str] = None,
):
    """Get a read-only snapshot of a finalized session from PostgreSQL.

    Optional ?token= and ?device_id= let the caller identify themselves so
    the response can flag is_owner=True when they're the original host.
    """
    if not postgres_available:
        raise HTTPException(status_code=404, detail="No snapshot available")

    user_id: Optional[str] = None
    if token and auth_available:
        try:
            payload = oauth_auth.verify_session_token(token)
            if payload:
                user_id = payload.get("sub") or payload.get("user_id")
        except Exception:
            user_id = None

    snapshot = postgres_db.get_session_snapshot_by_id(
        session_id,
        user_id=user_id,
        device_id=device_id,
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot


@app.post("/api/session/{session_id}/join")
async def join_session(session_id: str, request: Request):
    """Add a new editor participant to a collaborative session.

    Free-tier preflight: if this identity (user_id|device_id) is already
    at the cap and this is a *new* session for them, return 402 so the
    editor sees the paywall before they invest time on assignments. The
    counter only increments at p3 entry — this is just a gate.
    """
    try:
        import free_tier

        data = await request.json()
        name = data.get("name", "").strip()
        phone = data.get("phone", "").strip() or "N/A"
        device_id = (data.get("device_id") or "").strip() or None
        google_email = (data.get("google_email") or "").strip() or None

        if not name:
            raise HTTPException(status_code=400, detail="El nombre es requerido")

        # Resolve user_id from google_email so editor history can find this bill later.
        editor_user_id = None
        if google_email and postgres_available:
            try:
                user = postgres_db.get_user_by_email(google_email)
                if user and user.get("id"):
                    editor_user_id = str(user["id"])
            except Exception as e:
                print(f"Could not resolve user_id from email: {e}")

        # Preflight paywall check (editor flow).
        can_join = free_tier.check_can_join(
            redis_client,
            session_id=session_id,
            user_id=editor_user_id,
            device_id=device_id,
        )
        if not can_join.get("allowed"):
            return JSONResponse(status_code=402, content=can_join)

        result = add_participant(
            redis_client, session_id, name, phone,
            user_id=editor_user_id, device_id=device_id,
        )

        if "error" in result:
            raise HTTPException(status_code=result.get("code", 400), detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/select-participant")
async def select_existing_participant(session_id: str, request: Request):
    """Select an existing participant (editor flow).

    Same free-tier preflight as /join — block at selection so the editor
    sees the paywall before doing any assignment work.
    """
    try:
        import free_tier

        data = await request.json()
        participant_id = data.get("participant_id", "").strip()
        device_id = (data.get("device_id") or "").strip() or None
        google_email = (data.get("google_email") or "").strip() or None

        if not participant_id:
            raise HTTPException(status_code=400, detail="participant_id es requerido")

        # Resolve user_id from google_email for both the paywall check
        # and the user_id backfill below.
        editor_user_id = None
        if google_email and postgres_available:
            try:
                user = postgres_db.get_user_by_email(google_email)
                if user and user.get("id"):
                    editor_user_id = str(user["id"])
            except Exception as e:
                print(f"Could not resolve user_id from email: {e}")

        # Preflight paywall check.
        can_join = free_tier.check_can_join(
            redis_client,
            session_id=session_id,
            user_id=editor_user_id,
            device_id=device_id,
        )
        if not can_join.get("allowed"):
            return JSONResponse(status_code=402, content=can_join)

        # Backfill user_id and device_id on the selected participant so
        # finalize_session can charge them later even if they close the
        # tab before reaching their own p3.
        if editor_user_id or device_id:
            try:
                attach_user_id_to_participant(
                    redis_client, session_id, participant_id,
                    editor_user_id, device_id=device_id,
                )
            except Exception as e:
                print(f"Could not attach identity to participant: {e}")

        return {"status": "ok"}
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
        owner_email = data.get("owner_email")  # Optional - for email-based premium
        auth_token = data.get("auth_token")    # Optional - JWT of logged-in user

        if not owner_token:
            raise HTTPException(status_code=400, detail="Token de owner requerido")

        result = finalize_session(redis_client, session_id, owner_token, owner_email)

        if "error" in result:
            raise HTTPException(status_code=result.get("code", 400), detail=result["error"])

        # Sync to PostgreSQL immediately so it appears in bill history
        if postgres_available:
            try:
                session_data = get_collab_session(redis_client, session_id)
                if session_data:
                    session_data["session_id"] = session_id

                    # Resolve user_id, in priority order:
                    # 1) Authenticated JWT on this request (most reliable —
                    #    proves the user was actually logged in at finalize).
                    # 2) user_id already on the session (set at creation).
                    # 3) Fallback: lookup by owner_device_id in user.device_ids.
                    auth_user_id = None
                    if auth_token and auth_available:
                        try:
                            payload = oauth_auth.verify_session_token(auth_token)
                            if payload:
                                auth_user_id = payload.get("user_id") or payload.get("sub")
                        except Exception:
                            auth_user_id = None

                    if auth_user_id:
                        session_data["user_id"] = auth_user_id

                        # Side-effect: link this device to the user. If their
                        # device_id rotated (PWA reinstall, storage cleared)
                        # we'd otherwise keep treating it as anonymous.
                        owner_device_id = session_data.get("owner_device_id")
                        if owner_device_id:
                            try:
                                postgres_db.link_device_to_user(auth_user_id, owner_device_id)
                            except Exception:
                                pass
                    elif not session_data.get("user_id"):
                        owner_device_id = session_data.get("owner_device_id")
                        if owner_device_id:
                            found_user_id = postgres_db.get_user_id_for_device(owner_device_id)
                            if found_user_id:
                                session_data["user_id"] = found_user_id

                    ttl = redis_client.ttl(f"session:{session_id}")
                    postgres_db.upsert_session_snapshot(session_data, redis_ttl=ttl)
            except Exception as sync_err:
                print(f"Warning: Failed to sync finalized session to PostgreSQL: {sync_err}")

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


@app.post("/api/session/{session_id}/enter-share")
async def enter_share_endpoint(session_id: str, request: Request):
    """Mark that the caller (host or editor) has reached step 3 of this
    session. Idempotently increments their free-tier counter the first
    time. Returns the resulting status so the UI can show "N free bills
    left" or trigger the paywall.

    Identity resolution: user_id (or google_email→user_id) wins over
    device_id. Returns 402 when a non-premium identity has hit the cap.
    """
    import free_tier

    data = await request.json()
    device_id = (data.get("device_id") or "").strip() or None
    user_id = (data.get("user_id") or "").strip() or None
    google_email = (data.get("google_email") or "").strip() or None

    # Resolve user_id from google_email if not provided directly.
    if not user_id and google_email and postgres_available:
        try:
            user = postgres_db.get_user_by_email(google_email)
            if user and user.get("id"):
                user_id = str(user["id"])
        except Exception as e:
            print(f"enter-share: could not resolve user_id from email: {e}")

    # Sanity-check the session exists; refuse silently for unknown ids.
    session_data = get_collab_session(redis_client, session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Sesion no encontrada")

    result = free_tier.record_session_use(
        redis_client,
        session_id=session_id,
        user_id=user_id,
        device_id=device_id,
    )

    if not result.get("allowed"):
        # 402 Payment Required — frontend uses this to flip the paywall.
        return JSONResponse(status_code=402, content=result)

    return result


class UpdateTipRequest(BaseModel):
    total_paid_usd: float = Field(ge=1.0)


@app.get("/api/session/{session_id}/tip")
async def get_session_tip(session_id: str):
    """Return the tip (if any) for this session. Used by frontend to render
    the 'Bill-e $X' line in editors' bills when split is on."""
    if not postgres_available:
        return {"tip": None}
    try:
        with postgres_db.get_db() as db:
            if db is None:
                return {"tip": None}
            tip = postgres_db.get_tip_for_session(db, session_id)
            return {"tip": tip}
    except Exception as e:
        print(f"GET tip failed: {e}")
        return {"tip": None}


@app.patch("/api/session/{session_id}/tip")
async def patch_session_tip(session_id: str, req: UpdateTipRequest):
    """Manual override for the actual paid amount. Used when the webhook
    didn't arrive or the host wants to round. Updates the most recent tip."""
    if not postgres_available:
        raise HTTPException(status_code=503, detail="Postgres not available")
    try:
        with postgres_db.get_db() as db:
            if db is None:
                raise HTTPException(status_code=503, detail="DB session unavailable")
            ok = postgres_db.update_tip_total_paid(db, session_id, req.total_paid_usd)
            if not ok:
                raise HTTPException(status_code=404, detail="No tip exists for this session")
            return {"ok": True, "total_paid_usd": req.total_paid_usd}
    except HTTPException:
        raise
    except Exception as e:
        print(f"PATCH tip failed: {e}")
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
            "last_updated_by": session_data.get("last_updated_by", ""),
            "bill_cost_shared": session_data.get("bill_cost_shared", False),
            "bill_name": session_data.get("bill_name", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/bill-cost-shared")
async def update_bill_cost_shared(session_id: str, request: Request):
    """Update whether to share Bill-e cost among participants (owner only)."""
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        bill_cost_shared = data.get("bill_cost_shared", False)

        if not owner_token:
            raise HTTPException(status_code=400, detail="Token de owner requerido")

        session_data = get_collab_session(redis_client, session_id)

        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")

        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        session_data["bill_cost_shared"] = bill_cost_shared
        session_data["last_updated"] = datetime.now().isoformat()

        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"success": True, "bill_cost_shared": bill_cost_shared}

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
        price_mode = session_data.get("price_mode") or "unitario"
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
                    # Allow explicit price_as_shown updates (frontend can
                    # send the literal value the user typed). Otherwise,
                    # if price/quantity changed, recompute it so the
                    # display stays consistent with what the receipt would
                    # print for the new state.
                    if "price_as_shown" in updates:
                        item["price_as_shown"] = updates["price_as_shown"]
                    elif "price" in updates or "quantity" in updates:
                        try:
                            qty_now = int(item.get("quantity", 1) or 1)
                            price_now = float(item.get("price") or 0)
                            item["price_as_shown"] = (
                                price_now * qty_now
                                if price_mode == "total_linea" and qty_now > 1
                                else price_now
                            )
                        except (TypeError, ValueError):
                            pass
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


@app.post("/api/session/{session_id}/items/regroup")
async def regroup_items_endpoint(session_id: str, request: Request):
    """Switch the items list between grouped and expanded view.

    mode="group":  merge consecutive items by (name, price), summing qty.
    mode="expand": split each item with qty>1 into qty items with qty=1.

    Clears assignments because item IDs change. Owner-only.
    """
    try:
        data = await request.json()
        owner_token = data.get("owner_token")
        mode = data.get("mode")

        if mode not in ("group", "expand"):
            raise HTTPException(status_code=400, detail="mode must be 'group' or 'expand'")

        session_data = get_collab_session(redis_client, session_id)
        if not session_data:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")
        if not verify_owner(session_data, owner_token):
            raise HTTPException(status_code=403, detail="No autorizado")

        items = session_data.get("items", []) or []

        # Keep `price_as_shown` consistent with what the receipt would
        # have printed for the line. With qty=1 it always equals the unit
        # price; with qty>1 it depends on whether the receipt printed unit
        # prices ("unitario") or line totals ("total_linea").
        price_mode = session_data.get("price_mode") or "unitario"

        def shown_for(price: float, qty: int) -> float:
            return float(price) * int(qty) if price_mode == "total_linea" and int(qty) > 1 else float(price)

        if mode == "expand":
            # Build one entry per UNIT, paired with its original receipt
            # position (from original_indices). Then sort by position so
            # the expanded list matches the receipt's line order. Units
            # without a known position (manually added items) go to the
            # end via float('inf'), with stable sort preserving their
            # relative order.
            unit_entries = []  # (orig_idx, item, unit_offset, base_id, unit_price)
            for item in items:
                qty = int(item.get("quantity", 1) or 1)
                base_id = item.get("id") or item.get("name") or "item"
                unit = float(item.get("price") or 0)
                indices = item.get("original_indices") or []
                for i in range(qty):
                    idx = indices[i] if i < len(indices) else float("inf")
                    unit_entries.append((idx, item, i, base_id, unit))

            unit_entries.sort(key=lambda e: e[0])

            new_items = []
            for idx, item, i, base_id, unit in unit_entries:
                # Preserve the original ID for the FIRST unit of each
                # item so a clean ON→OFF→ON round-trip keeps canonical
                # IDs. Additional units get derived IDs.
                new_id = base_id if i == 0 else f"{base_id}_e{i}_{uuid.uuid4().hex[:6]}"
                # Each unit carries its own original_indices=[idx] so
                # subsequent group→expand cycles keep working.
                unit_indices = [idx] if idx != float("inf") else []
                new_items.append({
                    **item,
                    "id": new_id,
                    "quantity": 1,
                    "price_as_shown": unit,
                    "original_indices": unit_indices,
                })
        else:  # group
            groups = {}
            order = []
            for item in items:
                # Group by case-insensitive name + numeric price
                name = (item.get("name") or "").strip().lower()
                try:
                    price = float(item.get("price") or 0)
                except (TypeError, ValueError):
                    price = 0.0
                key = (name, price)
                qty = int(item.get("quantity", 1) or 1)
                item_indices = list(item.get("original_indices") or [])
                if key not in groups:
                    # First item in a group keeps its ID — combined with
                    # the expand path's "i==0 keeps base_id", a clean
                    # ON→OFF→ON round-trip leaves the canonical IDs intact.
                    groups[key] = {**item, "quantity": qty}
                    groups[key]["original_indices"] = item_indices
                    order.append(key)
                else:
                    groups[key]["quantity"] = int(groups[key].get("quantity", 1) or 1) + qty
                    groups[key]["original_indices"] = (groups[key].get("original_indices") or []) + item_indices
            new_items = []
            for k in order:
                grouped_item = groups[k]
                gqty = int(grouped_item.get("quantity", 1) or 1)
                gprice = float(grouped_item.get("price") or 0)
                grouped_item["price_as_shown"] = shown_for(gprice, gqty)
                new_items.append(grouped_item)

        # Only clear assignments if some old IDs disappeared — assignments
        # referencing missing IDs would point to nothing. New IDs appearing
        # (e.g. expand adding A_e1, A_e2, ...) is harmless: the original
        # IDs survive and any existing assignments still resolve.
        old_ids = {i.get("id") for i in items}
        new_ids = {i.get("id") for i in new_items}
        session_data["items"] = new_items
        if not old_ids.issubset(new_ids):
            session_data["assignments"] = {}
        session_data["last_updated"] = datetime.now().isoformat()
        session_data["last_updated_by"] = "owner"

        ttl = redis_client.ttl(f"session:{session_id}") if redis_client else 0
        if redis_client and ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))
        elif redis_client:
            redis_client.setex(f"session:{session_id}", 86400, json.dumps(session_data))

        return {"success": True, "items": new_items, "mode": mode}

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
# PAYMENT ENDPOINTS (Flow.cl + SimpleAPI)
# =====================================================

class CreatePaymentRequest(BaseModel):
    user_type: str  # "editor" or "host"
    google_email: str  # Required: user must be logged in with Google before paying
    session_id: Optional[str] = None
    # Legacy fields (kept for backward compatibility but not used)
    device_id: Optional[str] = None
    phone: Optional[str] = None


@app.post("/api/payment/create")
async def create_payment_order(request: CreatePaymentRequest):
    """
    Create a payment order for premium access via Flow/Webpay.
    Requires Google authentication before payment.

    Returns:
        {
            "payment_url": "https://www.flow.cl/app/web/pay.php?token=XXX",
            "commerce_order": "bille_pay_XXXXXXXX",
            "amount": 1990
        }
    """
    if not payment_available:
        raise HTTPException(status_code=503, detail="Payment service unavailable")

    try:
        # Validate request
        if request.user_type not in ["editor", "host"]:
            raise HTTPException(status_code=400, detail="Invalid user_type")

        # Google email is required for premium tracking
        if not request.google_email:
            raise HTTPException(status_code=400, detail="Google authentication required before payment")

        google_email = request.google_email.lower().strip()

        # Generate unique commerce order ID
        commerce_order = f"bille_{uuid.uuid4().hex[:12]}"

        # Build callback URLs
        backend_url = os.getenv("BACKEND_URL", "https://bill-e-backend-lfwp.onrender.com")
        frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")

        url_confirmation = f"{backend_url}/api/payment/webhook"

        # Build return URL - Flow redirects user here after payment
        # Use backend endpoint that handles GET/POST and redirects to frontend
        url_return = f"{backend_url}/api/payment/flow-return"

        # Get configured price
        amount = get_premium_price()

        # Create payment in Flow
        flow_response = flow_create_payment(
            commerce_order=commerce_order,
            subject="Bill-e Premium - 1 año",
            amount=amount,
            url_confirmation=url_confirmation,
            url_return=url_return,
            optional_data={
                "user_type": request.user_type,
                "google_email": google_email,
                "session_id": request.session_id
            }
        )

        # Store payment record in Redis
        payment_record = {
            "commerce_order": commerce_order,
            "flow_order": flow_response.get("flowOrder"),
            "token": flow_response.get("token"),
            "processor": "flow",
            "status": "pending",
            "amount": amount,
            "currency": "CLP",
            "user_type": request.user_type,
            "google_email": google_email,
            "session_id": request.session_id,
            "created_at": datetime.now().isoformat(),
            "paid_at": None,
            "premium_expires": None,
            "boleta_status": None
        }

        # Store with 7-day TTL
        redis_client.setex(
            f"payment:{commerce_order}",
            604800,  # 7 days
            json.dumps(payment_record)
        )

        # Also index by token for webhook lookup
        redis_client.setex(
            f"payment_token:{flow_response.get('token')}",
            604800,
            commerce_order
        )

        # Also store in PostgreSQL for persistence
        if postgres_available:
            postgres_db.create_payment(
                commerce_order=commerce_order,
                processor="flow",
                amount=amount,
                currency="CLP",
                email=google_email,
                user_type=request.user_type,
                country_code="CL",
                session_id=request.session_id
            )

        # Build full payment URL
        payment_url = build_payment_url(flow_response)

        return {
            "success": True,
            "payment_url": payment_url,
            "commerce_order": commerce_order,
            "amount": amount,
            "flow_order": flow_response.get("flowOrder")
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Payment creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/payment/flow-return")
@app.post("/api/payment/flow-return")
async def payment_flow_return(request: Request, token: str = None):
    """
    Flow.cl return URL handler.

    Flow redirects the user here after payment (can be GET or POST).
    We redirect them to the frontend payment success page.
    """
    frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")

    try:
        # Get token from query params (GET) or form data (POST)
        if not token:
            if request.method == "POST":
                form_data = await request.form()
                token = form_data.get("token")
            else:
                token = request.query_params.get("token")

        if not token:
            print("Flow return without token")
            return RedirectResponse(f"{frontend_url}/payment/success?error=no_token", status_code=303)

        # Get commerce_order from token
        commerce_order = None
        if redis_client:
            commerce_order = redis_client.get(f"payment_token:{token}")
            if isinstance(commerce_order, bytes):
                commerce_order = commerce_order.decode('utf-8')

        # Get session_id and user_type from payment record
        session_id = None
        user_type = None
        if commerce_order and redis_client:
            payment_json = redis_client.get(f"payment:{commerce_order}")
            if payment_json:
                payment = json.loads(payment_json)
                session_id = payment.get("session_id")
                user_type = payment.get("user_type")

        # Build redirect URL
        redirect_url = f"{frontend_url}/payment/success"
        params = []
        if commerce_order:
            params.append(f"order={commerce_order}")
        if session_id:
            params.append(f"session={session_id}")
        if user_type:
            params.append(f"type={user_type}")

        if params:
            redirect_url += "?" + "&".join(params)

        print(f"Flow return redirecting to: {redirect_url}")
        return RedirectResponse(redirect_url, status_code=303)

    except Exception as e:
        print(f"Flow return error: {e}")
        return RedirectResponse(f"{frontend_url}/payment/success?error=redirect_failed", status_code=303)


@app.post("/api/payment/webhook")
async def payment_webhook(request: Request):
    """
    Flow.cl webhook callback.

    Flow sends POST with { token: "XXX" }
    We call getStatus to verify and get payment details.
    Then activate premium and emit boleta.
    """
    if not payment_available:
        raise HTTPException(status_code=503, detail="Payment service unavailable")

    try:
        # Parse form data (Flow sends as form-urlencoded)
        form_data = await request.form()
        token = form_data.get("token")

        if not token:
            # Try JSON body as fallback
            try:
                body = await request.json()
                token = body.get("token")
            except:
                pass

        if not token:
            print("Webhook received without token")
            raise HTTPException(status_code=400, detail="Token required")

        print(f"Payment webhook received for token: {token}")

        # Get commerce_order from token index
        commerce_order = redis_client.get(f"payment_token:{token}")
        if not commerce_order:
            print(f"No payment found for token: {token}")
            raise HTTPException(status_code=404, detail="Payment not found")

        if isinstance(commerce_order, bytes):
            commerce_order = commerce_order.decode('utf-8')

        # Get payment record
        payment_json = redis_client.get(f"payment:{commerce_order}")
        if not payment_json:
            raise HTTPException(status_code=404, detail="Payment record not found")

        payment = json.loads(payment_json)

        # Get payment status from Flow
        flow_status = flow_get_payment_status(token)
        print(f"Flow status response: {flow_status}")

        # Update payment record
        payment["flow_payment_data"] = flow_status

        # Check payment status (2 = PAID in Flow)
        if flow_status.get("status") == FlowPaymentStatus.PAID:
            payment["status"] = "paid"
            payment["paid_at"] = datetime.now().isoformat()

            # Activate premium by Google email (new simplified system)
            user_type = payment.get("user_type")
            google_email = payment.get("google_email")
            print(f"Flow payment - Premium activation: user_type={user_type}, google_email={google_email}")

            premium_expires = None
            if google_email:
                premium_result = set_premium_by_email(redis_client, google_email, user_type)
                premium_expires = premium_result.get("expires")
                print(f"Premium activated via Flow webhook for email: {google_email}")
            else:
                print(f"WARNING: Could not activate premium - no google_email in payment record")

            payment["premium_expires"] = premium_expires

            # Update PostgreSQL for persistence (non-blocking - Redis is source of truth)
            if postgres_available:
                try:
                    premium_expires_dt = None
                    if premium_expires:
                        try:
                            premium_expires_dt = datetime.fromisoformat(premium_expires)
                        except:
                            pass

                    postgres_db.update_payment_status(
                        commerce_order=commerce_order,
                        status="paid",
                        processor_payment_id=str(flow_status.get("flowOrder", "")),
                        processor_response=flow_status,
                        premium_expires=premium_expires_dt,
                        email=google_email
                    )
                    print(f"PostgreSQL payment record updated: {commerce_order}")

                    # Also persist premium status to User table (backup for Redis)
                    if google_email and premium_expires_dt:
                        postgres_db.set_premium_by_email(
                            email=google_email,
                            premium_expires=premium_expires_dt,
                            payment_id=commerce_order
                        )
                        print(f"PostgreSQL user premium status updated for: {google_email}")
                except Exception as pg_error:
                    print(f"PostgreSQL update error (non-critical, Redis is source of truth): {pg_error}")

            # Emit boleta electrónica (non-blocking - premium already activated)
            if boleta_available:
                try:
                    # Use google_email as receptor (payer's email)
                    receptor_email = google_email or payment.get("payer_email")
                    boleta_result = emit_boleta_async(
                        redis_client=redis_client,
                        payment_id=commerce_order,
                        monto_total=payment.get("amount", 0),
                        descripcion="Bill-e Premium - 1 año",
                        commerce_order=commerce_order,
                        email_receptor=receptor_email
                    )
                    payment["boleta_status"] = "success" if boleta_result.get("success") else "failed"
                    payment["boleta_folio"] = boleta_result.get("folio")
                    print(f"Boleta emitida para Flow payment: folio={boleta_result.get('folio')}, email={receptor_email}")

                    # Send boleta PDF to user (Res. SII N°12/2025 compliance)
                    # Idempotent via Redis flag — webhook retries don't re-send email.
                    if (
                        boleta_result.get("success")
                        and boleta_result.get("pdf_url")
                        and receptor_email
                        and not redis_client.exists(f"boleta_email_sent:{commerce_order}")
                    ):
                        try:
                            from email_service import send_boleta_email
                            email_result = send_boleta_email(
                                recipient_email=receptor_email,
                                folio=str(boleta_result.get("folio") or ""),
                                pdf_url=boleta_result.get("pdf_url"),
                                monto_total=payment.get("amount", 0),
                                descripcion="Bill-e Premium - 1 año",
                            )
                            if email_result.get("success"):
                                redis_client.setex(
                                    f"boleta_email_sent:{commerce_order}",
                                    30 * 24 * 60 * 60,
                                    "1",
                                )
                        except Exception as email_error:
                            print(f"Boleta email send failed (non-critical): {email_error}")
                except Exception as boleta_error:
                    print(f"Boleta error (non-critical): {boleta_error}")
                    payment["boleta_status"] = "error"

        elif flow_status.get("status") == FlowPaymentStatus.REJECTED:
            payment["status"] = "rejected"

        elif flow_status.get("status") == FlowPaymentStatus.CANCELLED:
            payment["status"] = "cancelled"

        # Save updated payment record
        ttl = redis_client.ttl(f"payment:{commerce_order}")
        redis_client.setex(
            f"payment:{commerce_order}",
            ttl if ttl > 0 else 604800,
            json.dumps(payment)
        )

        return {"status": "ok"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Webhook error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/payment/status/{commerce_order}")
async def get_payment_status_endpoint(commerce_order: str):
    """
    Check payment status by commerce order ID.
    Frontend polls this after redirect to confirm payment.
    """
    try:
        payment_json = redis_client.get(f"payment:{commerce_order}")

        if not payment_json:
            raise HTTPException(status_code=404, detail="Payment not found")

        payment = json.loads(payment_json)

        return {
            "commerce_order": commerce_order,
            "status": payment.get("status"),
            "amount": payment.get("amount"),
            "paid_at": payment.get("paid_at"),
            "premium_expires": payment.get("premium_expires"),
            "user_type": payment.get("user_type"),
            "session_id": payment.get("session_id")
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/payment/price")
async def get_payment_price():
    """Get current premium price."""
    if payment_available:
        return {"price": get_premium_price(), "currency": "CLP"}
    return {"price": 1990, "currency": "CLP"}


# =====================================================
# POLAR.SH PAYMENT ENDPOINTS (international, MoR)
# =====================================================

class PolarCheckoutRequest(BaseModel):
    email: Optional[str] = None
    session_id: Optional[str] = None
    user_type: str = "host"  # "host" or "editor"
    owner_token: Optional[str] = None


class TipCheckoutRequest(BaseModel):
    session_id: str
    amount_usd: float = Field(ge=1.0, description="Total tip in USD. Min $1 (Polar fee floor).")
    is_split: bool = False
    participant_count: int = Field(ge=1, default=1)
    google_email: str
    device_id: Optional[str] = None


@app.post("/api/polar/checkout")
async def create_polar_checkout(req: PolarCheckoutRequest):
    """Create a Polar hosted checkout session and return its URL."""
    if not polar_available or not polar_service.is_configured():
        raise HTTPException(status_code=503, detail="Polar not configured")

    product_id = os.getenv("POLAR_PRODUCT_ID")
    frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")

    if req.session_id:
        owner_qs = f"&owner={req.owner_token}" if req.user_type == "host" and req.owner_token else ""
        success_url = f"{frontend_url}/s/{req.session_id}?payment=success&payer={req.user_type}{owner_qs}"
    else:
        success_url = f"{frontend_url}/?payment=success"

    user_id = None
    if req.email and postgres_available:
        try:
            user = postgres_db.get_user_by_email(req.email)
            if user:
                user_id = user.get("id")
        except Exception as e:
            print(f"Polar: lookup by email failed: {e}")

    metadata: Dict[str, str] = {"user_type": req.user_type}
    if req.email:
        metadata["user_email"] = req.email
    if req.session_id:
        metadata["session_id"] = req.session_id
    if user_id:
        metadata["user_id"] = str(user_id)

    checkout = await polar_service.create_checkout(
        product_id=product_id,
        customer_email=req.email,
        success_url=success_url,
        metadata=metadata,
    )

    if not checkout or "_error" in checkout:
        err = (checkout or {}).get("_error", "unknown")
        status = (checkout or {}).get("_status", 0)
        base = (checkout or {}).get("_base", "")
        raise HTTPException(
            status_code=502,
            detail=f"Polar {status} ({base}): {err}",
        )

    return {
        "checkout_id": checkout.get("id"),
        "checkout_url": checkout.get("url"),
    }


def _compute_charged_amount(amount_total: float, is_split: bool, participant_count: int) -> float:
    """How much the host pays via Polar. Editors' share is informational only."""
    if is_split and participant_count > 1:
        return round(amount_total / participant_count, 2)
    return round(amount_total, 2)


@app.post("/api/polar/tip-checkout")
async def create_polar_tip_checkout(req: TipCheckoutRequest):
    """Create a Polar PWYW checkout for a tip. Returns hosted URL."""
    if not polar_available or not polar_service.is_configured():
        raise HTTPException(status_code=503, detail="Polar not configured")

    tip_product_id = os.getenv("POLAR_TIP_PRODUCT_ID")
    if not tip_product_id:
        raise HTTPException(status_code=503, detail="POLAR_TIP_PRODUCT_ID not configured")

    frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")
    success_url = (
        f"{frontend_url}/s/{req.session_id}"
        f"?tip_success=true&amount={req.amount_usd}"
    )

    charged = _compute_charged_amount(req.amount_usd, req.is_split, req.participant_count)

    metadata = {
        "kind": "tip",
        "session_id": req.session_id,
        "host_email": req.google_email,
        "tip_amount_total": req.amount_usd,
        "tip_amount_charged": charged,
        "is_split": req.is_split,
        "participant_count": req.participant_count,
    }

    checkout = await polar_service.create_checkout(
        product_id=tip_product_id,
        customer_email=req.google_email,
        success_url=success_url,
        metadata=metadata,
        amount=charged,
    )

    if not checkout or "_error" in checkout:
        err = (checkout or {}).get("_error", "unknown")
        status = (checkout or {}).get("_status", 0)
        raise HTTPException(status_code=502, detail=f"Polar {status}: {err}")

    return {
        "checkout_id": checkout.get("id"),
        "checkout_url": checkout.get("url"),
        "amount_charged_usd": charged,
    }


@app.post("/api/polar/webhook")
async def polar_webhook(request: Request):
    """Receive Polar webhook events. Grants premium on order.paid."""
    if not polar_available:
        raise HTTPException(status_code=503, detail="Polar not configured")

    payload = await request.body()
    headers = {k: v for k, v in request.headers.items()}

    if not polar_service.verify_webhook_signature(payload, headers):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("type")
    data = event.get("data") or {}
    print(f"Polar webhook received: {event_type}")

    if event_type == "order.paid":
        metadata = data.get("metadata") or {}
        customer = data.get("customer") or {}
        polar_order_id = str(data.get("id") or "")
        email = (
            metadata.get("user_email")
            or metadata.get("host_email")
            or customer.get("email")
            or data.get("customer_email")
        )

        # NEW: tip branch (does not grant premium).
        if metadata.get("kind") == "tip":
            if not email or not polar_order_id:
                print(f"Polar tip received without email or order id: {metadata}")
                return {"received": True}
            # Polar's actual paid amount, with tax. Field is total_amount in cents.
            # Fall back to data.amount if total_amount missing (older Polar API versions).
            total_paid_cents = data.get("total_amount") or data.get("amount") or 0
            total_paid_usd = float(total_paid_cents) / 100.0 if total_paid_cents else None
            if postgres_available:
                try:
                    with postgres_db.get_db() as db:
                        if db is not None:
                            recorded = postgres_db.record_tip(
                                db,
                                session_id=str(metadata.get("session_id") or ""),
                                host_email=email,
                                amount_total_usd=float(metadata.get("tip_amount_total") or 0),
                                amount_charged_usd=float(metadata.get("tip_amount_charged") or 0),
                                is_split=str(metadata.get("is_split")).lower() == "true",
                                participant_count=int(metadata.get("participant_count") or 1),
                                polar_order_id=polar_order_id,
                                total_paid_usd=total_paid_usd,
                            )
                            print(f"Polar tip recorded={recorded} order={polar_order_id} email={email} total_paid_usd={total_paid_usd}")
                except Exception as e:
                    print(f"Polar tip persist failed: {e}")
            # TODO(b5): PostHog analytics — no standalone capture_event in backend yet.
            # analytics.py uses AnalyticsTracker.track_event (Redis-backed), not PostHog directly.
            # Frontend tracking via tip_paid_webhook will cover this until backend PostHog is wired.
            return {"received": True}

        # EXISTING premium-granting logic continues below.
        user_type = metadata.get("user_type") or "host"
        payment_id = polar_order_id

        if not email:
            print(f"Polar order.paid received without resolvable email: metadata={metadata}")
            return {"received": True}

        # Grant premium in Redis (used by finalize_session / paywall checks)
        # AND in PostgreSQL (durable record).
        if redis_client:
            try:
                set_premium_by_email(redis_client, email, user_type)
                print(f"Polar: Redis premium granted to {email} (user_type={user_type})")
            except Exception as e:
                print(f"Polar: failed to grant Redis premium for {email}: {e}")

        if postgres_available:
            try:
                expires = datetime.utcnow() + timedelta(days=365)
                postgres_db.set_premium_by_email(
                    email=email,
                    premium_expires=expires,
                    payment_id=None,  # Polar order id is not a UUID — log separately
                )
                print(f"Polar: Postgres premium granted to {email} until {expires.isoformat()} (order {payment_id})")
            except Exception as e:
                print(f"Polar: failed to grant Postgres premium for {email}: {e}")

    return {"received": True}


# =====================================================
# MERCADOPAGO PAYMENT ENDPOINTS
# =====================================================

class MPPreferenceRequest(BaseModel):
    user_type: str  # "editor" or "host"
    google_email: str  # Required: user must be logged in with Google before paying
    session_id: Optional[str] = None
    payment_method_filter: Optional[str] = None  # "credit_card" or "debit_card" for Checkout Pro redirect
    # Legacy fields (kept for backward compatibility but not used for premium)
    device_id: Optional[str] = None
    phone: Optional[str] = None


class MPCardPaymentRequest(BaseModel):
    token: str
    transaction_amount: float
    installments: int
    payment_method_id: str
    issuer_id: str
    payer_email: str
    user_type: str
    google_email: str  # Required: user must be logged in with Google before paying
    session_id: Optional[str] = None
    # Legacy fields (kept for backward compatibility but not used for premium)
    device_id: Optional[str] = None
    phone: Optional[str] = None


@app.get("/api/mercadopago/public-key")
async def get_mp_public_key():
    """Get MercadoPago public key for frontend Bricks initialization."""
    if not mercadopago_available:
        raise HTTPException(status_code=503, detail="MercadoPago not available")

    try:
        return {"public_key": mp_get_public_key()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mercadopago/preference")
async def create_mp_preference(request: MPPreferenceRequest):
    """
    Create a MercadoPago preference for Wallet Brick.
    Requires Google authentication before payment.
    Returns preference_id for frontend Wallet Brick initialization.
    """
    if not mercadopago_available:
        raise HTTPException(status_code=503, detail="MercadoPago not available")

    try:
        # Validate request
        if request.user_type not in ["editor", "host"]:
            raise HTTPException(status_code=400, detail="Invalid user_type")

        # Google email is required for premium tracking
        if not request.google_email:
            raise HTTPException(status_code=400, detail="Google authentication required before payment")

        google_email = request.google_email.lower().strip()

        # Generate unique commerce order ID
        commerce_order = f"mp_{uuid.uuid4().hex[:12]}"

        # Build callback URLs
        backend_url = os.getenv("BACKEND_URL", "https://bill-e-backend-lfwp.onrender.com")
        frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")

        notification_url = f"{backend_url}/api/mercadopago/webhook"

        # Build return URLs with session context and user_type
        base_return = f"{frontend_url}/payment/success"
        params = []
        if request.session_id:
            params.append(f"session={request.session_id}")
        if request.user_type:
            params.append(f"type={request.user_type}")

        base_return = f"{base_return}?{'&'.join(params)}" if params else base_return
        separator = "&" if params else "?"

        success_url = f"{base_return}{separator}status=approved"
        failure_url = f"{base_return}{separator}status=rejected"
        pending_url = f"{base_return}{separator}status=pending"

        # Get configured price
        amount = mp_get_premium_price()

        # Create preference
        preference = mp_create_preference(
            commerce_order=commerce_order,
            title="Bill-e Premium - 1 año",
            amount=amount,
            notification_url=notification_url,
            success_url=success_url,
            failure_url=failure_url,
            pending_url=pending_url,
            external_reference=commerce_order,
            metadata={
                "user_type": request.user_type,
                "google_email": google_email,
                "session_id": request.session_id
            },
            payment_method_filter=request.payment_method_filter,
            payer_email=google_email
        )

        # Store payment record in Redis
        payment_record = {
            "commerce_order": commerce_order,
            "preference_id": preference.get("id"),
            "processor": "mercadopago",
            "status": "pending",
            "amount": amount,
            "currency": "CLP",
            "user_type": request.user_type,
            "google_email": google_email,
            "session_id": request.session_id,
            "created_at": datetime.now().isoformat(),
            "paid_at": None,
            "premium_expires": None
        }

        # Store with 7-day TTL
        redis_client.setex(
            f"payment:{commerce_order}",
            604800,  # 7 days
            json.dumps(payment_record)
        )

        # Also store in PostgreSQL for persistence
        if postgres_available:
            postgres_db.create_payment(
                commerce_order=commerce_order,
                processor="mercadopago",
                amount=amount,
                currency="CLP",
                email=google_email,
                user_type=request.user_type,
                country_code="CL",
                session_id=request.session_id
            )

        return {
            "success": True,
            "preference_id": preference.get("id"),
            "init_point": preference.get("init_point"),
            "sandbox_init_point": preference.get("sandbox_init_point"),
            "commerce_order": commerce_order,
            "amount": amount
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"MercadoPago preference error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mercadopago/process-payment")
async def process_mp_card_payment(request: MPCardPaymentRequest):
    """
    Process a card payment from Card Payment Brick.
    Called when user submits card details in the embedded form.
    """
    if not mercadopago_available:
        raise HTTPException(status_code=503, detail="MercadoPago not available")

    try:
        # Validate request
        if request.user_type not in ["editor", "host"]:
            raise HTTPException(status_code=400, detail="Invalid user_type")

        # Google email is required for premium tracking
        if not request.google_email:
            raise HTTPException(status_code=400, detail="Google authentication required before payment")

        google_email = request.google_email.lower().strip()

        # Generate unique commerce order ID
        commerce_order = f"mp_{uuid.uuid4().hex[:12]}"

        # Build notification URL
        backend_url = os.getenv("BACKEND_URL", "https://bill-e-backend-lfwp.onrender.com")
        notification_url = f"{backend_url}/api/mercadopago/webhook"

        # Process card payment
        payment_result = mp_process_card_payment(
            token=request.token,
            transaction_amount=request.transaction_amount,
            installments=request.installments,
            payment_method_id=request.payment_method_id,
            issuer_id=request.issuer_id,
            payer_email=request.payer_email,
            external_reference=commerce_order,
            description="Bill-e Premium - 1 año",
            notification_url=notification_url,
            metadata={
                "user_type": request.user_type,
                "google_email": google_email,
                "session_id": request.session_id
            }
        )

        mp_status = payment_result.get("status")

        # Determine our status
        if MPPaymentStatus.is_approved(mp_status):
            status = "paid"
            paid_at = datetime.now().isoformat()

            # Activate premium by Google email
            premium_result = set_premium_by_email(redis_client, google_email, request.user_type)
            premium_expires = premium_result.get("expires")
            print(f"Premium activated for Google email: {google_email}")

        elif MPPaymentStatus.is_pending(mp_status):
            status = "pending"
            paid_at = None
            premium_expires = None
        else:
            status = "rejected"
            paid_at = None
            premium_expires = None

        # Store payment record in Redis
        payment_record = {
            "commerce_order": commerce_order,
            "mp_payment_id": payment_result.get("id"),
            "processor": "mercadopago",
            "status": status,
            "mp_status": mp_status,
            "amount": int(request.transaction_amount),
            "currency": "CLP",
            "user_type": request.user_type,
            "google_email": google_email,
            "session_id": request.session_id,
            "payer_email": request.payer_email,
            "created_at": datetime.now().isoformat(),
            "paid_at": paid_at,
            "premium_expires": premium_expires,
            "mp_response": payment_result
        }

        redis_client.setex(
            f"payment:{commerce_order}",
            604800,
            json.dumps(payment_record)
        )

        return {
            "success": status == "paid",
            "status": status,
            "mp_status": mp_status,
            "commerce_order": commerce_order,
            "payment_id": payment_result.get("id"),
            "premium_expires": premium_expires,
            "status_detail": payment_result.get("status_detail")
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"MercadoPago card payment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mercadopago/webhook")
async def mp_webhook(request: Request):
    """
    MercadoPago webhook callback.
    Called when payment status changes.

    Security:
    1. Verify webhook signature (HMAC-SHA256)
    2. Always fetch payment from MP API (never trust webhook payload directly)
    3. Only activate premium after confirming status=approved
    """
    if not mercadopago_available:
        raise HTTPException(status_code=503, detail="MercadoPago not available")

    try:
        # Get headers for signature verification
        x_signature = request.headers.get("x-signature", "")
        x_request_id = request.headers.get("x-request-id", "")

        # Get query params (MercadoPago sends type and data.id)
        params = dict(request.query_params)

        # Also try to get JSON body
        try:
            body = await request.json()
        except:
            body = {}

        print(f"MercadoPago webhook - params: {params}, body: {body}")

        # Get payment ID from various possible locations
        payment_id = None
        topic = params.get("topic") or params.get("type") or body.get("type")

        if topic == "payment":
            payment_id = params.get("id") or body.get("data", {}).get("id")
        elif body.get("action") == "payment.created" or body.get("action") == "payment.updated":
            payment_id = body.get("data", {}).get("id")

        if not payment_id:
            print(f"Webhook received but no payment_id found: {params}, {body}")
            return {"status": "ok", "message": "No payment_id"}

        # Verify webhook signature — fail-closed in production to prevent
        # forged "approved" callbacks from unlocking premium without paying.
        data_id = str(body.get("data", {}).get("id", payment_id))
        if not mp_verify_signature(x_signature, x_request_id, data_id):
            is_production = os.getenv("ENV", "development").lower() == "production"
            if is_production:
                print(f"REJECTED: Invalid webhook signature for payment {payment_id} (ENV=production)")
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
            print(f"WARNING: Invalid webhook signature for payment {payment_id} (dev mode, processing anyway)")

        # Get payment details from MercadoPago
        print(f"Fetching payment details from MP API: {payment_id}")
        mp_payment = mp_get_payment(str(payment_id))
        external_reference = mp_payment.get("external_reference")
        mp_status = mp_payment.get("status")
        print(f"MP payment {payment_id}: status={mp_status}, external_reference={external_reference}")

        if not external_reference:
            print(f"No external_reference in payment {payment_id}")
            return {"status": "ok", "message": "No external_reference"}

        # Get our payment record
        payment_json = redis_client.get(f"payment:{external_reference}")
        if not payment_json:
            print(f"Payment record not found in Redis: payment:{external_reference}")
            return {"status": "ok", "message": "Payment not found"}

        payment = json.loads(payment_json)
        print(f"Found payment record: status={payment.get('status')}, user_type={payment.get('user_type')}")

        # Update payment record
        payment["mp_payment_id"] = payment_id
        payment["mp_status"] = mp_status
        payment["mp_response"] = mp_payment

        # Extract payer email from MP response (for premium recovery)
        mp_payer = mp_payment.get("payer", {})
        mp_payer_email = mp_payer.get("email")
        if mp_payer_email:
            payment["payer_email"] = mp_payer_email
            print(f"Payer email from MP: {mp_payer_email}")

        if MPPaymentStatus.is_approved(mp_status) and payment.get("status") != "paid":
            print(f"Payment {payment_id} APPROVED - activating premium")
            payment["status"] = "paid"
            payment["paid_at"] = datetime.now().isoformat()

            # Activate premium by Google email (new simplified system)
            user_type = payment.get("user_type")
            google_email = payment.get("google_email")
            print(f"Premium activation: user_type={user_type}, google_email={google_email}")

            if google_email:
                premium_result = set_premium_by_email(redis_client, google_email, user_type)
                payment["premium_expires"] = premium_result.get("expires")
                print(f"Premium activated via webhook for email: {google_email}")
            else:
                print(f"WARNING: Could not activate premium - no google_email in payment record")

        elif MPPaymentStatus.is_failed(mp_status):
            payment["status"] = "rejected"
            print(f"Payment {payment_id} REJECTED")
        else:
            print(f"Payment {payment_id} status unchanged: mp_status={mp_status}, current_status={payment.get('status')}")

        # Save updated record
        print(f"Saving payment record: status={payment.get('status')}")
        ttl = redis_client.ttl(f"payment:{external_reference}")
        redis_client.setex(
            f"payment:{external_reference}",
            ttl if ttl > 0 else 604800,
            json.dumps(payment)
        )

        # Also update PostgreSQL for persistence (non-blocking - Redis is source of truth)
        if postgres_available and payment.get("status") == "paid":
            try:
                premium_expires_dt = None
                if payment.get("premium_expires"):
                    try:
                        premium_expires_dt = datetime.fromisoformat(payment["premium_expires"])
                    except:
                        pass

                google_email = payment.get("google_email")
                postgres_db.update_payment_status(
                    commerce_order=external_reference,
                    status="paid",
                    processor_payment_id=str(payment_id),
                    processor_response=mp_payment,
                    premium_expires=premium_expires_dt,
                    email=google_email
                )
                print(f"PostgreSQL payment record updated: {external_reference}")

                # Also persist premium status to User table (backup for Redis)
                if google_email and premium_expires_dt:
                    postgres_db.set_premium_by_email(
                        email=google_email,
                        premium_expires=premium_expires_dt,
                        payment_id=external_reference
                    )
                    print(f"PostgreSQL user premium status updated for: {google_email}")
            except Exception as pg_error:
                print(f"PostgreSQL update error (non-critical): {pg_error}")

        # Emit boleta electrónica (non-blocking - premium already activated)
        if boleta_available and payment.get("status") == "paid":
            try:
                # Use google_email or MP payer email as receptor
                receptor_email = payment.get("google_email") or mp_payer_email
                boleta_result = emit_boleta_async(
                    redis_client=redis_client,
                    payment_id=external_reference,
                    monto_total=payment.get("amount", 0),
                    descripcion="Bill-e Premium - 1 año",
                    commerce_order=external_reference,
                    email_receptor=receptor_email
                )
                payment["boleta_status"] = "success" if boleta_result.get("success") else "failed"
                payment["boleta_folio"] = boleta_result.get("folio")
                print(f"Boleta emitida para MP payment: folio={boleta_result.get('folio')}, email={receptor_email}")

                # Send boleta PDF to user (Res. SII N°12/2025 compliance)
                # Idempotent via Redis flag — webhook retries don't re-send email.
                if (
                    boleta_result.get("success")
                    and boleta_result.get("pdf_url")
                    and receptor_email
                    and not redis_client.exists(f"boleta_email_sent:{external_reference}")
                ):
                    try:
                        from email_service import send_boleta_email
                        email_result = send_boleta_email(
                            recipient_email=receptor_email,
                            folio=str(boleta_result.get("folio") or ""),
                            pdf_url=boleta_result.get("pdf_url"),
                            monto_total=payment.get("amount", 0),
                            descripcion="Bill-e Premium - 1 año",
                        )
                        if email_result.get("success"):
                            redis_client.setex(
                                f"boleta_email_sent:{external_reference}",
                                30 * 24 * 60 * 60,
                                "1",
                            )
                    except Exception as email_error:
                        print(f"Boleta email send failed (non-critical): {email_error}")

                # Save updated payment with boleta info
                ttl = redis_client.ttl(f"payment:{external_reference}")
                redis_client.setex(
                    f"payment:{external_reference}",
                    ttl if ttl > 0 else 604800,
                    json.dumps(payment)
                )
            except Exception as boleta_error:
                print(f"Boleta error (non-critical): {boleta_error}")
                payment["boleta_status"] = "error"

        return {"status": "ok"}

    except Exception as e:
        print(f"MercadoPago webhook error: {e}")
        # Always return 200 to avoid retries
        return {"status": "error", "message": str(e)}


# =====================================================
# PREMIUM CHECK ENDPOINT (by Google email)
# =====================================================

@app.get("/api/premium/check/{email}")
async def check_premium_status(email: str):
    """
    Check if a Google email has active premium.
    Used by frontend after Google login to verify premium status.
    """
    try:
        if not email:
            raise HTTPException(status_code=400, detail="Email required")

        email = email.strip().lower()

        # Check Redis for premium status
        premium_status = check_premium_by_email(redis_client, email)

        return {
            "success": True,
            "email": email,
            "is_premium": premium_status.get("is_premium", False),
            "premium_expires": premium_status.get("premium_expires"),
            "user_type": premium_status.get("user_type")
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Premium check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================
# ANALYTICS ENDPOINTS
# =====================================================

class AnalyticsEvent(BaseModel):
    event_name: str
    event_params: dict = {}
    timestamp: str = None


@app.post("/api/analytics/event")
async def track_analytics_event(event: AnalyticsEvent):
    """
    Track a funnel event from the frontend.
    Events are stored in Redis for real-time analytics.
    """
    try:
        if not redis_client:
            # Silently succeed if Redis not available - analytics shouldn't break the app
            return {"success": True}

        timestamp = event.timestamp or datetime.utcnow().isoformat()
        today = datetime.utcnow().strftime("%Y-%m-%d")

        # Create event data
        event_data = {
            "event_name": event.event_name,
            "event_params": event.event_params,
            "timestamp": timestamp,
        }

        # Store in Redis list for the day (global events)
        key = f"analytics:events:{today}"
        redis_client.lpush(key, json.dumps(event_data))
        redis_client.ltrim(key, 0, 9999)
        redis_client.expire(key, 7 * 86400)  # Keep for 7 days

        # Increment counters for quick funnel stats
        counter_key = f"analytics:funnel:{today}:{event.event_name}"
        redis_client.incr(counter_key)
        redis_client.expire(counter_key, 7 * 86400)

        # Store per-user history (if tracking_id is present)
        tracking_id = event.event_params.get("tracking_id")
        if tracking_id:
            # Store event in user's history list
            user_key = f"analytics:user:{tracking_id}:events"
            redis_client.lpush(user_key, json.dumps(event_data))
            redis_client.ltrim(user_key, 0, 499)  # Keep last 500 events per user
            redis_client.expire(user_key, 30 * 86400)  # Keep for 30 days

            # Update user metadata
            meta_key = f"analytics:user:{tracking_id}:meta"
            redis_client.hset(meta_key, "last_seen", timestamp)
            redis_client.hset(meta_key, "last_event", event.event_name)
            if not redis_client.hexists(meta_key, "first_seen"):
                redis_client.hset(meta_key, "first_seen", timestamp)
            # Store device info on first event
            if event.event_params.get("device_type"):
                redis_client.hset(meta_key, "device_type", event.event_params.get("device_type"))
            if event.event_params.get("os"):
                redis_client.hset(meta_key, "os", event.event_params.get("os"))
            redis_client.expire(meta_key, 30 * 86400)

            # Increment user's event counter
            user_counter_key = f"analytics:user:{tracking_id}:counts"
            redis_client.hincrby(user_counter_key, event.event_name, 1)
            redis_client.hincrby(user_counter_key, "total_events", 1)
            redis_client.expire(user_counter_key, 30 * 86400)

            # Add to set of known users (for listing)
            redis_client.sadd("analytics:users", tracking_id)
            redis_client.expire("analytics:users", 30 * 86400)

        return {"success": True}
    except Exception as e:
        # Silently fail - analytics shouldn't break the app
        print(f"Analytics error: {e}")
        return {"success": True}


@app.get("/api/analytics/funnel")
async def get_funnel_analytics(secret: str = None, days: int = 7):
    """Get funnel analytics. Requires admin secret."""
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not redis_client:
        return {"error": "Redis not available"}

    try:
        funnel_events = [
            "funnel_app_open",
            "funnel_photo_taken",
            "funnel_ocr_complete",
            "funnel_step1_complete",
            "funnel_person_added",
            "funnel_step2_complete",
            "funnel_shared",
            "funnel_paywall_shown",
            "funnel_payment_started",
            "funnel_payment_complete",
        ]

        result = {"days": {}}

        for i in range(days):
            date = (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d")
            day_stats = {}

            for event in funnel_events:
                key = f"analytics:funnel:{date}:{event}"
                count = redis_client.get(key)
                day_stats[event] = int(count) if count else 0

            result["days"][date] = day_stats

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/users")
async def get_analytics_users(secret: str = None, limit: int = 100):
    """
    List all tracked users with their event counts.
    Requires admin secret.
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not redis_client:
        return {"error": "Redis not available"}

    try:
        # Get all known tracking IDs
        tracking_ids = redis_client.smembers("analytics:users")
        if not tracking_ids:
            return {"users": [], "total": 0}

        users = []
        for tid in tracking_ids:
            tid_str = tid.decode() if isinstance(tid, bytes) else tid

            # Get user metadata
            meta_key = f"analytics:user:{tid_str}:meta"
            meta = redis_client.hgetall(meta_key)
            meta_decoded = {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v for k, v in meta.items()}

            # Get user event counts
            counts_key = f"analytics:user:{tid_str}:counts"
            counts = redis_client.hgetall(counts_key)
            counts_decoded = {k.decode() if isinstance(k, bytes) else k: int(v) for k, v in counts.items()}

            users.append({
                "tracking_id": tid_str,
                "meta": meta_decoded,
                "event_counts": counts_decoded,
            })

        # Sort by last_seen (most recent first)
        users.sort(key=lambda u: u["meta"].get("last_seen", ""), reverse=True)

        return {
            "users": users[:limit],
            "total": len(users),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/user/{tracking_id}")
async def get_user_analytics(tracking_id: str, secret: str = None, limit: int = 100):
    """
    Get a specific user's event history and stats.
    Requires admin secret.
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not redis_client:
        return {"error": "Redis not available"}

    try:
        # Get user metadata
        meta_key = f"analytics:user:{tracking_id}:meta"
        meta = redis_client.hgetall(meta_key)
        if not meta:
            raise HTTPException(status_code=404, detail="User not found")

        meta_decoded = {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v for k, v in meta.items()}

        # Get user event counts
        counts_key = f"analytics:user:{tracking_id}:counts"
        counts = redis_client.hgetall(counts_key)
        counts_decoded = {k.decode() if isinstance(k, bytes) else k: int(v) for k, v in counts.items()}

        # Get user event history
        events_key = f"analytics:user:{tracking_id}:events"
        events_raw = redis_client.lrange(events_key, 0, limit - 1)
        events = [json.loads(e) for e in events_raw]

        # Calculate funnel progress
        funnel_order = [
            "funnel_app_open",
            "funnel_photo_taken",
            "funnel_ocr_complete",
            "funnel_step1_complete",
            "funnel_person_added",
            "funnel_step2_complete",
            "funnel_shared",
            "funnel_paywall_shown",
            "funnel_payment_started",
            "funnel_payment_complete",
        ]

        furthest_step = 0
        for i, event in enumerate(funnel_order):
            if counts_decoded.get(event, 0) > 0:
                furthest_step = i + 1

        # Get sessions this user participated in
        session_ids = set()
        for event in events:
            if event.get("event_params", {}).get("session_id"):
                session_ids.add(event["event_params"]["session_id"])

        return {
            "tracking_id": tracking_id,
            "meta": meta_decoded,
            "event_counts": counts_decoded,
            "funnel_progress": {
                "furthest_step": furthest_step,
                "total_steps": len(funnel_order),
                "completed": furthest_step == len(funnel_order),
            },
            "sessions": list(session_ids),
            "events": events,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================
# CRON ENDPOINTS - Session Sync
# =====================================================

@app.post("/api/cron/sync-sessions")
async def cron_sync_sessions(secret: str = None):
    """
    Cron job to sync all Redis sessions to PostgreSQL.
    Should be called every 15 minutes via external cron service.

    Example: curl -X POST "https://api.bill-e.app/api/cron/sync-sessions?secret=xxx"
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not redis_client:
        return {"error": "Redis not available", "synced": 0}

    if not postgres_available:
        return {"error": "PostgreSQL not available", "synced": 0}

    try:
        synced = 0
        errors = 0
        sessions_found = []

        # Scan all session keys in Redis
        cursor = 0
        while True:
            cursor, keys = redis_client.scan(cursor, match="session:*", count=100)

            for key in keys:
                key_str = key.decode() if isinstance(key, bytes) else key
                session_id = key_str.replace("session:", "")

                try:
                    # Get session data
                    session_json = redis_client.get(key_str)
                    if not session_json:
                        continue

                    session_data = json.loads(session_json)

                    # Get TTL
                    ttl = redis_client.ttl(key_str)

                    # Add session_id to data if not present
                    session_data["session_id"] = session_id

                    # Enrich with user_id from device_id
                    owner_device_id = session_data.get("owner_device_id")
                    if owner_device_id and not session_data.get("user_id"):
                        found_user_id = postgres_db.get_user_id_for_device(owner_device_id)
                        if found_user_id:
                            session_data["user_id"] = found_user_id

                    # Upsert to PostgreSQL
                    result = postgres_db.upsert_session_snapshot(session_data, redis_ttl=ttl)

                    if result:
                        synced += 1
                        sessions_found.append({
                            "session_id": session_id,
                            "status": result.get("status"),
                            "is_new": result.get("is_new"),
                            "ttl": ttl
                        })
                    else:
                        errors += 1

                except Exception as e:
                    print(f"Error syncing session {session_id}: {e}")
                    errors += 1

            if cursor == 0:
                break

        return {
            "success": True,
            "synced": synced,
            "errors": errors,
            "sessions": sessions_found[:20]  # Return first 20 for debugging
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cron/session-metrics")
async def get_session_metrics_endpoint(secret: str = None):
    """
    Get aggregated session metrics from PostgreSQL.
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        return {"error": "PostgreSQL not available"}

    try:
        metrics = postgres_db.get_session_metrics()
        if not metrics:
            return {"error": "No data available"}
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cron/recent-sessions")
async def get_recent_sessions_endpoint(secret: str = None, limit: int = 50, status: str = None):
    """
    Get recent session snapshots from PostgreSQL.
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        return {"error": "PostgreSQL not available"}

    try:
        sessions = postgres_db.get_recent_sessions(limit=limit, status=status)
        return {"sessions": sessions, "count": len(sessions)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cron/sync-users")
async def cron_sync_users(secret: str = None):
    """
    Sync user analytics from Redis to PostgreSQL.
    Stores complete user history permanently.
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not redis_client:
        return {"error": "Redis not available", "synced": 0}

    if not postgres_available:
        return {"error": "PostgreSQL not available", "synced": 0}

    try:
        synced = 0
        errors = 0
        events_added = 0

        # Get all known tracking IDs from Redis
        tracking_ids = redis_client.smembers("analytics:users")

        if not tracking_ids:
            return {"success": True, "synced": 0, "message": "No users to sync"}

        for tid in tracking_ids:
            try:
                tid_str = tid.decode() if isinstance(tid, bytes) else tid

                # Get user metadata from Redis
                meta_key = f"analytics:user:{tid_str}:meta"
                meta_raw = redis_client.hgetall(meta_key)
                meta = {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v
                        for k, v in meta_raw.items()}

                # Get event counts from Redis
                counts_key = f"analytics:user:{tid_str}:counts"
                counts_raw = redis_client.hgetall(counts_key)
                event_counts = {k.decode() if isinstance(k, bytes) else k: int(v)
                               for k, v in counts_raw.items()}

                # Get events from Redis
                events_key = f"analytics:user:{tid_str}:events"
                events_raw = redis_client.lrange(events_key, 0, -1)  # Get all events
                events = [json.loads(e) for e in events_raw]

                # Upsert to PostgreSQL
                result = postgres_db.upsert_user_analytics(
                    tracking_id=tid_str,
                    meta=meta,
                    event_counts=event_counts,
                    events=events
                )

                if result:
                    synced += 1
                    events_added += result.get("events_added", 0)
                else:
                    errors += 1

            except Exception as e:
                print(f"Error syncing user {tid_str}: {e}")
                errors += 1

        return {
            "success": True,
            "synced": synced,
            "events_added": events_added,
            "errors": errors,
            "total_users_in_redis": len(tracking_ids)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cron/full-sync")
async def cron_full_sync(secret: str = None):
    """
    Full sync: sessions + users + premium reconciliation.
    Single endpoint to call from external cron.
    """
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    results = {}

    # Sync sessions
    try:
        session_result = await cron_sync_sessions(secret=secret)
        results["sessions"] = {
            "synced": session_result.get("synced", 0),
            "errors": session_result.get("errors", 0)
        }
    except Exception as e:
        results["sessions"] = {"error": str(e)}

    # Sync user analytics
    try:
        users_result = await cron_sync_users(secret=secret)
        results["users"] = {
            "synced": users_result.get("synced", 0),
            "events_added": users_result.get("events_added", 0),
            "errors": users_result.get("errors", 0)
        }
    except Exception as e:
        results["users"] = {"error": str(e)}

    # Reconcile premium
    try:
        premium_result = await cron_reconcile_premium(secret=secret)
        results["premium"] = {
            "reconciled": premium_result.get("reconciled", 0),
            "already_active": premium_result.get("already_active", 0),
            "errors": premium_result.get("errors", 0)
        }
    except Exception as e:
        results["premium"] = {"error": str(e)}

    return {
        "success": True,
        "timestamp": datetime.utcnow().isoformat(),
        "results": results
    }


@app.get("/api/analytics/user-summary")
async def get_user_analytics_summary_endpoint(secret: str = None):
    """Get aggregated user analytics from PostgreSQL."""
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        return {"error": "PostgreSQL not available"}

    try:
        summary = postgres_db.get_user_analytics_summary()
        if not summary:
            return {"error": "No data available"}
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/user-history/{tracking_id}")
async def get_user_history_endpoint(tracking_id: str, secret: str = None, limit: int = 500):
    """Get complete history for a specific user from PostgreSQL."""
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        return {"error": "PostgreSQL not available"}

    try:
        history = postgres_db.get_user_history(tracking_id, limit=limit)
        if not history:
            raise HTTPException(status_code=404, detail="User not found")
        return history
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/monthly/{year}/{month}")
async def get_monthly_analytics_endpoint(year: int, month: int, secret: str = None):
    """Get analytics for a specific month."""
    if secret != os.getenv("ADMIN_SECRET", "bill-e-admin-2024"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        return {"error": "PostgreSQL not available"}

    try:
        analytics = postgres_db.get_monthly_analytics(year, month)
        if not analytics:
            return {"error": "No data available"}
        return analytics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================
# ADMIN ENDPOINTS
# =====================================================

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "bill-e-admin-2024")


@app.get("/api/admin/analytics")
async def get_admin_analytics(secret: str = None):
    """Get analytics summary. Requires admin secret."""
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        raise HTTPException(status_code=503, detail="PostgreSQL not configured")

    try:
        analytics = postgres_db.get_analytics_summary()
        if not analytics:
            return {"message": "No data available yet"}
        return analytics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/admin/payments")
async def get_admin_payments(secret: str = None, limit: int = 50):
    """Get recent payments. Requires admin secret."""
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        raise HTTPException(status_code=503, detail="PostgreSQL not configured")

    try:
        payments = postgres_db.get_recent_payments(limit=limit)
        return {"payments": payments, "count": len(payments)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/admin/user/{device_id}")
async def get_admin_user(device_id: str, secret: str = None):
    """Get user profile by device_id. Requires admin secret."""
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not postgres_available:
        raise HTTPException(status_code=503, detail="PostgreSQL not configured")

    try:
        profile = postgres_db.get_user_profile(device_id)
        if not profile:
            raise HTTPException(status_code=404, detail="User not found")
        return profile
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/admin/premium-users")
async def list_premium_users_endpoint(secret: str = None):
    """Return count + sample of users with active premium. Admin only."""
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not postgres_available:
        raise HTTPException(status_code=503, detail="PostgreSQL not configured")
    return postgres_db.list_premium_users()


@app.post("/api/admin/clear-premium")
async def clear_premium_endpoint(email: str = None, secret: str = None):
    """Clear premium status for a user by email across both Postgres and
    Redis. Used by admin tooling to reset a tester's account between
    end-to-end payment runs."""
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not email:
        raise HTTPException(status_code=400, detail="email query param required")

    pg_result = None
    if postgres_available:
        pg_result = postgres_db.clear_premium_by_email(email)

    redis_result = None
    try:
        if redis_client:
            redis_result = redis_clear_premium_by_email(redis_client, email)
    except Exception as e:
        redis_result = {"error": str(e)}

    if not pg_result and not (redis_result and redis_result.get("deleted")):
        raise HTTPException(status_code=404, detail="User not found in Postgres or Redis")

    return {"postgres": pg_result, "redis": redis_result}


# ==============================================================================
# OAuth Authentication Endpoints
# ==============================================================================

# Store for OAuth state tokens (should use Redis in production)
oauth_states: Dict[str, Dict] = {}


@app.get("/api/auth/providers")
async def get_auth_providers():
    """Get list of available OAuth providers."""
    if not auth_available:
        return {"providers": [], "message": "Authentication not configured"}

    # Only include Google for now (Facebook requires advanced access)
    providers = []
    if oauth_auth.is_provider_configured("google"):
        providers.append("google")

    return {
        "providers": providers,
        "configured": {
            "google": oauth_auth.is_provider_configured("google"),
        }
    }


@app.get("/api/auth/{provider}/login")
async def oauth_login(
    provider: str,
    device_id: str = None,
    redirect_to: str = None
):
    """
    Start OAuth flow. Returns authorization URL.

    Args:
        provider: google, facebook, or microsoft
        device_id: Optional device ID to link after auth
        redirect_to: Optional URL to redirect after successful auth
    """
    if not auth_available:
        raise HTTPException(status_code=503, detail="Authentication not available")

    if provider not in ["google", "facebook", "microsoft"]:
        raise HTTPException(status_code=400, detail="Invalid provider")

    if not oauth_auth.is_provider_configured(provider):
        raise HTTPException(status_code=503, detail=f"{provider} not configured")

    # Generate state token
    state = oauth_auth.generate_state_token()

    # Store state with metadata
    backend_url = os.getenv("BACKEND_URL", "https://bill-e-backend-lfwp.onrender.com")
    redirect_uri = f"{backend_url}/api/auth/{provider}/callback"

    oauth_states[state] = {
        "provider": provider,
        "device_id": device_id,
        "redirect_to": redirect_to,
        "created_at": datetime.now().isoformat()
    }

    # Clean old states (older than 10 minutes)
    now = datetime.now()
    expired_states = [
        s for s, data in oauth_states.items()
        if (now - datetime.fromisoformat(data["created_at"])).seconds > 600
    ]
    for s in expired_states:
        del oauth_states[s]

    # Generate auth URL
    auth_url = oauth_auth.generate_auth_url(
        provider=provider,
        redirect_uri=redirect_uri,
        state=state,
        device_id=device_id
    )

    return {
        "auth_url": auth_url,
        "state": state,
        "provider": provider
    }


@app.get("/api/auth/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: str = None,
    state: str = None,
    error: str = None
):
    """
    OAuth callback handler. Exchanges code for token and creates/updates user.
    Redirects to frontend with session token.
    """
    from fastapi.responses import RedirectResponse

    frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")

    if error:
        return RedirectResponse(f"{frontend_url}/auth/error?error={error}")

    if not code or not state:
        return RedirectResponse(f"{frontend_url}/auth/error?error=missing_params")

    # Parse state to extract original token and device_id
    # State format from Google: "state_token:device_id" or just "state_token"
    state_token, state_device_id = oauth_auth.parse_state(state)

    # Verify state
    state_data = oauth_states.pop(state_token, None)
    if not state_data:
        print(f"OAuth state not found: {state_token}, available: {list(oauth_states.keys())}")
        return RedirectResponse(f"{frontend_url}/auth/error?error=invalid_state")

    if state_data["provider"] != provider:
        return RedirectResponse(f"{frontend_url}/auth/error?error=provider_mismatch")

    # Use device_id from state or from stored data
    device_id = state_device_id or state_data.get("device_id")
    redirect_to = state_data.get("redirect_to")

    # Exchange code for token
    backend_url = os.getenv("BACKEND_URL", "https://bill-e-backend-lfwp.onrender.com")
    redirect_uri = f"{backend_url}/api/auth/{provider}/callback"

    token_response = await oauth_auth.exchange_code_for_token(
        provider=provider,
        code=code,
        redirect_uri=redirect_uri
    )

    if not token_response:
        return RedirectResponse(f"{frontend_url}/auth/error?error=token_exchange_failed")

    access_token = token_response.get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend_url}/auth/error?error=no_access_token")

    # Get user info
    user_info = await oauth_auth.get_user_info(provider, access_token)
    if not user_info:
        return RedirectResponse(f"{frontend_url}/auth/error?error=user_info_failed")

    # Create or find user in database
    if postgres_available:
        user = postgres_db.find_or_create_user(
            provider=provider,
            provider_id=user_info["provider_id"],
            email=user_info["email"],
            name=user_info.get("name"),
            picture_url=user_info.get("picture_url"),
            device_id=device_id
        )

        if user:
            # Check premium status by email (new simplified system)
            email = user_info["email"]
            premium_status = check_premium_by_email(redis_client, email)
            is_premium = premium_status.get("is_premium", False)

            # Merge anonymous device's free-tier counter into this user.
            # Best-effort: a failure here shouldn't block the login.
            if device_id:
                try:
                    import free_tier
                    free_tier.merge_device_into_user(
                        redis_client,
                        user_id=str(user["id"]),
                        device_id=device_id,
                    )
                except Exception as e:
                    print(f"OAuth callback: free-tier merge failed: {e}")

            # Create session token
            session_token = oauth_auth.create_session_token(
                user_id=user["id"],
                provider=provider,
                email=user["email"]
            )

            # Redirect to frontend with token and premium status
            redirect_url = redirect_to or f"{frontend_url}/auth/success"
            separator = "&" if "?" in redirect_url else "?"
            return RedirectResponse(
                f"{redirect_url}{separator}token={session_token}&user_id={user['id']}&is_premium={is_premium}"
            )

    return RedirectResponse(f"{frontend_url}/auth/error?error=database_error")


@app.post("/api/auth/verify")
async def verify_auth_token(request: Request):
    """Verify a session token and return user info."""
    if not auth_available:
        raise HTTPException(status_code=503, detail="Authentication not available")

    try:
        body = await request.json()
        token = body.get("token")

        if not token:
            raise HTTPException(status_code=400, detail="Token required")

        payload = oauth_auth.verify_session_token(token)

        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        # Get fresh user data
        user_data = None
        if postgres_available:
            user_data = postgres_db.get_user_by_id(payload["user_id"])

        # Also check Redis for premium status (primary source of truth)
        email = payload.get("email") or (user_data.get("email") if user_data else None)
        if email:
            premium_status = check_premium_by_email(redis_client, email)
            redis_is_premium = premium_status.get("is_premium", False)
        else:
            redis_is_premium = False

        if user_data:
            # Use PostgreSQL data but override premium with Redis if Redis says premium
            if redis_is_premium and not user_data.get("is_premium"):
                user_data["is_premium"] = True
                user_data["premium_expires"] = premium_status.get("premium_expires")
            return {
                "valid": True,
                "user": user_data
            }

        return {
            "valid": True,
            "user": {
                "id": payload["user_id"],
                "provider": payload["provider"],
                "email": payload["email"],
                "is_premium": redis_is_premium
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# DEBUG ENDPOINTS (remove in production)
# ============================================================================

@app.delete("/api/debug/premium/{email}")
async def debug_delete_premium(email: str):
    """
    DEBUG: Delete premium status for an email.
    Removes from both Redis and PostgreSQL.
    """
    email_normalized = email.lower().strip()
    results = {
        "email": email_normalized,
        "redis_deleted": False,
        "postgres_updated": False
    }

    # Delete from Redis
    redis_key = f"premium_email:{email_normalized}"
    deleted = redis_client.delete(redis_key)
    results["redis_deleted"] = deleted > 0
    results["redis_key"] = redis_key

    # Update PostgreSQL
    if postgres_available:
        try:
            from sqlalchemy import update
            with postgres_db.get_db() as db:
                if db:
                    user = db.query(postgres_db.User).filter(
                        postgres_db.User.email == email_normalized
                    ).first()
                    if user:
                        user.is_premium = False
                        user.premium_expires = None
                        db.flush()
                        results["postgres_updated"] = True
                        results["user_id"] = str(user.id)
        except Exception as e:
            results["postgres_error"] = str(e)

    print(f"DEBUG: Deleted premium for {email_normalized}: {results}")
    return results


@app.get("/api/debug/premium/{email}")
async def debug_check_premium(email: str):
    """
    DEBUG: Check premium status for an email.
    """
    email_normalized = email.lower().strip()
    results = {
        "email": email_normalized,
        "redis": None,
        "postgres": None
    }

    # Check Redis
    redis_key = f"premium_email:{email_normalized}"
    redis_data = redis_client.get(redis_key)
    if redis_data:
        results["redis"] = json.loads(redis_data)

    # Check PostgreSQL
    if postgres_available:
        try:
            user = postgres_db.get_user_by_email(email_normalized)
            if user:
                results["postgres"] = {
                    "id": user.get("id"),
                    "is_premium": user.get("is_premium"),
                    "premium_expires": user.get("premium_expires")
                }
        except Exception as e:
            results["postgres_error"] = str(e)

    return results


@app.post("/api/debug/payment/{commerce_order}/mark-paid")
async def debug_mark_payment_paid(commerce_order: str):
    """
    DEBUG: Manually mark a payment as paid.
    Use when webhook didn't update the payment record.
    """
    payment_json = redis_client.get(f"payment:{commerce_order}")
    if not payment_json:
        raise HTTPException(status_code=404, detail="Payment not found")

    payment = json.loads(payment_json)
    payment["status"] = "paid"
    payment["paid_at"] = datetime.now().isoformat()

    # Save updated record
    ttl = redis_client.ttl(f"payment:{commerce_order}")
    redis_client.setex(
        f"payment:{commerce_order}",
        ttl if ttl > 0 else 604800,
        json.dumps(payment)
    )

    print(f"DEBUG: Manually marked payment {commerce_order} as paid")
    return {
        "commerce_order": commerce_order,
        "status": "paid",
        "message": "Payment marked as paid"
    }


@app.post("/api/auth/link-device")
async def link_device_to_account(request: Request):
    """
    Link a device_id to an authenticated user account.
    If device has premium, transfers it to the user account.
    """
    if not auth_available or not postgres_available:
        raise HTTPException(status_code=503, detail="Service not available")

    try:
        body = await request.json()
        token = body.get("token")
        device_id = body.get("device_id")

        if not token or not device_id:
            raise HTTPException(status_code=400, detail="Token and device_id required")

        payload = oauth_auth.verify_session_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        user_id = payload["user_id"]

        # Link device
        result = postgres_db.link_device_to_user(user_id, device_id)
        if not result:
            raise HTTPException(status_code=404, detail="User not found")

        # Try to transfer premium from device to user
        transfer_result = postgres_db.transfer_premium_to_user(user_id, device_id)

        return {
            "success": True,
            "user_id": user_id,
            "device_linked": device_id,
            "premium_transferred": transfer_result.get("transferred_from_device") is not None if transfer_result else False
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/auth/restore-premium")
async def restore_premium_to_device(request: Request):
    """
    Restore premium from user account to current device.
    Used when user signs in on a new device.
    """
    if not auth_available or not postgres_available:
        raise HTTPException(status_code=503, detail="Service not available")

    try:
        body = await request.json()
        token = body.get("token")
        device_id = body.get("device_id")

        if not token or not device_id:
            raise HTTPException(status_code=400, detail="Token and device_id required")

        payload = oauth_auth.verify_session_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        user_id = payload["user_id"]

        # Restore premium to device
        result = postgres_db.restore_premium_to_device(user_id, device_id)

        if not result:
            raise HTTPException(status_code=404, detail="User not found")

        if not result.get("success"):
            return {
                "success": False,
                "error": result.get("error", "Could not restore premium")
            }

        # Postgres holds the source of truth; check_premium_by_email warms
        # the Redis cache lazily on the next paywall query.

        return {
            "success": True,
            "device_id": device_id,
            "premium_expires": result.get("premium_expires")
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/auth/me")
async def get_current_user(authorization: str = None):
    """Get current user info from session token."""
    if not auth_available:
        raise HTTPException(status_code=503, detail="Authentication not available")

    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")

    # Extract token from "Bearer <token>"
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization

    payload = oauth_auth.verify_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if postgres_available:
        user = postgres_db.get_user_by_id(payload["user_id"])
        if user:
            return user

    return {
        "id": payload["user_id"],
        "provider": payload["provider"],
        "email": payload["email"]
    }


@app.post("/api/auth/claim-device")
async def claim_device(request: Request):
    """
    Add the caller's current device_id to user.device_ids and backfill
    snapshot.user_id for all anonymous bills created on that device.
    Used to recover bills that were created anonymously on a device the
    user has now decided to associate with their account.
    """
    if not auth_available or not postgres_available:
        raise HTTPException(status_code=503, detail="Service not available")

    try:
        body = await request.json()
        token = body.get("token")
        device_id = body.get("device_id")

        if not token or not device_id:
            raise HTTPException(status_code=400, detail="token and device_id required")

        payload = oauth_auth.verify_session_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        user_id = payload["user_id"]

        link_result = postgres_db.link_device_to_user(user_id, device_id)
        if not link_result:
            raise HTTPException(status_code=404, detail="User not found")

        backfilled = postgres_db.backfill_snapshots_user_id(user_id, device_id)

        return {
            "linked": True,
            "device_count": len(link_result.get("device_ids", [])),
            "device_ids": link_result.get("device_ids", []),
            "snapshots_backfilled": backfilled,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claim device failed: {e}")


@app.get("/api/debug/auth-status")
async def debug_auth_status(token: str = None, device_id: str = None):
    """
    Diagnostic endpoint: shows which devices are linked to the user account
    and which session snapshots are reachable through the current query logic.
    Helps diagnose 'I see N bills here but M bills there' issues.
    """
    if not auth_available or not postgres_available:
        raise HTTPException(status_code=503, detail="Service not available")

    if not token:
        raise HTTPException(status_code=400, detail="token query param required")

    payload = oauth_auth.verify_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload["user_id"]

    try:
        from sqlalchemy import or_, cast
        from sqlalchemy.dialects.postgresql import JSONB

        with postgres_db.get_db() as db:
            if db is None:
                raise HTTPException(status_code=503, detail="Database unavailable")

            uid = uuid.UUID(user_id)
            user_row = db.query(postgres_db.User).filter(postgres_db.User.id == uid).first()
            if not user_row:
                raise HTTPException(status_code=404, detail="User not found")

            linked_devices = list(user_row.device_ids or [])

            # Snapshots accessible via the existing query logic
            conditions = [postgres_db.SessionSnapshot.host_device_id == d for d in linked_devices]
            conditions.append(postgres_db.SessionSnapshot.user_id == uid)
            conditions.append(
                cast(postgres_db.SessionSnapshot.participants, JSONB).contains([{"user_id": str(uid)}])
            )
            visible = (
                db.query(postgres_db.SessionSnapshot)
                .filter(or_(*conditions))
                .filter(postgres_db.SessionSnapshot.status == postgres_db.SessionStatus.FINALIZED)
                .all()
            ) if conditions else []

            visible_summary = []
            for s in visible:
                methods = []
                if s.host_device_id and s.host_device_id in linked_devices:
                    methods.append("linked_device")
                if s.user_id and s.user_id == uid:
                    methods.append("snapshot_user_id")
                if not methods:
                    methods.append("participant_user_id")
                visible_summary.append({
                    "session_id": s.session_id,
                    "host_device_id": s.host_device_id,
                    "snapshot_user_id_set": s.user_id is not None,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                    "matched_via": methods,
                })

            # Snapshots reachable only via the current localStorage device_id
            # (potential orphans not yet linked to the user)
            orphans = []
            if device_id and device_id not in linked_devices:
                orphan_rows = (
                    db.query(postgres_db.SessionSnapshot)
                    .filter(postgres_db.SessionSnapshot.host_device_id == device_id)
                    .filter(postgres_db.SessionSnapshot.status == postgres_db.SessionStatus.FINALIZED)
                    .all()
                )
                for s in orphan_rows:
                    orphans.append({
                        "session_id": s.session_id,
                        "host_device_id": s.host_device_id,
                        "snapshot_user_id_set": s.user_id is not None,
                        "created_at": s.created_at.isoformat() if s.created_at else None,
                    })

            return {
                "user_id": user_id,
                "email": payload.get("email"),
                "is_premium": bool(user_row.is_premium),
                "premium_expires": user_row.premium_expires.isoformat() if user_row.premium_expires else None,
                "linked_device_count": len(linked_devices),
                "linked_device_ids": linked_devices,
                "current_device_id": device_id,
                "current_device_is_linked": device_id in linked_devices if device_id else None,
                "visible_snapshots_count": len(visible_summary),
                "visible_snapshots": visible_summary,
                "orphan_count_for_current_device": len(orphans),
                "orphan_snapshots_for_current_device": orphans,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Debug query failed: {e}")


# ============================================================================
# Admin endpoints for failed-OCR captures
# ============================================================================

@app.get("/api/admin/failed-captures")
async def admin_list_failed_captures(
    limit: int = 500,
    _: None = Depends(verify_admin_token),
):
    """Lista capturas con metadata (sin bytes)."""
    if not postgres_available:
        raise HTTPException(status_code=503, detail="Database not available")
    limit = max(1, min(limit, 1000))
    captures = postgres_db.list_failed_captures(limit=limit)
    return {"captures": captures, "total": len(captures)}


@app.get("/api/admin/failed-captures/{capture_id}/image")
async def admin_get_failed_capture_image(
    capture_id: str,
    _: None = Depends(verify_admin_token),
):
    """Retorna los bytes binarios de la imagen capturada."""
    if not postgres_available:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        uuid.UUID(capture_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Capture not found")
    cap = postgres_db.get_failed_capture(capture_id)
    if cap is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    return Response(content=cap["image_bytes"], media_type=cap["image_mime"])


@app.delete("/api/admin/failed-captures/{capture_id}", status_code=204)
async def admin_delete_failed_capture(
    capture_id: str,
    _: None = Depends(verify_admin_token),
):
    """Borra una captura. Idempotente: 204 incluso si no existe."""
    if not postgres_available:
        raise HTTPException(status_code=503, detail="Database not available")
    try:
        uuid.UUID(capture_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Capture not found")
    postgres_db.delete_failed_capture(capture_id)
    return Response(status_code=204)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)