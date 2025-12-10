"""
Test simple para verificar Google Vision
"""
import os
import json

def test_credentials():
    """Verificar que el archivo de credenciales existe y es válido"""
    
    # Verificar archivo
    credentials_file = "./bill-e-ocr-bce903295fd1.json"
    
    print(f"🔍 Buscando archivo: {credentials_file}")
    
    if not os.path.exists(credentials_file):
        print(f"❌ No se encontró el archivo: {credentials_file}")
        print("📂 Archivos en el directorio actual:")
        for file in os.listdir("."):
            print(f"  - {file}")
        return False
    
    print(f"✅ Archivo encontrado")
    
    # Verificar que es JSON válido
    try:
        with open(credentials_file, 'r') as f:
            data = json.load(f)
        
        required_fields = ['type', 'project_id', 'private_key', 'client_email']
        
        for field in required_fields:
            if field not in data:
                print(f"❌ Campo faltante en JSON: {field}")
                return False
        
        print(f"✅ JSON válido")
        print(f"📧 Service account: {data.get('client_email')}")
        print(f"🏷️ Project ID: {data.get('project_id')}")
        
        return True
        
    except json.JSONDecodeError as e:
        print(f"❌ El archivo no es JSON válido: {e}")
        return False
    except Exception as e:
        print(f"❌ Error leyendo archivo: {e}")
        return False

def test_google_vision():
    """Probar Google Vision API"""
    try:
        # Establecer variable de entorno
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = './bill-e-ocr-bce903295fd1.json'
        
        from google.cloud import vision
        
        print("🔍 Creando cliente de Google Vision...")
        client = vision.ImageAnnotatorClient()
        print("✅ Cliente creado exitosamente")
        
        return True
        
    except Exception as e:
        print(f"❌ Error con Google Vision: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Probando configuración de Google Vision...\n")
    
    if test_credentials():
        print("\n" + "="*50)
        if test_google_vision():
            print("\n🎉 ¡Todo configurado correctamente!")
        else:
            print("\n❌ Problemas con Google Vision API")
    else:
        print("\n❌ Problemas con el archivo de credenciales")