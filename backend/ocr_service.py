"""
Servicio OCR para procesar imágenes de boletas y extraer texto
Versión mejorada con soporte para formato chileno y credenciales directas
"""
import os
import io
import re
import json
import time
import logging
from typing import List, Dict, Any
from google.cloud import vision
from google.oauth2 import service_account
from PIL import Image
import base64
from gemini_service import gemini_service

logger = logging.getLogger(__name__)

# Import analytics
try:
    from analytics import analytics
    analytics_available = True
except ImportError:
    print("Warning: Analytics not available")
    analytics_available = False

class OCRService:
    def __init__(self):
        """Inicializar el cliente de Google Vision"""
        self.client = None
        
        # Cargar credenciales desde environment variable si está disponible
        creds_json = os.getenv('GOOGLE_APPLICATION_CREDENTIALS_JSON')
        if creds_json:
            try:
                # Parsear JSON de credenciales
                credentials_info = json.loads(creds_json)
                # Crear credenciales directamente desde el diccionario
                credentials = service_account.Credentials.from_service_account_info(credentials_info)
                self.client = vision.ImageAnnotatorClient(credentials=credentials)
                print("✅ Google Vision client creado con credenciales de environment")
                return
            except Exception as e:
                print(f"❌ Error cargando credenciales: {e}")
        
        # Fallback a archivo local (para desarrollo) - pero con manejo de errores
        try:
            self.client = vision.ImageAnnotatorClient()
            print("✅ Google Vision client creado con archivo local")
        except Exception as e:
            print(f"❌ Error creando cliente de Vision: {e}")
            print("⚠️ OCR no disponible - credenciales no encontradas")
            self.client = None
    
    def process_image(self, image_data: bytes) -> str:
        """
        Procesa una imagen usando Google Vision API con fallback a Gemini.

        Args:
            image_data: Bytes de la imagen

        Returns:
            Texto extraído de la imagen
        """
        try:
            # INTENTO 1: Google Vision (método actual)
            image = vision.Image(content=image_data)
            response = self.client.text_detection(image=image)
            texts = response.text_annotations

            if texts:
                extracted_text = texts[0].description
                print(f"✅ Google Vision extrajo {len(extracted_text)} caracteres")
                return extracted_text
            else:
                print("⚠️ Google Vision no encontró texto, intentando con Gemini...")

                # INTENTO 2: Gemini como fallback
                if gemini_service.is_available():
                    gemini_text = gemini_service.process_image(image_data)
                    if gemini_text:
                        print(f"✅ Gemini (fallback) extrajo {len(gemini_text)} caracteres")
                        return gemini_text

                # Si ambos fallan
                print("❌ Tanto Google Vision como Gemini fallaron")
                raise Exception("No se pudo extraer texto de la imagen")

        except Exception as e:
            print(f"❌ Error en OCR: {str(e)}")

            # ÚLTIMO INTENTO: Gemini si Vision falló completamente
            if gemini_service.is_available():
                print("🔄 Intentando Gemini como último recurso...")
                gemini_text = gemini_service.process_image(image_data)
                if gemini_text:
                    print(f"✅ Gemini (último recurso) extrajo {len(gemini_text)} caracteres")
                    return gemini_text

            raise Exception(f"OCR falló completamente: {str(e)}")
    
    def process_base64_image(self, base64_image: str) -> str:
        """
        Procesa una imagen en base64 con fallback a Gemini.

        Args:
            base64_image: Imagen en formato base64

        Returns:
            Texto extraído
        """
        try:
            # Limpiar prefijo data:image si existe
            if ',' in base64_image:
                base64_image = base64_image.split(',')[1]

            # Decodificar a bytes
            image_bytes = base64.b64decode(base64_image)

            # Usar función process_image que ya tiene el fallback
            return self.process_image(image_bytes)

        except Exception as e:
            print(f"❌ Error procesando base64: {str(e)}")
            raise Exception(f"No se pudo procesar la imagen: {str(e)}")
    
    def parse_chilean_number(self, num_str: str) -> float:
        """
        Parsear números en formato chileno
        
        Formato chileno: 111.793 = 111,793 (ciento once mil)
        Formato decimal: 111.79 = 111.79 (ciento once con 79 centavos)
        
        Args:
            num_str: Número como string
            
        Returns:
            float: Número parseado correctamente
        """
        if not num_str:
            return 0.0
            
        # Limpiar el string
        num_str = num_str.strip().replace('$', '').replace(',', '')
        
        try:
            # Si contiene punto
            if '.' in num_str:
                parts = num_str.split('.')
                
                # Si la parte decimal tiene exactamente 3 dígitos y hay más de una parte,
                # probablemente es formato chileno (miles)
                if len(parts) >= 2 and len(parts[-1]) == 3:
                    # Verificar si todos los grupos (excepto el primero) tienen 3 dígitos
                    is_chilean_format = True
                    for i in range(1, len(parts)):
                        if len(parts[i]) != 3:
                            is_chilean_format = False
                            break
                    
                    if is_chilean_format:
                        # Es formato chileno: eliminar puntos
                        return float(num_str.replace('.', ''))
                
                # Si no, es formato decimal normal
                return float(num_str)
            else:
                # Sin punto, número simple
                return float(num_str)
                
        except ValueError:
            print(f"No se pudo parsear número: {num_str}")
            return 0.0
    
    def parse_receipt_text(self, text: str) -> Dict[str, Any]:
        """
        Analizar el texto de la boleta y extraer información estructurada
        Mejorado para formato chileno
        
        Args:
            text: Texto extraído por OCR
            
        Returns:
            Dict con información de la boleta
        """
        try:
            print(f"🔍 Parseando texto de boleta: {len(text)} caracteres")
            
            # Normalizar texto y dividir en líneas
            lines = text.strip().split('\n')
            
            # Buscar patrones de números (incluyendo formato chileno)
            number_patterns = [
                r'\$?\s*(\d{1,3}(?:\.\d{3})+)',  # Formato chileno: 111.793
                r'\$?\s*(\d{1,6})',              # Números simples: 1234
                r'(\d{1,3}(?:\.\d{3})+)',        # Sin símbolo $: 111.793
                r'(\d+\.\d{2})',                 # Formato decimal: 111.79
            ]
            
            all_numbers = []
            for pattern in number_patterns:
                matches = re.findall(pattern, text, re.MULTILINE)
                for match in matches:
                    parsed_num = self.parse_chilean_number(match)
                    if parsed_num > 0:
                        all_numbers.append(parsed_num)
            
            # Remover duplicados y ordenar
            all_numbers = list(set(all_numbers))
            all_numbers.sort(reverse=True)
            
            # Buscar totales específicos
            total = 0
            subtotal = 0
            tip = 0
            
            # Buscar total explícito (mejorado para detectar mayúsculas)
            total_patterns = [
                r'total\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',  # "total: $111.793"
                r'total\s+(\d{1,3}(?:\.\d{3})*)',                          # "total 111.793"
                r'Total\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',   # "Total: $111.793" (mayúscula)
                r'Total\s+(\d{1,3}(?:\.\d{3})*)',                          # "Total 111.793"
                r'TOTAL\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',   # "TOTAL: $111.793"
            ]
            
            for pattern in total_patterns:
                match = re.search(pattern, text)  # Sin .lower() para detectar mayúsculas
                if match:
                    total = self.parse_chilean_number(match.group(1))
                    print(f"💰 Total encontrado: ${total}")
                    break
            
            # Si no encontró total explícito, usar el número más grande
            if total == 0 and all_numbers:
                total = max(all_numbers)
                print(f"💰 Total inferido: ${total}")
            
            # Buscar subtotal
            subtotal_patterns = [
                r'subtotal\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',
                r'sub\s*total\s+(\d{1,3}(?:\.\d{3})*)',
            ]
            
            for pattern in subtotal_patterns:
                match = re.search(pattern, text.lower())
                if match:
                    subtotal = self.parse_chilean_number(match.group(1))
                    print(f"🧾 Subtotal encontrado: ${subtotal}")
                    break
            
            # Detectar propina/tip/servicio (MEJORADO)
            tip_patterns = [
                r'(?:propina|tip|servicio|service)[:\s]*\$?\s*([\d.,]+)',
                r'(?:propina|tip)[:\s]*\$?\s*([\d.,]+)',
            ]

            tip = None
            for pattern in tip_patterns:
                match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
                if match:
                    tip_value = self.parse_chilean_number(match.group(1))
                    # VALIDACIÓN: La propina normalmente es 10-20% del subtotal
                    # Si es > 30% del subtotal, probablemente es un error
                    if subtotal and tip_value > 0:
                        tip_percent = (tip_value / subtotal) * 100
                        if tip_percent <= 30:  # Propina razonable
                            tip = tip_value
                            logger.info(f"Propina detectada: ${tip} ({tip_percent:.1f}% del subtotal)")
                            break
                        else:
                            logger.warning(f"Propina sospechosa: ${tip_value} ({tip_percent:.1f}% del subtotal) - ignorando")

            # CASO ESPECIAL: Si NO hay propina detectada pero HAY subtotal y total
            # Entonces: propina = total - subtotal
            if tip is None and subtotal and total:
                calculated_tip = total - subtotal
                if calculated_tip > 0 and calculated_tip < subtotal * 0.3:
                    tip = calculated_tip
                    logger.info(f"Propina calculada: ${tip} (Total - Subtotal)")

            # Si aún no hay tip, usar 0
            if tip is None:
                tip = 0
            
            # Calcular valores faltantes con lógica corregida
            if subtotal > 0 and tip > 0 and total == 0:
                # Si tenemos subtotal y propina, calcular total
                total = subtotal + tip
                print(f"💡 Total calculado: ${total} (${subtotal} + ${tip})")
            elif total > 0 and subtotal == 0 and tip == 0:
                # Si solo tenemos total, estimar subtotal (90%) y propina (10%)
                subtotal = total * 0.9
                tip = total * 0.1
                print(f"💡 Subtotal y propina estimados desde total")
            elif total > 0 and subtotal > 0 and tip == 0:
                # Si tenemos total y subtotal, calcular propina
                tip = total - subtotal
                print(f"💡 Propina calculada: ${tip}")
            elif subtotal == 0 and total > 0 and tip > 0:
                # Si tenemos total y propina, calcular subtotal
                subtotal = total - tip
                print(f"💡 Subtotal calculado: ${subtotal}")
            elif subtotal > 0 and tip == 0 and total == 0:
                # Si solo tenemos subtotal, estimar propina 10%
                tip = subtotal * 0.1
                total = subtotal + tip
                print(f"💡 Propina estimada 10% y total calculado")
            
            # Validación final: asegurar consistencia
            if subtotal > 0 and tip > 0:
                calculated_total = subtotal + tip
                if total == 0 or abs(total - calculated_total) > 100:
                    total = calculated_total
                    print(f"🔧 Total corregido a: ${total}")
            
            # Si aún no tenemos valores válidos, usar el número más grande como total
            if total == 0 and subtotal == 0 and all_numbers:
                total = max(all_numbers)
                subtotal = total * 0.9
                tip = total * 0.1
                print(f"⚠️ Usando número más grande como total: ${total}")
            
            # Extraer items individuales
            items = self.extract_items_from_text(lines)
            print(f"📝 Items encontrados: {len(items)}")
            
            # Validar totales contra suma de items
            if items:
                items_sum = sum(item['price'] for item in items)
                
                # Si la suma de items es significativamente diferente al subtotal,
                # usar la suma de items
                if subtotal == 0 or abs(items_sum - subtotal) < abs(items_sum - total):
                    subtotal = items_sum
                    if total == 0:
                        # Estimar propina como 10% si no se detectó
                        tip = subtotal * 0.1
                        total = subtotal + tip
            
            result = {
                'success': True,
                'total': total,
                'subtotal': subtotal,
                'tip': tip,
                'items': items,
                'raw_text': text,
                'confidence': 'high' if len(items) > 0 else 'medium',
                'detected_numbers': all_numbers[:10]  # Para debug
            }
            
            print(f"✅ Parsing exitoso: Total=${total}, Items={len(items)}")
            return result
            
        except Exception as e:
            print(f"❌ Error parseando boleta: {e}")
            return {
                'success': False,
                'error': str(e),
                'raw_text': text
            }
    
    def extract_items_from_text(self, lines: List[str]) -> List[Dict[str, Any]]:
        """
        Extraer items individuales del texto de la boleta
        Mejorado para formato chileno
        
        Args:
            lines: Líneas del texto
            
        Returns:
            Lista de items con nombre y precio
        """
        items = []
        
        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
                
            # Saltar líneas de encabezado o pie
            if any(word in line.lower() for word in [
                'cafe', 'restaurant', 'mesa', 'garzon', 'fecha', 'personas',
                'subtotal', 'total', 'propina', 'comprobante', 'boleta', 'id:'
            ]):
                continue
            
            # Método mejorado: Si una línea tiene texto y la siguiente tiene un precio
            if line and any(c.isalpha() for c in line) and i+1 < len(lines):
                next_line = lines[i+1].strip()
                # Verificar si la siguiente línea es un precio chileno
                if re.match(r'^\d{1,2}\.\d{3}$', next_line) or re.match(r'^\d{1,5}$', next_line):
                    price = self.parse_chilean_number(next_line)
                    if 1000 <= price <= 50000:  # Rango razonable para comida chilena
                        # Limpiar nombre del item
                        item_name = re.sub(r'^\d+\s*', '', line).strip()
                        if len(item_name) >= 3 and 'vaso de agua' not in item_name.lower():
                            items.append({
                                'name': item_name,
                                'price': price,
                                'quantity': 1
                            })
                            print(f"  📄 Item: {item_name} = ${price}")
            
            # Método original como backup
            item_pattern = r'^(\d+\s+)?(.+?)\s+(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)$'
            match = re.match(item_pattern, line)
            
            if match:
                quantity_str = match.group(1)
                item_name = match.group(2).strip()
                price_str = match.group(3)
                
                price = self.parse_chilean_number(price_str)
                
                if 1000 <= price <= 50000 and len(item_name) >= 3:
                    item_name = re.sub(r'^\d+\s*', '', item_name).strip()
                    
                    # Evitar duplicados
                    if item_name and not any(existing['name'].lower() == item_name.lower() for existing in items):
                        if 'vaso de agua' not in item_name.lower():
                            items.append({
                                'name': item_name,
                                'price': price,
                                'quantity': int(quantity_str.strip()) if quantity_str else 1
                            })
                            print(f"  📄 Item (backup): {item_name} = ${price}")
        
        return items
    
    def format_chilean_currency(self, amount: float) -> str:
        """Formatear moneda en estilo chileno: $111.793"""
        return f"${amount:,.0f}".replace(',', '.')

# Instancia global del servicio
ocr_service = OCRService()