"""
Servicio OCR para procesar imágenes de boletas y extraer texto
Versión mejorada con soporte para formato chileno
"""
import os
import io
import re
from typing import List, Dict, Any
from google.cloud import vision
from PIL import Image
import base64

class OCRService:
    def __init__(self):
        """Inicializar el cliente de Google Vision"""
        self.client = vision.ImageAnnotatorClient()
    
    def process_image(self, image_data: bytes) -> str:
        """
        Procesar imagen y extraer texto usando Google Vision
        
        Args:
            image_data: Datos de la imagen en bytes
            
        Returns:
            str: Texto extraído de la imagen
        """
        try:
            # Crear objeto Image para Google Vision
            image = vision.Image(content=image_data)
            
            # Detectar texto en la imagen
            response = self.client.text_detection(image=image)
            
            # Extraer el texto
            texts = response.text_annotations
            if texts:
                # El primer elemento contiene todo el texto detectado
                return texts[0].description
            
            return ""
            
        except Exception as e:
            print(f"Error en OCR: {e}")
            return ""
    
    def process_base64_image(self, base64_image: str) -> str:
        """
        Procesar imagen en formato base64
        
        Args:
            base64_image: Imagen codificada en base64
            
        Returns:
            str: Texto extraído
        """
        try:
            # Decodificar base64
            image_data = base64.b64decode(base64_image)
            return self.process_image(image_data)
        except Exception as e:
            print(f"Error procesando base64: {e}")
            return ""
    
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
            
            # Buscar subtotal
            subtotal_patterns = [
                r'subtotal\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',
                r'sub\s*total\s+(\d{1,3}(?:\.\d{3})*)',
            ]
            
            for pattern in subtotal_patterns:
                match = re.search(pattern, text.lower())
                if match:
                    subtotal = self.parse_chilean_number(match.group(1))
                    break
            
            # Buscar propina
            tip_patterns = [
                r'propina\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',
                r'tip\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',
                r'servicio\s*:?\s*\$?\s*(\d{1,3}(?:\.\d{3})*(?:\.\d{2})?)',
            ]
            
            for pattern in tip_patterns:
                match = re.search(pattern, text.lower())
                if match:
                    tip = self.parse_chilean_number(match.group(1))
                    break
            
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
            
            return {
                'success': True,
                'total': total,
                'subtotal': subtotal,
                'tip': tip,
                'items': items,
                'raw_text': text,
                'confidence': 'high' if len(items) > 0 else 'medium',
                'detected_numbers': all_numbers[:10]  # Para debug
            }
            
        except Exception as e:
            print(f"Error parseando boleta: {e}")
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
        
        return items
    
    def format_chilean_currency(self, amount: float) -> str:
        """Formatear moneda en estilo chileno: $111.793"""
        return f"${amount:,.0f}".replace(',', '.')

# Instancia global del servicio
ocr_service = OCRService()