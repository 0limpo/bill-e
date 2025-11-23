import redis
from dotenv import load_dotenv
import os

load_dotenv()

print("🧪 Probando conexión a Redis/Upstash...\n")

try:
    client = redis.from_url(
        os.getenv("REDIS_URL"),
        decode_responses=True,
        ssl_cert_reqs=None
    )
    
    print("1️⃣ Test PING...")
    response = client.ping()
    print(f"   ✅ Ping exitoso: {response}\n")
    
    print("2️⃣ Test SET/GET...")
    client.set("test_bille", "¡Hola desde Bill-e! 🤖")
    value = client.get("test_bille")
    print(f"   ✅ Lectura exitosa: {value}\n")
    
    client.delete("test_bille")
    
    print("=" * 50)
    print("🎉 ¡TODO FUNCIONA PERFECTAMENTE!")
    print("=" * 50)
    
except Exception as e:
    print(f"❌ ERROR: {e}")
    print("\nVerifica:")
    print("1. Que hayas instalado: pip install redis python-dotenv")
    print("2. Que el archivo .env exista")
