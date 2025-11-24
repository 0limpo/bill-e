from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from database import Database
from models import SessionData
from webhook_whatsapp import verify_webhook, handle_webhook
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Bill-e API", version="1.0.0")

# CORS para el frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "bill-e-backend"}

@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Frontend obtiene datos de la sesión"""
    session = Database.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada o expirada")
    
    return session

@app.post("/api/session/{session_id}/calculate")
async def calculate_bill(session_id: str, request: Request):
    """Frontend envía la división calculada"""
    data = await request.json()
    
    session = Database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sesión expirada")
    
    # Guardar resultado
    session.result = data
    Database.save_session(session)
    
    # Aquí iría el código para enviar por WhatsApp
    # Por ahora solo guardamos
    
    return {"status": "ok", "message": "Resultado guardado"}

# Endpoints de WhatsApp Webhook (INDENTACIÓN CORREGIDA)
@app.get("/webhook/whatsapp")
async def whatsapp_webhook_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"), 
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    return await verify_webhook(hub_mode, hub_challenge, hub_verify_token)

@app.post("/webhook/whatsapp")
async def whatsapp_webhook_handle(request: Request):
    return await handle_webhook(request)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)