import base64
import requests
import json
import os

# Ruta a tu imagen local
IMAGE_PATH = r"C:\Users\jimen\Documents\bill-e\boleta_test.jpeg"

# Verificar que existe
if not os.path.exists(IMAGE_PATH):
    print(f"❌ Error: No se encuentra la imagen en {IMAGE_PATH}")
    print("Por favor guarda una foto de boleta en esa ruta")
    exit(1)

# Leer imagen y convertir a base64
print(f"📷 Leyendo imagen: {IMAGE_PATH}")
with open(IMAGE_PATH, 'rb') as f:
    image_bytes = f.read()
    base64_image = base64.b64encode(image_bytes).decode('utf-8')

print(f"✅ Imagen cargada: {len(image_bytes)} bytes")

# URL del backend
BACKEND_URL = "https://bill-e-backend-lfwp.onrender.com"

# Crear sesión
print("\n1️⃣ Creando sesión...")
response = requests.post(f"{BACKEND_URL}/api/session")
session_data = response.json()
session_id = session_data['session_id']
print(f"✅ Sesión creada: {session_id}")

# Subir imagen
print("\n2️⃣ Procesando imagen con OCR mejorado...")
response = requests.post(
    f"{BACKEND_URL}/api/session/{session_id}/ocr",
    json={"image": f"data:image/jpeg;base64,{base64_image}"}
)

result = response.json()

print("\n3️⃣ Resultado del OCR:")
print("=" * 60)
print(json.dumps(result, indent=2, ensure_ascii=False))
print("=" * 60)

if result.get('success'):
    data = result.get('data', {})
    validation = result.get('validation', {})

    print(f"\n📊 Resumen:")
    print(f"  Total: ${data.get('total', 0):,.0f}")
    print(f"  Subtotal: ${data.get('subtotal', 0):,.0f}")
    print(f"  Propina: ${data.get('tip', 0):,.0f}")
    print(f"  Items: {len(data.get('items', []))}")
    print(f"  Score de calidad: {validation.get('quality_score', 0)}/100")
    print(f"  Items consolidados: {validation.get('consolidated_items', 0)}")

    print(f"\n🌐 Ver en navegador:")
    print(f"  https://frontend-gonzalos-projects-20693454.vercel.app/s/{session_id}")
else:
    print(f"\n❌ Error: {result.get('error')}")
