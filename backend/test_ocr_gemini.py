import os
import sys
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Verificar API key
api_key = os.getenv('GOOGLE_GEMINI_API_KEY')
print(f"API Key configurada: {'[OK] Si' if api_key else '[X] No'}")

if not api_key:
    print("ERROR: Necesitas configurar GOOGLE_GEMINI_API_KEY en tu archivo .env")
    sys.exit(1)

# Probar importacion
from ocr_gemini import ocr_service

print(f"Servicio disponible: {'[OK] Si' if ocr_service.is_available() else '[X] No'}")

if ocr_service.is_available():
    print("[OK] El nuevo servicio OCR esta listo para usar")
else:
    print("[X] Hubo un problema inicializando el servicio")
