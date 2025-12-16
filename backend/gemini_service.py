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

Objetivo: Extraer con precisión matemática todos los componentes de la boleta.

## PROTOCOLO DE RAZONAMIENTO (Chain of Thought)

### 1. Análisis de Formato Numérico (MUY IMPORTANTE)
Detecta el formato de puntuación:
- Formato A (EU/LATAM): punto = miles, coma = decimales (1.000,50)
- Formato B (US): coma = miles, punto = decimales (1,000.50)
- Formato C (Chile CLP): punto = miles, SIN decimales ($13.990 = 13990 pesos)

**DETECCIÓN DE FORMATO CHILENO:**
Si ves precios como $13.990, $4.000, $35.970 donde TODOS siguen el patrón X.XXX (número.3dígitos):
- Es formato CHILENO: el punto es separador de MILES, no hay decimales
- $13.990 = 13990 pesos (trece mil novecientos noventa)
- $4.000 = 4000 pesos (cuatro mil)
- Retorna: decimal_places=0, number_format={"thousands": ".", "decimal": ","}
- El precio en JSON debe ser el NÚMERO ENTERO: 13990, no 13.99

### 2. Escaneo de Cantidades
Busca ítems con cantidad > 1 (ej: "2x Coca Cola", "3 Pan").

### 3. Test de Hipótesis de Precio
- Si precio bajo → Precio Unitario
- Si precio alto (N veces valor estándar) → Total de Línea → DIVIDIR

### 4. Identificación de Descuentos
Busca líneas que RESTAN: "Desc.", "Discount", "-10%", "Promo", "Happy Hour", "2x1", cupones, puntos.
Determina si aplica a un ítem específico o a toda la cuenta.
Determina si los precios YA incluyen el descuento o es línea separada.

### 5. Distinción ITEMS vs CARGOS (MUY IMPORTANTE)
La regla clave es: ¿DÓNDE aparece la línea en la boleta?

**ES UN ITEM si:**
- Aparece en la sección de productos/consumo (junto a comida/bebida)
- Tiene un precio FIJO en dólares/pesos (no porcentaje)
- Ejemplos que SON ITEMS: "SERVICE $7.40", "Servicio $5.00", "Cover $3.00"

**ES UN CARGO si:**
- Aparece DESPUÉS del subtotal, en la sección de cálculos finales
- Es un PORCENTAJE aplicado al subtotal (ej: "Tax 7%", "IVA 19%")
- Ejemplos: "SALES TAX 7%", "City Tax 2%", "IVA 19%"

**VERIFICACIÓN**: Suma de items debe ≈ subtotal de la boleta
Si "SERVICE $7.40" está listado con los platos y la suma sin él no da el subtotal, entonces es un ITEM.

### 6. Verificación Cruzada
- Si price_mode="original": Σ(items) - Σ(descuentos) ≈ subtotal
- Si price_mode="discounted": Σ(items) ≈ subtotal
- subtotal + Σ(cargos) + propina ≈ total

### 7. Validación Final
- Todo cuadra (< 2%) → needs_review: false
- Diferencia > 2% → needs_review: true + mensaje

## INSTRUCCIONES

- "precio" SIEMPRE = precio unitario (de 1 unidad)
- Ignora símbolos de moneda ($, €, £)
- Si cantidad no explícita, asume 1
- FORMATO CHILENO: Si detectas formato chileno ($13.990 = 13990), retorna el número ENTERO sin punto
- OTROS FORMATOS: Si hay centavos reales (USD, EUR), retorna con decimales (12.50)
- Todos los números en JSON deben ser NUMÉRICOS (no strings)

## FORMATO DE RESPUESTA

Retorna SOLO JSON válido.

**Ejemplo formato US (con decimales):**
{
  "decimal_places": 2,
  "number_format": {"thousands": ",", "decimal": "."},
  "items": [{"nombre": "Burger", "cantidad": 1, "precio": 12.50}],
  "subtotal": 12.50, "total": 13.50
}

**Ejemplo formato CHILENO (sin decimales, punto=miles):**
Si la boleta muestra "$13.990" (trece mil novecientos noventa pesos):
{
  "decimal_places": 0,
  "number_format": {"thousands": ".", "decimal": ","},
  "items": [{"nombre": "Jarra Sangria", "cantidad": 1, "precio": 13990}],
  "subtotal": 13990, "total": 13990
}

**Estructura completa:**
{
  "needs_review": false,
  "review_message": null,
  "decimal_places": 0,
  "number_format": {"thousands": ".", "decimal": ","},
  "items": [
    {"nombre": "Jarra Sangria", "cantidad": 1, "precio": 13990},
    {"nombre": "Pan Mechada", "cantidad": 3, "precio": 35970}
  ],
  "charges": [],
  "subtotal": 121900,
  "tip": 0,
  "has_tip": false,
  "total": 121900,
  "price_mode": "original"
}

Donde:
- decimal_places: 0 si no hay decimales (ej: Chile CLP), 2 si hay centavos (ej: USD, EUR, MXN)
- number_format: formato numérico EXACTO de la boleta. thousands="," y decimal="." para formato US (1,000.50). thousands="." y decimal="," para formato EU/LATAM (1.000,50). thousands="" si no hay separador de miles.
- tipo_valor: "percent" o "fixed"
- es_descuento: true si resta, false si suma
- distribucion: "proportional" (según consumo) o "per_person" (igual para todos)
- price_mode: "original" (precios antes de descuentos) o "discounted" (ya descontados)
- has_tip: true SOLO si la boleta muestra explícitamente propina/tip/gratuity, false si no aparece"""

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
                    items = []
                    for item in data.get('items') or []:
                        unit_price = item.get('precio') or 0
                        quantity = item.get('cantidad') or 1
                        items.append({
                            'name': item.get('nombre') or '',
                            'price': unit_price,
                            'quantity': quantity
                        })

                    # Convertir charges de Gemini al formato interno
                    charges = []
                    for i, charge in enumerate(data.get('charges') or []):
                        charges.append({
                            'id': f"charge_{i}",
                            'name': charge.get('nombre') or '',
                            'value': charge.get('valor') or 0,
                            'valueType': charge.get('tipo_valor') or 'fixed',
                            'isDiscount': charge.get('es_descuento') or False,
                            'distribution': charge.get('distribucion') or 'proportional'
                        })

                    needs_review = data.get('needs_review') or False
                    review_message = data.get('review_message')
                    decimal_places = data.get('decimal_places')
                    # Auto-detect decimal_places if not provided
                    if decimal_places is None:
                        # Check if any price has decimals
                        has_decimals = any(
                            (it['price'] % 1) != 0 for it in items
                        ) or (data.get('total') or 0) % 1 != 0
                        decimal_places = 2 if has_decimals else 0

                    # Determine if receipt explicitly shows tip
                    tip_value = data.get('tip') or data.get('propina') or 0
                    has_tip = data.get('has_tip', tip_value > 0)  # True if explicitly set or tip > 0

                    # Get number format from receipt (default to US format if not detected)
                    number_format = data.get('number_format', {'thousands': ',', 'decimal': '.'})

                    result = {
                        'success': True,
                        'total': data.get('total') or 0,
                        'subtotal': data.get('subtotal') or 0,
                        'tip': tip_value,
                        'has_tip': has_tip,
                        'items': items,
                        'charges': charges,
                        'price_mode': data.get('price_mode') or 'discounted',
                        'decimal_places': decimal_places,
                        'number_format': number_format,
                        'needs_review': needs_review,
                        'review_message': review_message,
                        'confidence_score': 95 if not needs_review else 70
                    }

                    logger.info(f"✅ Gemini extrajo: Total=${result['total']}, Items={len(items)}, Charges={len(charges)}, Decimals={decimal_places}")
                    for i, it in enumerate(items[:3]):
                        line_total = it['price'] * it['quantity']
                        logger.info(f"   Item {i+1}: {it['quantity']}x {it['name']} @ ${it['price']} = ${line_total}")
                    for ch in charges:
                        sign = "-" if ch['isDiscount'] else "+"
                        logger.info(f"   Charge: {sign}{ch['name']} ({ch['value']} {ch['valueType']})")

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
