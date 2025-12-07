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
import traceback
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
                print(f"❌ Error cargando credenciales: {str(e)}")
                print(traceback.format_exc())
        
        # Fallback a archivo local (para desarrollo) - pero con manejo de errores
        try:
            self.client = vision.ImageAnnotatorClient()
            print("✅ Google Vision client creado con archivo local")
        except Exception as e:
            print(f"❌ Error creando cliente de Vision: {str(e)}")
            print(traceback.format_exc())
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
            print(traceback.format_exc())

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
            print(traceback.format_exc())
            raise Exception(f"No se pudo procesar la imagen: {str(e)}")
    
    def calculate_parsing_confidence(self, total: float, subtotal: float, tip: float, items: List[Dict[str, Any]]) -> tuple:
        """
        Calcula el score de confianza del parsing y detecta problemas.

        Args:
            total: Total detectado
            subtotal: Subtotal detectado
            tip: Propina detectada
            items: Items detectados

        Returns:
            Tuple de (score 0-100, lista de problemas)
        """
        score = 100
        problems = []

        print(f"\n🔍 Calculando confianza del parsing...")

        # PROBLEMA 1: Propina = 0 (posible propina no detectada)
        if tip == 0 and total > 0:
            score -= 20
            problems.append("Propina no detectada (podría estar incluida)")
            print(f"   ⚠️ Propina = 0 (-20 puntos)")

        # PROBLEMA 2: Total == Subtotal (subtotal mal detectado)
        if abs(total - subtotal) < 100 and total > 0:
            score -= 25
            problems.append(f"Total == Subtotal (${total} == ${subtotal})")
            print(f"   ⚠️ Total == Subtotal (-25 puntos)")

        # PROBLEMA 3: Suma de items != subtotal (items faltantes o mal leídos)
        if items and subtotal > 0:
            items_sum = sum(item['price'] for item in items)
            diff_percent = abs(items_sum - subtotal) / subtotal * 100 if subtotal > 0 else 0

            if diff_percent > 10:  # Más de 10% de diferencia
                penalty = min(25, int(diff_percent))
                score -= penalty
                problems.append(f"Suma items (${items_sum}) != Subtotal (${subtotal}) - diferencia {diff_percent:.1f}%")
                print(f"   ⚠️ Suma items != subtotal: {diff_percent:.1f}% diferencia (-{penalty} puntos)")

        # PROBLEMA 4: Items duplicados con precios diferentes
        item_names = {}
        for item in items:
            name = item['name'].lower().strip()
            price = item['price']

            if name in item_names:
                # Item duplicado
                if abs(item_names[name] - price) > 100:  # Precios diferentes
                    score -= 10
                    problems.append(f"Item duplicado '{item['name']}' con precios diferentes: ${item_names[name]} vs ${price}")
                    print(f"   ⚠️ Item duplicado con precio diferente: {item['name']} (-10 puntos)")
            else:
                item_names[name] = price

        # PROBLEMA 5: Menos de 3 items cuando total > $30,000 (posibles items faltantes)
        if len(items) < 3 and total > 30000:
            score -= 15
            problems.append(f"Solo {len(items)} items detectados pero total es alto (${total})")
            print(f"   ⚠️ Pocos items ({len(items)}) para total alto ${total} (-15 puntos)")

        # PROBLEMA 6: Nombres de items muy cortos (< 3 caracteres)
        short_names = [item for item in items if len(item['name']) < 3]
        if short_names:
            penalty = min(10, len(short_names) * 5)
            score -= penalty
            problems.append(f"{len(short_names)} items con nombres muy cortos (posible OCR malo)")
            print(f"   ⚠️ {len(short_names)} items con nombres cortos (-{penalty} puntos)")

        # Asegurar que el score esté en rango 0-100
        score = max(0, min(100, score))

        print(f"📊 Score de confianza: {score}/100")
        if problems:
            print(f"   Problemas detectados: {len(problems)}")
            for problem in problems:
                print(f"      - {problem}")

        return score, problems

    def verify_receipt_with_gemini(self, text: str) -> Dict[str, Any]:
        """
        Usa Gemini para verificar y extraer datos de la boleta.

        Args:
            text: Texto extraído por OCR

        Returns:
            Dict con total, subtotal, propina e items
        """
        try:
            if not gemini_service.is_available():
                print("⚠️ Gemini no disponible para verificación")
                return None

            print("🤖 Verificando boleta con Gemini...")

            # Prompt estructurado para Gemini
            prompt = f"""Analiza este texto de una boleta chilena y extrae la siguiente información:

1. total: El monto total a pagar (número)
2. subtotal: El subtotal SIN propina (número)
3. propina: El monto de propina/servicio/tip (número, puede ser 0 si no hay)
4. items: Lista de items con nombre y precio

IMPORTANTE:
- Los números en Chile usan punto como separador de miles: $111.793 = 111793
- Si ves "PROPINA", "TIP", "SERVICIO", extrae ese monto
- Si el total es mayor que la suma de items, la diferencia probablemente es propina
- Responde SOLO en formato JSON válido, sin texto adicional

Texto de la boleta:
{text}

Formato de respuesta (JSON):
{{
    "total": 179684,
    "subtotal": 163349,
    "propina": 16335,
    "items": [
        {{"nombre": "Summer Ale 568cc", "precio": 5800}},
        {{"nombre": "Corona 355cc", "precio": 4900}}
    ]
}}"""

            # Llamar a Gemini
            import google.generativeai as genai

            # Configurar Gemini
            api_key = os.getenv('GOOGLE_GEMINI_API_KEY')
            if not api_key:
                print("⚠️ GOOGLE_GEMINI_API_KEY no configurada")
                return None

            genai.configure(api_key=api_key)
            model = genai.GenerativeModel('gemini-2.0-flash-exp')

            response = model.generate_content(prompt)
            response_text = response.text.strip()

            print(f"📄 Respuesta de Gemini:\n{response_text}")

            # Limpiar respuesta (remover markdown si existe)
            if response_text.startswith('```'):
                # Remover bloques de código markdown
                lines = response_text.split('\n')
                response_text = '\n'.join(lines[1:-1])  # Quitar primera y última línea

            # Parsear JSON
            data = json.loads(response_text)

            # Validar estructura
            if 'total' in data and 'items' in data:
                print(f"✅ Gemini verificación exitosa:")
                print(f"   Total: ${data.get('total', 0)}")
                print(f"   Subtotal: ${data.get('subtotal', 0)}")
                print(f"   Propina: ${data.get('propina', 0)}")
                print(f"   Items: {len(data.get('items', []))}")
                return data
            else:
                print("⚠️ Respuesta de Gemini no tiene estructura esperada")
                return None

        except Exception as e:
            print(f"❌ Error en verificación con Gemini: {str(e)}")
            print(traceback.format_exc())
            return None

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
            # Validar que el texto no sea None o vacío
            if text is None:
                print("⚠️ Texto vacío recibido en parse_receipt_text")
                return {'success': False, 'error': 'Texto vacío'}

            print(f"🔍 Parseando texto de boleta: {len(text)} caracteres")
            print(f"📄 Texto completo:\n{text}")
            print(f"=" * 80)

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
            items = []  # Inicializar items vacío

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
            print(f"🔍 Buscando subtotal...")
            subtotal_patterns = [
                r'subtotal\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',
                r'sub\s*total\s+(\d{1,3}(?:\.\d{3})*)',
            ]

            for i, pattern in enumerate(subtotal_patterns):
                match = re.search(pattern, text.lower())
                if match:
                    subtotal = self.parse_chilean_number(match.group(1))
                    print(f"🧾 Subtotal encontrado con patrón #{i}: ${subtotal} (texto: '{match.group(0)}')")
                    break
                else:
                    print(f"   ❌ Patrón #{i} no encontró match")
            
            # Detectar propina/tip/servicio (MEJORADO PARA BOLETAS CHILENAS)
            print(f"🔍 Buscando propina...")
            print(f"   Subtotal para validación: ${subtotal}")

            # PATRONES MEJORADOS para boletas chilenas
            tip_patterns = [
                r'(?:propina\s+sugerida|propina sugerida)[:\s]*(\d{1,2})\s*%',  # "PROPINA SUGERIDA 10%" (porcentaje)
                r'(?:propina sugerida|propina)[:\s]*\$?\s*([\d.,]+)',  # "PROPINA SUGERIDA: $16,335"
                r'(?:tip\s*incluido|tip)[:\s]*\$?\s*([\d.,]+)',         # "TIP INCLUIDO: $16,335"
                r'(?:servicio)[:\s]*\$?\s*([\d.,]+)',                    # "SERVICIO: $16,335"
                r'(?:propina|tip|servicio|service)[:\s]*\$?\s*([\d.,]+)', # Patrón original
                r'10%[:\s]*\$?\s*([\d.,]+)',                             # "10%: $16,335"
                r'(\d{1,2})%[:\s]*\$?\s*([\d.,]+)',                      # "15%: $16,335"
            ]

            tip = None
            tip_percent_detected = None

            for i, pattern in enumerate(tip_patterns):
                print(f"   Probando patrón #{i}: {pattern}")
                match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
                if match:
                    # Si el patrón incluye porcentaje (último grupo)
                    if match.lastindex == 2:  # Patrón con porcentaje capturado
                        tip_percent_detected = int(match.group(1))
                        tip_value = self.parse_chilean_number(match.group(2))
                    else:
                        tip_value = self.parse_chilean_number(match.group(1))

                    print(f"   ✅ Match encontrado: '{match.group(0)}' -> valor extraído: {tip_value}")

                    # DETECTAR SI ES UN PORCENTAJE
                    # Patrón #0 es "PROPINA SUGERIDA X%" - es porcentaje explícito
                    if i == 0:
                        # Es porcentaje explícito
                        if subtotal > 0:
                            tip_percentage = tip_value
                            tip_value = subtotal * tip_percentage / 100
                            print(f"   🧮 Porcentaje explícito detectado: {tip_percentage}% de ${subtotal} = ${tip_value}")
                        else:
                            print(f"   ⚠️ Porcentaje detectado pero no hay subtotal para calcular")
                            continue

                    # Si el valor es muy pequeño (< 100), probablemente es un PORCENTAJE
                    elif tip_value > 0 and tip_value < 100 and subtotal > 0:
                        # Verificar si es un porcentaje típico o si hay "%" cerca en el texto
                        propina_percentages = [5, 10, 15, 18, 20, 25]
                        match_text = match.group(0)

                        if tip_value in propina_percentages or '%' in match_text:
                            # Es un porcentaje, calcular el monto real
                            tip_percentage = tip_value
                            tip_value = subtotal * tip_percentage / 100
                            print(f"   🧮 Propina detectada como porcentaje: {tip_percentage}% de ${subtotal} = ${tip_value}")
                        else:
                            print(f"   ⚠️ Valor pequeño ({tip_value}) pero no parece porcentaje típico")

                    print(f"   💰 Propina calculada: ${tip_value}")

                    # VALIDACIÓN: La propina normalmente es 10-20% del subtotal
                    if subtotal and subtotal > 0 and tip_value > 0:
                        tip_percent = (tip_value / subtotal) * 100
                        print(f"   Validando: ${tip_value} es {tip_percent:.1f}% del subtotal ${subtotal}")
                        if tip_percent <= 30:  # Propina razonable
                            tip = tip_value
                            print(f"🎁 Propina detectada: ${tip} ({tip_percent:.1f}% del subtotal)")
                            break
                        else:
                            print(f"   ⚠️ Propina sospechosa: ${tip_value} ({tip_percent:.1f}% del subtotal) - ignorando")
                    elif tip_value > 0:
                        # Si no hay subtotal para validar, aceptar la propina de todas formas
                        tip = tip_value
                        print(f"🎁 Propina detectada sin validación (no hay subtotal): ${tip}")
                        break
                    else:
                        print(f"   ⚠️ No se puede validar (subtotal={subtotal}, tip_value={tip_value})")
                else:
                    print(f"   ❌ Patrón #{i} no encontró match")

            # CASO ESPECIAL 1: Si NO hay propina detectada pero HAY subtotal y total
            # Entonces: propina = total - subtotal
            print(f"🔍 Intentando calcular propina por diferencia...")
            print(f"   tip={tip}, subtotal={subtotal}, total={total}")
            if tip is None and subtotal and total:
                calculated_tip = total - subtotal
                print(f"   Calculado: {total} - {subtotal} = {calculated_tip}")
                if calculated_tip > 0 and calculated_tip < subtotal * 0.3:
                    tip = calculated_tip
                    print(f"🎁 Propina calculada: ${tip} (Total - Subtotal)")
                else:
                    print(f"   ❌ Propina calculada fuera de rango válido (debe ser > 0 y < 30% del subtotal)")

            # Extraer items individuales (ANTES de calcular confianza)
            items = self.extract_items_from_text(lines)
            print(f"📝 Items encontrados: {len(items)}")

            # CASO ESPECIAL 2: Si total == subtotal Y hay items detectados
            # Esto sugiere que el OCR no detectó el subtotal real
            # Calcular subtotal sumando items, y diferencia sería propina
            if tip is None or tip == 0:
                print(f"🔍 Verificando si total == subtotal...")
                print(f"   total={total}, subtotal={subtotal}, items={len(items)}")

                # Si total y subtotal son iguales (o muy cercanos) Y hay items
                if abs(total - subtotal) < 100 and len(items) > 0:
                    print(f"   ⚠️ Total y subtotal son iguales, recalculando desde items...")
                    # Calcular subtotal real sumando items
                    items_sum = sum(item['price'] for item in items)
                    print(f"   Suma de items: ${items_sum}")

                    if items_sum > 0 and items_sum < total:
                        # La diferencia entre total y suma de items sería la propina
                        calculated_tip = total - items_sum
                        print(f"   Calculado: {total} - {items_sum} = {calculated_tip}")

                        # Validar que sea razonable (entre 5% y 30% de los items)
                        if items_sum > 0:
                            tip_percent_of_items = (calculated_tip / items_sum) * 100
                            print(f"   Validando: ${calculated_tip} es {tip_percent_of_items:.1f}% de los items")

                            if 5 <= tip_percent_of_items <= 30:
                                tip = calculated_tip
                                subtotal = items_sum  # Actualizar subtotal al real
                                print(f"🎁 Propina calculada desde items: ${tip} ({tip_percent_of_items:.1f}%)")
                                print(f"🧾 Subtotal actualizado a suma de items: ${subtotal}")
                            else:
                                print(f"   ⚠️ Propina calculada desde items fuera de rango (5-30%)")

            # Si aún no hay tip, usar 0
            if tip is None:
                tip = 0
                print(f"⚠️ No se detectó propina, usando 0")

            # Calcular confianza del parsing
            confidence_score, problems_detected = self.calculate_parsing_confidence(total, subtotal, tip, items)

            # Verificar con Gemini si la confianza es baja
            gemini_verification_used = False
            if confidence_score < 80:
                print(f"\n⚠️ Confianza baja ({confidence_score}/100), verificando con Gemini...")
                try:
                    gemini_data = self.verify_receipt_with_gemini(text)
                except Exception as gemini_error:
                    print(f"❌ Gemini falló completamente: {str(gemini_error)}")
                    print(traceback.format_exc())
                    gemini_data = None

                if gemini_data:
                    gemini_total = gemini_data.get('total', 0)
                    gemini_subtotal = gemini_data.get('subtotal', 0)
                    gemini_tip = gemini_data.get('propina', 0)
                    gemini_items = gemini_data.get('items', [])

                    print(f"\n📊 Comparando resultados:")
                    print(f"   Regex - Total: ${total}, Subtotal: ${subtotal}, Propina: ${tip}, Items: {len(items)}")
                    print(f"   Gemini - Total: ${gemini_total}, Subtotal: ${gemini_subtotal}, Propina: ${gemini_tip}, Items: {len(gemini_items)}")

                    # Decidir qué datos usar
                    use_gemini_totals = False
                    use_gemini_items = False

                    # CRITERIO 1: Si Gemini encontró propina y regex no
                    if gemini_tip > 0 and tip == 0:
                        print(f"   ✅ Gemini encontró propina y regex no")
                        use_gemini_totals = True

                    # CRITERIO 2: Si total/subtotal de Gemini son más coherentes
                    if gemini_total > 0 and gemini_subtotal > 0:
                        gemini_calculated_tip = gemini_total - gemini_subtotal
                        # Verificar coherencia
                        if 0 < gemini_calculated_tip < gemini_subtotal * 0.3:
                            # Gemini es coherente
                            regex_coherent = (total > 0 and subtotal > 0 and 0 < total - subtotal < subtotal * 0.3)

                            if not regex_coherent:
                                print(f"   ✅ Datos de Gemini son más coherentes")
                                use_gemini_totals = True

                    # CRITERIO 3: Si Gemini tiene más items
                    if len(gemini_items) > len(items):
                        print(f"   ✅ Gemini encontró más items ({len(gemini_items)} vs {len(items)})")
                        use_gemini_items = True

                    # CRITERIO 4: Si suma de items de Gemini es más cercana al subtotal
                    if gemini_items:
                        gemini_items_sum = sum(item.get('precio', 0) for item in gemini_items)
                        regex_items_sum = sum(item['price'] for item in items) if items else 0

                        if subtotal > 0:
                            gemini_diff = abs(gemini_items_sum - subtotal)
                            regex_diff = abs(regex_items_sum - subtotal)

                            if gemini_diff < regex_diff:
                                print(f"   ✅ Items de Gemini suman más cercano al subtotal")
                                use_gemini_items = True

                    # Aplicar decisiones
                    if use_gemini_totals:
                        print(f"\n🤖 Usando totales de Gemini")
                        total = gemini_total
                        subtotal = gemini_subtotal
                        tip = gemini_tip
                        gemini_verification_used = True

                    if use_gemini_items:
                        print(f"\n🤖 Usando items de Gemini")
                        # Convertir items de Gemini al formato esperado
                        items = []
                        for i, gemini_item in enumerate(gemini_items):
                            items.append({
                                'name': gemini_item.get('nombre', f'Item {i+1}'),
                                'price': gemini_item.get('precio', 0),
                                'quantity': 1
                            })
                        gemini_verification_used = True

                    # Recalcular confianza después de usar Gemini
                    if gemini_verification_used:
                        confidence_score, problems_detected = self.calculate_parsing_confidence(total, subtotal, tip, items)
                        print(f"\n📊 Nueva confianza después de Gemini: {confidence_score}/100")
                    else:
                        print(f"\n✅ Gemini no mejoró los datos, usando resultados de regex")
                else:
                    # Gemini no disponible o falló - continuar con datos de regex
                    print(f"\n⚠️ Gemini no disponible, usando datos de regex:")
                    print(f"   Total: ${total}, Subtotal: ${subtotal}, Propina: ${tip}, Items: {len(items)}")
            else:
                print(f"\n✅ Confianza alta ({confidence_score}/100), no se necesita verificación con Gemini")

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
            
            # Log final con resumen
            print(f"\n{'='*80}")
            print(f"📊 RESUMEN DE DETECCIÓN:")
            print(f"   💰 Total: ${total}")
            print(f"   🧾 Subtotal: ${subtotal}")
            print(f"   🎁 Propina: ${tip}")
            if subtotal > 0 and tip > 0:
                tip_percent = (tip / subtotal) * 100
                print(f"   📈 Propina como % del subtotal: {tip_percent:.1f}%")
            print(f"   📝 Items encontrados: {len(items)}")
            print(f"   🔢 Números detectados: {all_numbers[:10]}")
            print(f"   🎯 Confianza: {confidence_score}/100")
            if problems_detected:
                print(f"   ⚠️ Problemas detectados: {len(problems_detected)}")
                for problem in problems_detected:
                    print(f"      - {problem}")
            if gemini_verification_used:
                print(f"   🤖 Verificado con Gemini: SÍ")
            print(f"{'='*80}\n")

            result = {
                'success': True,
                'total': total,
                'subtotal': subtotal,
                'tip': tip,
                'items': items,
                'raw_text': text,
                'confidence': 'high' if len(items) > 0 else 'medium',
                'detected_numbers': all_numbers[:10],  # Para debug
                'confidence_score': confidence_score,
                'problems_detected': problems_detected,
                'gemini_verification_used': gemini_verification_used
            }

            print(f"✅ Parsing exitoso: Total=${total}, Items={len(items)}")
            return result
            
        except Exception as e:
            print(f"❌ Error parseando boleta: {str(e)}")
            print(traceback.format_exc())
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
                    total_price = self.parse_chilean_number(next_line)
                    if 1000 <= total_price <= 200000:  # Rango ampliado para múltiples unidades
                        # Detectar cantidad al inicio de la línea: "3  Coca Cola"
                        quantity = 1
                        item_name = line

                        quantity_match = re.match(r'^(\d+)\s+(.+)$', line)
                        if quantity_match:
                            quantity = int(quantity_match.group(1))
                            item_name = quantity_match.group(2).strip()
                        else:
                            # Limpiar número al inicio si no es cantidad
                            item_name = re.sub(r'^\d+\s*', '', line).strip()

                        # Calcular precio unitario
                        unit_price = total_price / quantity if quantity > 0 else total_price

                        if len(item_name) >= 3 and 'vaso de agua' not in item_name.lower():
                            items.append({
                                'name': item_name,
                                'price': unit_price,  # Precio unitario
                                'quantity': quantity
                            })
                            if quantity > 1:
                                print(f"  📄 Item: {quantity} × {item_name} = ${total_price:,.0f} (${unit_price:,.0f} c/u)")
                            else:
                                print(f"  📄 Item: {item_name} = ${unit_price:,.0f}")
            
            # Método original como backup: "3  Coca Cola  6.000" en una sola línea
            item_pattern = r'^(\d+\s+)?(.+?)\s+(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)$'
            match = re.match(item_pattern, line)

            if match:
                quantity_str = match.group(1)
                item_name = match.group(2).strip()
                price_str = match.group(3)

                total_price = self.parse_chilean_number(price_str)
                quantity = int(quantity_str.strip()) if quantity_str else 1

                # Calcular precio unitario (el precio en la boleta es TOTAL)
                unit_price = total_price / quantity if quantity > 0 else total_price

                if 1000 <= total_price <= 200000 and len(item_name) >= 3:
                    item_name = re.sub(r'^\d+\s*', '', item_name).strip()

                    # Evitar duplicados
                    if item_name and not any(existing['name'].lower() == item_name.lower() for existing in items):
                        if 'vaso de agua' not in item_name.lower():
                            items.append({
                                'name': item_name,
                                'price': unit_price,  # Precio unitario
                                'quantity': quantity
                            })
                            if quantity > 1:
                                print(f"  📄 Item (backup): {quantity} × {item_name} = ${total_price:,.0f} (${unit_price:,.0f} c/u)")
                            else:
                                print(f"  📄 Item (backup): {item_name} = ${unit_price:,.0f}")
        
        return items
    
    def format_chilean_currency(self, amount: float) -> str:
        """Formatear moneda en estilo chileno: $111.793"""
        return f"${amount:,.0f}".replace(',', '.')

# Instancia global del servicio
ocr_service = OCRService()