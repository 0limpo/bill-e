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

            # Prompt estructurado con detección automática de formato de precios
            prompt = """Analiza esta boleta chilena y extrae los datos en JSON.

## PASO 1: Extrae los datos RAW de la boleta

Para cada item, extrae EXACTAMENTE lo que ves:
- cantidad: el número antes del nombre (si no hay, es 1)
- nombre: el nombre del producto
- precio_mostrado: el número que aparece junto al item (sin modificar)

También extrae:
- subtotal: el subtotal SIN propina
- propina: el monto de propina/tip/servicio (0 si no hay)
- total: el total final

## PASO 2: Detecta el formato de precios

Suma todos los precio_mostrado de los items.

SI suma_precios ≈ subtotal (diferencia < 5%):
  → Los precios mostrados son TOTALES DE LÍNEA
  → precio_unitario = precio_mostrado / cantidad

SI suma_precios ≠ subtotal:
  → Los precios mostrados son UNITARIOS
  → precio_unitario = precio_mostrado

## PASO 3: Genera el JSON

IMPORTANTE:
- "precio" debe ser siempre el PRECIO UNITARIO (de 1 unidad)
- Números chilenos: punto = miles ($35.970 = 35970)
- Todos los valores deben ser enteros

Ejemplo - Si la boleta muestra:
  "3 Pan Mechada 35.970" y subtotal = 101.630
  Suma de precios mostrados ≈ 101.630 → son TOTALES DE LÍNEA
  precio_unitario = 35970 / 3 = 11990
  → {"nombre": "Pan Mechada", "cantidad": 3, "precio": 11990}

Responde SOLO con JSON válido:
{
    "total": 111793,
    "subtotal": 101630,
    "propina": 10163,
    "items": [
        {"nombre": "Pan Mechada", "cantidad": 3, "precio": 11990},
        {"nombre": "Coca Cola Zero", "cantidad": 2, "precio": 2000}
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
