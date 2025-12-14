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

            # Prompt genérico para extracción de texto de recibos
            prompt = """
            Analiza esta imagen de un recibo o cuenta de restaurante.

            Extrae EXACTAMENTE la siguiente información en formato de texto plano:

            1. TOTAL (el monto total a pagar)
            2. SUBTOTAL (si está visible)
            3. PROPINA o TIP o SERVICIO (si está visible)
            4. ITEMS: Lista de todos los productos/platos con sus cantidades y precios

            IMPORTANTE:
            - Mantén los números exactamente como aparecen en el recibo
            - Preserva las cantidades que aparecen junto a cada producto
            - Lista cada item en una línea nueva
            - Formato: cantidad nombre_item - precio
            - Ejemplo: "3 Coca Cola - 6.000" (3 unidades)
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

            # Prompt con protocolo forense para extracción precisa
            prompt = """Rol: Actúa como un experto forense en auditoría de gastos y OCR.

Objetivo: Extraer con precisión matemática el Precio Unitario REAL de cada ítem en la imagen adjunta, independientemente del formato del recibo (país, moneda o idioma).

## PROTOCOLO DE RAZONAMIENTO (Chain of Thought)

Antes de generar el JSON final, ejecuta internamente estos pasos:

### 1. Análisis de Formato Numérico
Detecta el formato de puntuación usado en el recibo:
- Formato A: punto = miles, coma = decimales (1.000,50)
- Formato B: coma = miles, punto = decimales (1,000.50)
- Formato C: sin separador de miles (1000.50 o 1000,50)
Usa el subtotal/total como referencia para confirmar el formato.

### 2. Escaneo de Cantidades
Busca ítems donde la cantidad sea mayor a 1 (ej: "2x Coca Cola", "3 Pan", "Qty: 2").

### 3. Test de Hipótesis de Precio
Para ítems con cantidad > 1, analiza el precio asociado:
- Hipótesis A: Si el precio parece bajo/estándar para ese producto → es Precio Unitario
- Hipótesis B: Si el precio es alto (aprox. N veces el valor estándar) → es Total de Línea

### 4. Verificación Cruzada (Prueba de la Suma)
Suma los precios de la columna de precios.
- SI suma ≈ Subtotal del recibo → son Totales de Línea → DIVIDIR por cantidad
- SI suma ≠ Subtotal (mucho menor) → son Precios Unitarios → mantener tal cual

### 5. Validación Final
Calcula: suma_calculada = Σ(precio_unitario × cantidad)
- Si suma_calculada = subtotal → needs_review: false
- Si suma_calculada ≈ subtotal (diferencia < 5%) → needs_review: true
- Si suma_calculada ≠ subtotal (diferencia >= 5%) → needs_review: true, incluir mensaje

## INSTRUCCIONES DE EXTRACCIÓN

- Interpreta los números según el formato detectado en el paso 1
- Ignora símbolos de moneda ($, €, £, etc.)
- Si la cantidad no es explícita, asume 1
- Si el ítem tiene valor 0 o es cortesía, indica 0
- "precio" SIEMPRE debe ser el precio unitario (de 1 unidad)

## FORMATO DE RESPUESTA

Retorna SOLO JSON válido:
{
  "needs_review": false,
  "review_message": null,
  "subtotal": 101630,
  "tip": 10163,
  "total": 111793,
  "items": [
    {"nombre": "Hamburguesa", "cantidad": 2, "precio": 8500},
    {"nombre": "Bebida", "cantidad": 1, "precio": 2500}
  ]
}

Si needs_review es true, incluye review_message explicando qué revisar."""

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

                    # Extraer campos de revisión
                    needs_review = data.get('needs_review', False)
                    review_message = data.get('review_message', None)

                    result = {
                        'success': True,
                        'total': data.get('total', 0),
                        'subtotal': data.get('subtotal', 0),
                        'tip': data.get('tip', data.get('propina', 0)),
                        'items': items,
                        'needs_review': needs_review,
                        'review_message': review_message,
                        'confidence_score': 95 if not needs_review else 70
                    }

                    logger.info(f"✅ Gemini extrajo: Total=${result['total']}, Items={len(items)}, NeedsReview={needs_review}")
                    for i, it in enumerate(items[:3]):  # Mostrar primeros 3
                        unit_p = it['price'] // it['quantity'] if it['quantity'] > 0 else it['price']
                        logger.info(f"   Item {i+1}: {it['quantity']}x {it['name']} @ ${unit_p} = ${it['price']} (total línea)")

                    if review_message:
                        logger.warning(f"⚠️ Review message: {review_message}")

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
