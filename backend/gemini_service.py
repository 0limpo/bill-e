"""
Servicio de OCR usando Google Gemini como alternativa/backup a Google Vision.
Gemini es gratis hasta 1,500 requests/día y tiene mejor comprensión contextual.
"""

import os
import base64
import json
import logging
import re
from typing import Dict, Any, Optional, List
from difflib import SequenceMatcher
import google.generativeai as genai

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================
# DEDUPLICATION FUNCTIONS
# ============================================================

def similar(a: str, b: str) -> float:
    """
    Calcula similitud entre dos strings usando SequenceMatcher.
    Retorna un valor entre 0 (diferentes) y 1 (idénticos).
    """
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def normalize_item_name(name: str) -> str:
    """
    Normaliza nombre de item para comparación.
    Remueve puntos, comas, guiones, espacios extra y sufijos de descuento.
    """
    # Convertir a minúsculas
    normalized = name.lower()
    # Remover sufijos de descuento comunes
    discount_patterns = [
        r'\s*\d+%\s*de\s*descuento\s*$',  # "20% de descuento"
        r'\s*\d+x\s*de\s*descuento\s*$',   # "20x de descuento" (typo común)
        r'\s*\d+%\s*desc\.?\s*$',           # "20% desc" or "20% desc."
        r'\s*descuento\s*$',                # "descuento"
        r',?\s*\d+%\s*$',                   # ", 20%" or " 20%"
    ]
    for pattern in discount_patterns:
        normalized = re.sub(pattern, '', normalized, flags=re.IGNORECASE)
    # Remover puntos, comas, guiones al final
    normalized = re.sub(r'[.,\-)\s]+$', '', normalized)
    # Remover múltiples espacios
    normalized = re.sub(r'\s+', ' ', normalized)
    # Remover espacios al inicio/fin
    normalized = normalized.strip()
    return normalized


def deduplicate_items(items: List[Dict[str, Any]], similarity_threshold: float = 0.85) -> List[Dict[str, Any]]:
    """
    Detecta y consolida items duplicados con normalización agresiva.

    Args:
        items: Lista de items extraídos
        similarity_threshold: Umbral de similitud (0.85 = 85% similar)

    Returns:
        Lista de items deduplicados
    """
    if not items:
        return []

    # Normalizar nombres primero
    for item in items:
        item['normalized_name'] = normalize_item_name(item['name'])

    logger.info(f"🔍 Deduplicando {len(items)} items...")

    deduplicated = []
    processed_indices = set()

    for i, item in enumerate(items):
        if i in processed_indices:
            continue

        # Iniciar grupo con este item
        group = [item]
        processed_indices.add(i)

        # Buscar items similares
        for j, other_item in enumerate(items[i+1:], start=i+1):
            if j in processed_indices:
                continue

            # CRITERIO 1: Nombres normalizados idénticos
            exact_match = item['normalized_name'] == other_item['normalized_name']

            # CRITERIO 2: Similitud alta de nombres normalizados
            name_similarity = similar(item['normalized_name'], other_item['normalized_name'])

            # CRITERIO 3: Precios similares (tolerancia 5%)
            max_price = max(item['price'], other_item['price'])
            price_diff_percent = abs(item['price'] - other_item['price']) / max_price if max_price > 0 else 0
            similar_price = price_diff_percent < 0.05

            # Si nombres exactos O (muy similares Y precio similar)
            if exact_match or (name_similarity >= similarity_threshold and similar_price):
                group.append(other_item)
                processed_indices.add(j)
                logger.info(f"🔗 Agrupando: '{item['name']}' + '{other_item['name']}' (sim: {name_similarity:.2f})")

        # Consolidar el grupo
        if len(group) == 1:
            result_item = {
                **item,
                'quantity': item.get('quantity', 1),
            }
            # Remove normalized_name from output
            result_item.pop('normalized_name', None)
            deduplicated.append(result_item)
        else:
            # Tomar el nombre más limpio (el más corto sin caracteres raros)
            names_by_length = sorted([g['name'] for g in group], key=lambda x: (len(x), x.count('.')))
            cleanest_name = names_by_length[0]

            # Sumar cantidades
            total_quantity = sum(g.get('quantity', 1) for g in group)

            # Precio: usar el más común
            prices = [g['price'] for g in group]
            most_common_price = max(set(prices), key=prices.count)

            consolidated = {
                'name': cleanest_name,
                'price': most_common_price,
                'quantity': total_quantity,
            }

            deduplicated.append(consolidated)
            logger.info(f"✅ Consolidados {len(group)} items → '{cleanest_name}' x{total_quantity} @ ${most_common_price}")

    logger.info(f"✅ Deduplicación: {len(items)} → {len(deduplicated)} items")

    return deduplicated

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

            # Prompt simplificado - extracción de datos, validación en Python
            prompt = """Extrae los datos de esta boleta y retorna JSON:

{
  "items": [
    {"nombre": "Coca Cola", "cantidad": 2, "precio_unitario": 4000}
  ],
  "cargos": [
    {"nombre": "Propina 10%", "tipo": "percent", "valor": 10, "es_descuento": false}
  ],
  "subtotal": 50000,
  "total": 55000
}

DEFINICIONES:
- items: productos consumidos (comida, bebida, servicios)
- precio_unitario: precio de UNA unidad. Si la boleta muestra total de línea, divide por cantidad
- cargos: todo lo que suma o resta al subtotal DESPUÉS de los items:
  * Propinas (tip, gratuity, propina sugerida)
  * Impuestos (IVA, tax, sales tax)
  * Descuentos (promo, happy hour, cupón)
  * Recargos (service charge, cover)
- tipo: "percent" si es porcentaje del subtotal, "fixed" si es monto fijo
- es_descuento: true si resta, false si suma

FORMATO NUMÉRICO:
- Números SIN separadores de miles: 13990, no 13.990
- Si el total tiene 3+ dígitos después del punto (ej: 111.793), el punto es separador de miles → 111793
- Si el total tiene 2 dígitos después del punto (ej: 111.79), el punto es decimal → 111.79

Retorna SOLO el JSON, sin explicaciones."""

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

                # Log raw response from Gemini
                logger.info(f"📄 Gemini RAW response:\n{response_text}")

                # Parsear JSON
                data = json.loads(response_text)

                # Validar estructura mínima
                if 'total' in data and 'items' in data:
                    # Convertir items de Gemini al formato interno
                    items = []
                    for item in data.get('items') or []:
                        # Soportar tanto 'precio_unitario' (nuevo) como 'precio' (legacy)
                        unit_price = item.get('precio_unitario') or item.get('precio') or 0
                        quantity = item.get('cantidad') or 1
                        items.append({
                            'name': item.get('nombre') or '',
                            'price': unit_price,
                            'quantity': quantity
                        })

                    # Convertir cargos de Gemini al formato interno
                    # Todos los cargos (propina, taxes, etc.) se manejan igual
                    charges = []

                    for i, cargo in enumerate(data.get('cargos') or data.get('charges') or []):
                        nombre = cargo.get('nombre') or ''
                        valor = cargo.get('valor') or 0
                        # Soportar 'tipo' (nuevo) y 'tipo_valor' (legacy)
                        tipo = cargo.get('tipo') or cargo.get('tipo_valor') or 'fixed'
                        es_descuento = cargo.get('es_descuento') or False

                        # Todos los cargos usan distribución proporcional al consumo
                        distribution = 'proportional'

                        charges.append({
                            'id': f"charge_{i}",
                            'name': nombre,
                            'value': valor,
                            'valueType': tipo,
                            'isDiscount': es_descuento,
                            'distribution': distribution
                        })

                    # === POST-PROCESAMIENTO: Convertir propinas fijas a porcentaje ===
                    subtotal = data.get('subtotal') or 0
                    if subtotal > 0:
                        common_percentages = [10, 15, 18, 20]
                        tip_keywords = ['propina', 'tip', 'gratuity', 'servicio']

                        for charge in charges:
                            # Solo procesar cargos fijos que parecen propinas
                            if charge['valueType'] == 'fixed' and not charge['isDiscount']:
                                is_tip = any(kw in charge['name'].lower() for kw in tip_keywords)
                                if is_tip and charge['value'] > 0:
                                    # Verificar si es un porcentaje común del subtotal
                                    for pct in common_percentages:
                                        expected = subtotal * pct / 100
                                        # Tolerancia del 1% para redondeos
                                        if abs(charge['value'] - expected) / expected < 0.01:
                                            logger.info(f"   Convirtiendo propina {charge['value']} → {pct}% del subtotal {subtotal}")
                                            charge['valueType'] = 'percent'
                                            charge['value'] = pct
                                            break

                    # === VALIDACIÓN POST-OCR ===
                    total = data.get('total') or 0

                    # Calcular suma de items
                    items_sum = sum(it['price'] * it['quantity'] for it in items)

                    # Verificar si suma de items ≈ subtotal (tolerancia 2%)
                    tolerance = 0.02
                    diff_ratio = abs(items_sum - subtotal) / subtotal if subtotal > 0 else 0

                    needs_review = False
                    review_message = None

                    if diff_ratio > tolerance and subtotal > 0:
                        # Intentar corregir: quizás los precios son totales de línea
                        # Para items con cantidad > 1, probar dividir
                        corrected_items = []
                        for it in items:
                            if it['quantity'] > 1:
                                # Probar si dividir el precio hace que cuadre mejor
                                corrected_items.append({
                                    'name': it['name'],
                                    'price': it['price'] / it['quantity'],
                                    'quantity': it['quantity']
                                })
                            else:
                                corrected_items.append(it)

                        corrected_sum = sum(it['price'] * it['quantity'] for it in corrected_items)
                        corrected_diff = abs(corrected_sum - subtotal) / subtotal if subtotal > 0 else 0

                        if corrected_diff < diff_ratio:
                            # La corrección mejoró, usar items corregidos
                            logger.info(f"🔧 Corrección aplicada: precios eran totales de línea")
                            logger.info(f"   Antes: Σitems=${items_sum}, Subtotal=${subtotal}, Diff={diff_ratio*100:.1f}%")
                            logger.info(f"   Después: Σitems=${corrected_sum}, Diff={corrected_diff*100:.1f}%")
                            items = corrected_items
                            items_sum = corrected_sum
                            diff_ratio = corrected_diff

                        # Si aún no cuadra, marcar para revisión
                        if diff_ratio > tolerance:
                            needs_review = True
                            review_message = f"Suma de items (${items_sum}) difiere del subtotal (${subtotal}) en {diff_ratio*100:.1f}%"
                            logger.warning(f"⚠️ {review_message}")

                    # Calcular decimal_places basado en si hay decimales
                    has_decimals = any(
                        (it['price'] % 1) != 0 for it in items
                    ) or (total % 1) != 0
                    decimal_places = 2 if has_decimals else 0

                    # Formato numérico por defecto (chileno)
                    number_format = {'thousands': '.', 'decimal': ','}

                    # Quality score basado en validación
                    quality_score = 100 if not needs_review else 70

                    result = {
                        'success': True,
                        'total': total,
                        'subtotal': subtotal,
                        'tip': 0,  # Propina ahora se maneja solo en charges
                        'has_tip': False,  # Desactivado - propina está en charges
                        'items': items,
                        'charges': charges,
                        'price_mode': 'original',
                        'decimal_places': decimal_places,
                        'number_format': number_format,
                        'needs_review': needs_review,
                        'review_message': review_message,
                        'confidence_score': quality_score,
                        'ocr_source': 'gemini',
                        'validation': {
                            'quality_score': quality_score,
                            'is_valid': not needs_review,
                            'quality_level': 'verified' if not needs_review else 'review'
                        }
                    }

                    # Log items
                    logger.info(f"✅ Gemini extrajo: Total=${total}, Subtotal=${subtotal}, Items={len(items)}, Charges={len(charges)}")
                    logger.info(f"📦 Items:")
                    for i, it in enumerate(items):
                        line_total = it['price'] * it['quantity']
                        logger.info(f"   {i+1}. {it['quantity']}x {it['name']} @ ${it['price']} = ${line_total}")
                    for ch in charges:
                        sign = "-" if ch['isDiscount'] else "+"
                        logger.info(f"   {sign} {ch['name']} ({ch['value']} {ch['valueType']})")
                    logger.info(f"📊 Validación: Σitems=${items_sum}, diff={diff_ratio*100:.1f}%, needs_review={needs_review}")

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


def process_image(image_bytes: bytes):
    """
    Procesa imagen con Gemini OCR.
    Reemplaza process_image_parallel de ocr_enhanced.py.

    Args:
        image_bytes: Bytes de la imagen

    Returns:
        Dict con resultado estructurado o raise Exception si falla
    """
    logger.info("🚀 Iniciando procesamiento con Gemini...")

    if not gemini_service.is_available():
        logger.error("❌ Gemini no disponible")
        raise Exception("Gemini OCR no disponible")

    result = gemini_service.process_image_structured(image_bytes)

    if not result or not result.get('success'):
        logger.error("❌ Resultado de Gemini no válido")
        raise Exception("No se pudo procesar la imagen")

    # Deduplicate similar items (e.g., "Chelada" appearing multiple times)
    original_items = result.get('items', [])
    deduplicated_items = deduplicate_items(original_items)
    result['items'] = deduplicated_items

    logger.info(f"✅ OCR completado: {len(deduplicated_items)} items, score: {result['validation']['quality_score']}")

    return result
