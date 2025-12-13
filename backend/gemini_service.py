"""
Servicio de OCR usando Google Gemini como alternativa/backup a Google Vision.
Gemini es gratis hasta 1,500 requests/día y tiene mejor comprensión contextual.
"""

import os
import base64
import json
import logging
from typing import Dict, Any, Optional
import google.generativeai as genai

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GeminiOCRService:
    def __init__(self):
        """Inicializa el servicio de Gemini con la API key."""
        self.api_key = os.getenv('GOOGLE_GEMINI_API_KEY')

        if not self.api_key:
            logger.warning("GOOGLE_GEMINI_API_KEY no encontrada. Gemini OCR no disponible.")
            self.model = None
            return

        try:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel('gemini-2.0-flash')
            logger.info("✅ Gemini OCR Service inicializado correctamente")
        except Exception as e:
            logger.error(f"❌ Error inicializando Gemini: {str(e)}")
            self.model = None

    def process_image(self, image_bytes: bytes) -> Optional[str]:
        """
        Procesa una imagen de boleta usando Gemini.

        Args:
            image_bytes: Bytes de la imagen

        Returns:
            Texto extraído de la imagen o None si falla
        """
        if not self.model:
            logger.error("Gemini model no disponible")
            return None

        try:
            # Convertir bytes a formato que Gemini entiende
            import PIL.Image
            import io
            image = PIL.Image.open(io.BytesIO(image_bytes))

            # Prompt optimizado para boletas chilenas
            prompt = """
            Analiza esta imagen de una boleta o cuenta de restaurante chilena.

            Extrae EXACTAMENTE la siguiente información en formato de texto plano:

            1. TOTAL (el monto total a pagar)
            2. SUBTOTAL (si está visible)
            3. PROPINA o TIP o SERVICIO (si está visible)
            4. ITEMS: Lista de todos los productos/platos con sus cantidades y precios

            IMPORTANTE:
            - Los precios en Chile usan PUNTO como separador de miles (ejemplo: $12.500)
            - Mantén los números exactamente como aparecen
            - Las boletas chilenas muestran: CANTIDAD  NOMBRE_PRODUCTO  PRECIO
            - PRESERVA las cantidades que aparecen antes de cada producto
            - Lista cada item en una línea nueva
            - Formato: cantidad nombre_item - $precio
            - Ejemplo: "3 Coca Cola - $6.000" (3 unidades)
            - Si no hay cantidad visible, no agregues número al inicio

            Responde SOLO con el texto extraído, sin explicaciones adicionales.
            """

            logger.info("🤖 Enviando imagen a Gemini para análisis...")
            response = self.model.generate_content([prompt, image])

            if response and response.text:
                logger.info(f"✅ Gemini extrajo {len(response.text)} caracteres")
                return response.text
            else:
                logger.warning("⚠️ Gemini no retornó texto")
                return None

        except Exception as e:
            logger.error(f"❌ Error en Gemini OCR: {str(e)}")
            return None

    def process_base64_image(self, base64_image: str) -> Optional[str]:
        """
        Procesa una imagen en formato base64.

        Args:
            base64_image: String base64 de la imagen (con o sin data URI)

        Returns:
            Texto extraído o None si falla
        """
        try:
            # Limpiar el prefijo data:image/...;base64, si existe
            if ',' in base64_image:
                base64_image = base64_image.split(',')[1]

            # Decodificar base64 a bytes
            image_bytes = base64.b64decode(base64_image)

            return self.process_image(image_bytes)

        except Exception as e:
            logger.error(f"❌ Error decodificando base64 en Gemini: {str(e)}")
            return None

    def process_image_structured(self, image_bytes: bytes) -> Optional[Dict[str, Any]]:
        """
        Procesa una imagen de boleta usando Gemini y retorna JSON estructurado.

        Args:
            image_bytes: Bytes de la imagen

        Returns:
            Dict con total, subtotal, propina e items o None si falla
        """
        if not self.model:
            logger.error("Gemini model no disponible")
            return None

        try:
            # Convertir bytes a formato que Gemini entiende
            import PIL.Image
            import io
            image = PIL.Image.open(io.BytesIO(image_bytes))

            # Prompt estructurado con análisis previo (chain of thought)
            prompt = """Eres un experto analizando boletas de restaurantes chilenos. Tu tarea es extraer información precisa.

## FASE 1: ANÁLISIS ESTRUCTURAL (razona internamente)

Antes de extraer datos, analiza la boleta:
1. ¿Qué columnas tiene? (cantidad, descripción, precio unitario, precio total línea, etc.)
2. ¿Hay encabezados de columna que indiquen qué representa cada valor?
3. El precio junto a cada item, ¿es UNITARIO o es el TOTAL DE LA LÍNEA (cantidad × unitario)?
4. ¿Dónde está el subtotal REAL (suma de items, SIN propina)?
5. ¿Hay propina/servicio/tip? ¿Está separada o incluida en algún subtotal?
6. Si hay múltiples líneas con "subtotal", ¿cuál es el correcto (sin propina)?

## FASE 2: EXTRACCIÓN

Basándote en tu análisis, extrae la información.

REGLA CRÍTICA para "precio":
- "precio" SIEMPRE debe ser el PRECIO UNITARIO de UN item
- Si la boleta muestra "3 Pan Mechada 35.970" y el 35.970 es el total de los 3:
  → Calcula: 35970 / 3 = 11990
  → Retorna: {"nombre": "Pan Mechada", "cantidad": 3, "precio": 11990}
- Si la boleta muestra "3 Pan Mechada 11.990" y el 11.990 es el precio unitario:
  → Retorna: {"nombre": "Pan Mechada", "cantidad": 3, "precio": 11990}

## VALIDACIÓN (obligatoria)

Antes de responder, verifica:
- Suma de (precio × cantidad) para todos los items ≈ subtotal declarado
- Si NO cuadra, revisa tu interpretación del precio (¿unitario o total línea?)
- Subtotal + propina ≈ total

## FORMATO DE RESPUESTA

IMPORTANTE sobre números chilenos:
- Usan PUNTO como separador de miles: $111.793 = 111793
- Convierte todos los precios a números enteros sin puntos

Responde SOLO con JSON válido (sin explicaciones):
{
    "total": 111793,
    "subtotal": 101630,
    "propina": 10163,
    "items": [
        {"nombre": "Pan Mechada", "cantidad": 3, "precio": 11990},
        {"nombre": "Coca Cola Zero", "cantidad": 2, "precio": 2000},
        {"nombre": "Ensalada", "cantidad": 1, "precio": 6500}
    ]
}"""

            logger.info("🤖 Enviando imagen a Gemini para análisis estructurado...")
            response = self.model.generate_content([prompt, image])

            if response and response.text:
                response_text = response.text.strip()
                logger.info(f"✅ Gemini retornó {len(response_text)} caracteres")

                # Limpiar respuesta (remover markdown si existe)
                if response_text.startswith('```'):
                    lines = response_text.split('\n')
                    # Remover primera línea (```json) y última (```)
                    response_text = '\n'.join(lines[1:-1])

                # Parsear JSON
                data = json.loads(response_text)

                # Validar estructura
                if 'total' in data and 'items' in data:
                    # Convertir items de Gemini al formato interno
                    # Gemini retorna precio UNITARIO, convertir a precio total de línea
                    items = []
                    for item in data.get('items', []):
                        unit_price = item.get('precio', 0)
                        quantity = item.get('cantidad', 1)
                        line_total = unit_price * quantity

                        items.append({
                            'name': item.get('nombre', ''),
                            'price': line_total,  # Precio total de la línea (unitario × cantidad)
                            'quantity': quantity
                        })

                    result = {
                        'success': True,
                        'total': data.get('total', 0),
                        'subtotal': data.get('subtotal', 0),
                        'tip': data.get('propina', 0),
                        'items': items,
                        'confidence_score': 95  # Gemini JSON tiene alta confianza
                    }

                    logger.info(f"✅ Gemini extrajo: Total=${result['total']}, Items={len(items)}")
                    for i, it in enumerate(items[:3]):  # Mostrar primeros 3
                        unit_p = it['price'] // it['quantity'] if it['quantity'] > 0 else it['price']
                        logger.info(f"   Item {i+1}: {it['quantity']}x {it['name']} @ ${unit_p} = ${it['price']} (total línea)")

                    return result
                else:
                    logger.warning("⚠️ Respuesta de Gemini no tiene estructura esperada")
                    return None
            else:
                logger.warning("⚠️ Gemini no retornó texto")
                return None

        except json.JSONDecodeError as e:
            logger.error(f"❌ Error parseando JSON de Gemini: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"❌ Error en Gemini OCR estructurado: {str(e)}")
            return None

    def is_available(self) -> bool:
        """Retorna True si el servicio está disponible."""
        return self.model is not None

# Instancia global del servicio
gemini_service = GeminiOCRService()
