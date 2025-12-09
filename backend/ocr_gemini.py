"""
Servicio OCR simplificado usando Gemini 2.0 Flash-Lite.
Reemplaza la arquitectura compleja de Vision + Gemini + Parser Regex.

Beneficios:
- 70% menos código (de 1,300+ líneas a ~200)
- 3x más barato que Vision API ($0.00044 vs $0.0015 por imagen)
- Mejor comprensión contextual (entiende la boleta, no solo extrae texto)
- Funciona con boletas de cualquier país sin necesidad de parsers específicos
"""

import os
import io
import json
import logging
import base64
from typing import Dict, Any, Optional, List
import google.generativeai as genai
from PIL import Image

logger = logging.getLogger(__name__)

class GeminiOCRService:
    """
    Servicio OCR usando Gemini 2.0 Flash-Lite.
    Más barato, más rápido, más simple.
    """
    
    def __init__(self):
        """Inicializa el servicio con la API key de Gemini."""
        self.api_key = os.getenv('GOOGLE_GEMINI_API_KEY')
        self.model = None
        
        if not self.api_key:
            logger.warning("⚠️ GOOGLE_GEMINI_API_KEY no encontrada. OCR no disponible.")
            return
        
        try:
            genai.configure(api_key=self.api_key)
            # Usar gemini-2.0-flash-lite: el más barato y rápido
            self.model = genai.GenerativeModel('gemini-2.0-flash-lite')
            logger.info("✅ Gemini OCR Service inicializado (modelo: gemini-2.0-flash-lite)")
        except Exception as e:
            logger.error(f"❌ Error inicializando Gemini: {str(e)}")
            self.model = None
    
    def is_available(self) -> bool:
        """Verifica si el servicio está disponible."""
        return self.model is not None
    
    def process_receipt(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Procesa una imagen de boleta y extrae datos estructurados.
        
        Args:
            image_bytes: Bytes de la imagen
            
        Returns:
            Dict con total, subtotal, propina, items y metadata
        """
        if not self.model:
            logger.error("❌ Modelo Gemini no disponible")
            return {
                'success': False,
                'error': 'Servicio OCR no disponible',
                'items': []
            }
        
        try:
            # Convertir bytes a imagen PIL
            image = Image.open(io.BytesIO(image_bytes))
            
            # Prompt optimizado para extraer datos de boletas
            prompt = """Analiza esta imagen de una boleta/cuenta de restaurante.

EXTRAE la siguiente información en formato JSON:

1. "total": El monto TOTAL a pagar (número entero, sin decimales)
2. "subtotal": El subtotal SIN propina (número entero)
3. "tip": La propina/servicio/tip si está visible (número entero, 0 si no hay)
4. "items": Lista de productos con nombre, cantidad y PRECIO TOTAL DE LA LÍNEA
5. "currency": La moneda detectada (CLP, USD, EUR, etc.)
6. "confidence": Tu nivel de confianza 0-100

REGLAS IMPORTANTES:
- Los precios son números ENTEROS (sin centavos para CLP)
- En Chile, el punto es separador de miles: $12.500 = 12500
- En USA/Europa, el punto es decimal: $12.50 = 1250 centavos
- Detecta el país/moneda por el formato y símbolos
- Si hay "PROPINA SUGERIDA 10%", calcula el monto
- "price" es el PRECIO TOTAL DE LA LÍNEA tal como aparece en la boleta (NO dividir por quantity)
- Ejemplo: "3 Coca Cola $6.000" → {"name": "Coca Cola", "quantity": 3, "price": 6000}
- Ejemplo: "2 Pan Mechada $23.980" → {"name": "Pan Mechada", "quantity": 2, "price": 23980}
- Si no puedes leer algo, usa 0 o string vacío

RESPONDE SOLO con JSON válido, sin explicaciones:
{
    "total": 35650,
    "subtotal": 32410,
    "tip": 3240,
    "currency": "CLP",
    "confidence": 95,
    "items": [
        {"name": "Hamburguesa", "quantity": 1, "price": 12500},
        {"name": "Coca Cola", "quantity": 2, "price": 5000},
        {"name": "Papas Fritas", "quantity": 1, "price": 4910}
    ]
}"""

            logger.info("🤖 Enviando imagen a Gemini 2.0 Flash-Lite...")
            
            # Llamar a Gemini
            response = self.model.generate_content([prompt, image])
            
            if not response or not response.text:
                logger.warning("⚠️ Gemini no retornó respuesta")
                return self._empty_result("No se pudo procesar la imagen")
            
            # Parsear respuesta JSON
            response_text = response.text.strip()
            logger.info(f"📄 Respuesta de Gemini ({len(response_text)} chars)")
            
            # Limpiar markdown si existe
            if response_text.startswith('```'):
                lines = response_text.split('\n')
                response_text = '\n'.join(lines[1:-1])
            
            # Parsear JSON
            data = json.loads(response_text)
            
            # Validar y normalizar respuesta
            result = self._normalize_result(data)
            
            # Log resumen
            logger.info(f"✅ OCR exitoso:")
            logger.info(f"   💰 Total: ${result['total']:,}")
            logger.info(f"   🧾 Subtotal: ${result['subtotal']:,}")
            logger.info(f"   🎁 Propina: ${result['tip']:,}")
            logger.info(f"   📝 Items: {len(result['items'])}")
            logger.info(f"   🎯 Confianza: {result['confidence_score']}/100")
            logger.info(f"   💱 Moneda: {result.get('currency', 'CLP')}")
            
            return result
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ Error parseando JSON de Gemini: {str(e)}")
            logger.error(f"   Respuesta raw: {response_text[:500] if 'response_text' in dir() else 'N/A'}")
            return self._empty_result(f"Error parseando respuesta: {str(e)}")
            
        except Exception as e:
            logger.error(f"❌ Error en OCR: {str(e)}")
            return self._empty_result(str(e))
    
    def process_receipt_base64(self, base64_image: str) -> Dict[str, Any]:
        """
        Procesa una imagen en formato base64.
        
        Args:
            base64_image: String base64 (con o sin prefijo data:image)
            
        Returns:
            Dict con datos de la boleta
        """
        try:
            # Limpiar prefijo data:image si existe
            if ',' in base64_image:
                base64_image = base64_image.split(',')[1]
            
            # Decodificar
            image_bytes = base64.b64decode(base64_image)
            
            return self.process_receipt(image_bytes)
            
        except Exception as e:
            logger.error(f"❌ Error decodificando base64: {str(e)}")
            return self._empty_result(f"Error en imagen: {str(e)}")
    
    def _normalize_result(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normaliza y valida el resultado de Gemini.
        
        Args:
            data: Datos crudos de Gemini
            
        Returns:
            Dict normalizado con formato consistente
        """
        # Extraer valores con defaults
        total = int(data.get('total', 0) or 0)
        subtotal = int(data.get('subtotal', 0) or 0)
        tip = int(data.get('tip', 0) or 0)
        confidence = int(data.get('confidence', 80) or 80)
        currency = data.get('currency', 'CLP')
        
        # Normalizar items
        items = []
        for item in data.get('items', []):
            normalized_item = {
                'name': str(item.get('name', '')).strip(),
                'price': int(item.get('price', 0) or 0),
                'quantity': int(item.get('quantity', 1) or 1)
            }
            # Solo agregar items válidos
            if normalized_item['name'] and normalized_item['price'] > 0:
                items.append(normalized_item)
        
        # Calcular suma de items (price ya es el total de la línea, NO multiplicar por quantity)
        items_sum = sum(item['price'] for item in items)
        
        # Auto-corregir si hay inconsistencias
        if subtotal == 0 and items_sum > 0:
            subtotal = items_sum
            logger.info(f"💡 Subtotal calculado desde items: ${subtotal:,}")
        
        if tip == 0 and total > subtotal > 0:
            tip = total - subtotal
            logger.info(f"💡 Propina calculada: ${tip:,}")
        
        if total == 0 and subtotal > 0:
            total = subtotal + tip
            logger.info(f"💡 Total calculado: ${total:,}")
        
        # Calcular diferencia entre items y subtotal declarado
        difference = abs(items_sum - subtotal) if subtotal > 0 else 0
        difference_percent = (difference / subtotal * 100) if subtotal > 0 else 0
        
        # Ajustar confianza basado en coherencia
        if difference_percent > 10:
            confidence = max(50, confidence - 20)
            logger.warning(f"⚠️ Diferencia alta ({difference_percent:.1f}%), confianza reducida a {confidence}")
        
        return {
            'success': True,
            'total': total,
            'subtotal': subtotal,
            'tip': tip,
            'items': items,
            'currency': currency,
            'confidence_score': confidence,
            'confidence': 'high' if confidence >= 80 else 'medium' if confidence >= 50 else 'low',
            'items_sum': items_sum,
            'total_difference': difference,
            'difference_percent': round(difference_percent, 1),
            'ocr_source': 'gemini-2.0-flash-lite',
            'problems_detected': []
        }
    
    def _empty_result(self, error: str) -> Dict[str, Any]:
        """Retorna un resultado vacío con error."""
        return {
            'success': False,
            'error': error,
            'total': 0,
            'subtotal': 0,
            'tip': 0,
            'items': [],
            'currency': 'CLP',
            'confidence_score': 0,
            'confidence': 'low',
            'items_sum': 0,
            'total_difference': 0,
            'difference_percent': 0,
            'ocr_source': 'gemini-2.0-flash-lite',
            'problems_detected': [error]
        }


# Instancia global del servicio
ocr_service = GeminiOCRService()


# Función de conveniencia para compatibilidad con código existente
def process_image(image_bytes: bytes) -> Dict[str, Any]:
    """Función de conveniencia para procesar imagen."""
    return ocr_service.process_receipt(image_bytes)


def process_base64_image(base64_image: str) -> Dict[str, Any]:
    """Función de conveniencia para procesar imagen base64."""
    return ocr_service.process_receipt_base64(base64_image)
