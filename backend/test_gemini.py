"""
Test simple para verificar que Gemini funciona correctamente.
"""

import sys
import os
from dotenv import load_dotenv

# Configurar encoding para emojis en Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Cargar variables de entorno ANTES de importar gemini_service
load_dotenv()

# Ahora importar gemini_service
from gemini_service import gemini_service

def test_gemini_availability():
    """Verifica que Gemini esté disponible."""
    print("🧪 Testing Gemini availability...")

    if gemini_service.is_available():
        print("✅ Gemini service está disponible")
        print(f"   API Key configurada: {os.getenv('GOOGLE_GEMINI_API_KEY')[:20]}...")
        return True
    else:
        print("❌ Gemini service NO está disponible")
        print("   Verifica que GOOGLE_GEMINI_API_KEY esté configurada en .env")
        return False

def test_gemini_simple():
    """Test básico de Gemini con texto."""
    print("\n🧪 Testing Gemini con texto simple...")

    if not gemini_service.is_available():
        print("⏭️  Saltando test - Gemini no disponible")
        return

    try:
        # Test simple sin imagen
        import google.generativeai as genai
        genai.configure(api_key=os.getenv('GOOGLE_GEMINI_API_KEY'))
        model = genai.GenerativeModel('gemini-2.0-flash-exp')

        response = model.generate_content("Di 'Hola, Bill-e funciona!'")
        print(f"✅ Gemini respondió: {response.text}")

    except Exception as e:
        print(f"❌ Error: {str(e)}")

if __name__ == "__main__":
    print("=" * 60)
    print("GEMINI OCR SERVICE TEST")
    print("=" * 60)

    test_gemini_availability()
    test_gemini_simple()

    print("\n" + "=" * 60)
    print("Test completado")
    print("=" * 60)
