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

from prompt_v3 import (
    Boleta,
    PROMPT_V3,
    boleta_to_bill_e,
    flatten_schema,
)

_RESPONSE_SCHEMA = flatten_schema(Boleta.model_json_schema())  # v3 + thousand-sep override + valor_impreso fallback

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

    # Normalizar nombres primero. Tag each item with its original
    # position so we can later restore receipt order when the user
    # toggles "expand" in the review step.
    for idx, item in enumerate(items):
        item['normalized_name'] = normalize_item_name(item['name'])
        item['_orig_idx'] = idx

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

        # original_indices: one entry per UNIT, recording the receipt
        # position that unit came from. Preserves order across any
        # group↔expand cycle in the review step.
        indices = []
        for g in group:
            indices.extend([g['_orig_idx']] * (g.get('quantity', 1) or 1))

        # Consolidar el grupo
        if len(group) == 1:
            result_item = {
                **item,
                'quantity': item.get('quantity', 1),
                'original_indices': indices,
            }
            result_item.pop('normalized_name', None)
            result_item.pop('_orig_idx', None)
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

            # Preservar price_as_shown del primer item del grupo. Como los
            # items consolidados tienen el mismo precio unitario por criterio
            # de agrupacion, el valor que se imprimio en cada linea de la
            # boleta es el mismo. Usar el primero es seguro.
            price_as_shown = group[0].get('price_as_shown')

            consolidated = {
                'name': cleanest_name,
                'price': most_common_price,
                'price_as_shown': price_as_shown,
                'quantity': total_quantity,
                'original_indices': indices,
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
            # flash-lite para validacion rapida (is_receipt) — barato.
            self.model = genai.GenerativeModel('gemini-2.5-flash-lite')
            # flash para extraccion estructurada con prompt v3 — flash-lite no
            # da el accuracy necesario con el schema rico (cae a ~68%).
            self.extraction_model = genai.GenerativeModel('gemini-2.5-flash')
            logger.info("✅ Gemini OCR Service inicializado (validation=flash-lite, extraction=flash)")
        except Exception as e:
            logger.error(f"❌ Error inicializando Gemini: {str(e)}")
            self.model = None
            self.extraction_model = None

    def is_receipt(self, image_bytes: bytes) -> bool:
        """
        Quick validation to check if image is a receipt/bill.
        Uses minimal tokens for cost efficiency.

        Args:
            image_bytes: Bytes of the image

        Returns:
            True if image appears to be a receipt, False otherwise
        """
        if not self.model:
            logger.error("Gemini model no disponible para validación")
            return True  # Allow through if can't validate

        try:
            import PIL.Image
            import io
            image = PIL.Image.open(io.BytesIO(image_bytes))

            # Minimal prompt for quick validation
            prompt = "Is this image a receipt, bill, invoice, or restaurant check? Answer only YES or NO."

            logger.info("🔍 Validando si imagen es boleta...")
            response = self.model.generate_content(
                [prompt, image],
                generation_config={"temperature": 0},
            )

            if response and response.text:
                answer = response.text.strip().upper()
                is_valid = "YES" in answer or "SÍ" in answer or "SI" in answer
                logger.info(f"{'✅' if is_valid else '❌'} Validación: {answer} -> {'Es boleta' if is_valid else 'No es boleta'}")
                return is_valid

            return True  # Allow through if unclear

        except Exception as e:
            logger.error(f"❌ Error en validación de imagen: {str(e)}")
            return True  # Allow through on error

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
            response = self.model.generate_content(
                [prompt, image],
                generation_config={"temperature": 0},
            )

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
        Procesa una imagen de boleta con prompt v3 + schema estructurado.

        Pipeline:
          1) Llama a gemini-2.5-flash con PROMPT_V3 + response_schema (Boleta).
          2) Parsea el JSON estructurado, lo adapta al formato interno via boleta_to_bill_e.
          3) Aplica post-proc (tip→percent, thousand-sep, dedup).
          4) Aplica R1: needs_review solo si total mismatch O (sub mismatch SIN explicacion).

        Returns:
            Dict con total, subtotal, items, charges o None si falla.
        """
        if not self.extraction_model:
            logger.error("Gemini extraction model no disponible")
            return None

        try:
            import PIL.Image
            import io
            image = PIL.Image.open(io.BytesIO(image_bytes))

            logger.info("🤖 Enviando imagen a Gemini (flash + v3 schema)...")
            response = self.extraction_model.generate_content(
                [PROMPT_V3, image],
                generation_config={
                    "temperature": 0,
                    "response_mime_type": "application/json",
                    "response_schema": _RESPONSE_SCHEMA,
                },
            )

            if response and response.text:
                response_text = response.text.strip()
                logger.info(f"✅ Gemini retornó {len(response_text)} caracteres")
                logger.info(f"📄 Gemini RAW response:\n{response_text}")

                # Defensa: con response_mime_type=application/json el modelo
                # devuelve JSON puro, pero por si algun fallback envuelve en
                # markdown, lo limpiamos.
                if response_text.startswith('```'):
                    lines = response_text.split('\n')
                    response_text = '\n'.join(lines[1:-1])

                # NOTA: el override de thousand-sep via regex sobre response_text
                # se elimino porque ahora prompt_v3 devuelve los valores como
                # STRINGS. El adapter `boleta_to_bill_e` los inspecciona y
                # detecta el formato (separador + digitos) sobre la muestra
                # completa, sin perder precision. Ver backend/price_parser.py.

                boleta_dict = json.loads(response_text)

                # Adaptar Boleta -> formato interno Bill-e
                data = boleta_to_bill_e(boleta_dict)

                if 'total' in data and 'items' in data:
                    # Obtener modo de precio (unitario o total_linea)
                    price_mode = data.get('precio_modo') or 'unitario'
                    logger.info(f"📊 Gemini precio_modo: '{data.get('precio_modo')}' → usando: '{price_mode}'")

                    # Convertir items de Gemini al formato interno
                    items = []
                    for item in data.get('items') or []:
                        # Soportar tanto 'precio' (nuevo) como 'precio_unitario' (legacy)
                        price_from_receipt = item.get('precio') or item.get('precio_unitario') or 0
                        quantity = item.get('cantidad') or 1

                        # Calcular precio unitario para cálculos internos
                        if price_mode == 'total_linea' and quantity > 1:
                            unit_price = price_from_receipt / quantity
                        else:
                            unit_price = price_from_receipt

                        # price_as_shown = valor TAL CUAL aparece impreso en la boleta.
                        # Para v3, el adapter ya convirtio a unitario internamente, asi
                        # que `precio` no es el impreso. Usamos `_total_linea` (lo impreso
                        # en la columna numerica) cuando exista. Para v1, _total_linea
                        # no existe y caemos a price_from_receipt (igual que antes).
                        price_as_shown = item.get('_total_linea')
                        if price_as_shown is None:
                            price_as_shown = price_from_receipt

                        items.append({
                            'name': item.get('nombre') or '',
                            'price': unit_price,  # Siempre guardamos precio unitario internamente
                            'price_as_shown': price_as_shown,
                            'quantity': quantity
                        })

                    # Set de IDs de cargos referenciados como "incluidos" en items.
                    # Lo populamos solo para v3 (donde el adapter agrega `_incluye_ids`).
                    _included_charge_ids = set()
                    for it in data.get('items') or []:
                        for cid in (it.get('_incluye_ids') or []):
                            _included_charge_ids.add(cid)

                    # Convertir cargos de Gemini al formato interno.
                    # included_in_items=true marca cargos cuyo monto YA esta dentro
                    # de los precios de items (ej. IVA UE/LATAM). El frontend los
                    # oculta de la lista visual y excluye del calculo de total.
                    charges = []

                    for i, cargo in enumerate(data.get('cargos') or data.get('charges') or []):
                        nombre = cargo.get('nombre') or ''
                        valor = cargo.get('valor') or 0
                        # Soportar 'tipo' (nuevo) y 'tipo_valor' (legacy)
                        tipo = cargo.get('tipo') or cargo.get('tipo_valor') or 'fixed'
                        es_descuento = cargo.get('es_descuento') or False
                        cargo_id = cargo.get('_id')
                        included = bool(cargo_id and cargo_id in _included_charge_ids)

                        # Todos los cargos usan distribución proporcional al consumo
                        distribution = 'proportional'

                        charges.append({
                            'id': f"charge_{i}",
                            'name': nombre,
                            'value': valor,
                            'valueType': tipo,
                            'isDiscount': es_descuento,
                            'distribution': distribution,
                            'included_in_items': included,
                            'is_suggested': bool(cargo.get('es_sugerencia', False)),
                            '_valor_impreso': cargo.get('_valor_impreso'),
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

                    # Verificar si suma de items ≈ subtotal (tolerancia 2%).
                    # En v3 el adapter ya hace la conversión `precio_tipo='total' → unitario`
                    # por línea, así que NO aplicamos la heurística legacy de "dividir
                    # por qty si no cuadra" — esa rompía boletas con descuentos globales
                    # o tax incluido (donde el mismatch es por diseño, no por error de
                    # precio_modo). La decisión final de needs_review se hace en el
                    # bloque R1 más abajo.
                    tolerance = 0.02
                    diff_ratio = abs(items_sum - subtotal) / subtotal if subtotal > 0 else 0

                    needs_review = False
                    review_message = None

                    # currency_has_decimals + number_format vienen del parser
                    # deterministico (price_parser.py). NO hay defaults hardcoded
                    # — derivamos del separador real que aparece en la boleta y
                    # cuantos digitos lo siguen.
                    from price_parser import get_number_format
                    currency_has_decimals = data.get('moneda_tiene_decimales', False)
                    decimal_places = 2 if currency_has_decimals else 0

                    fmt_sep = data.get('_format_separator')
                    fmt_digits = data.get('_format_digits', 0)
                    number_format = get_number_format(fmt_sep, fmt_digits)
                    # Si no hay evidencia (digits=0 o sep desconocido),
                    # dejamos number_format=None y que el frontend use su
                    # default de locale.

                    # === R1 — needs_review con lógica conservadora ===
                    # passes_subtotal: items_sum ≈ subtotal_impreso (None si subtotal=0)
                    # passes_total: items_sum + cargos_aplicados ≈ total (None si total=0)
                    # cargos_aplicados=0 cuando items YA incluyen cargos (precios_items_incluyen_cargos).
                    # R1 conservador: pass si passes_total=True Y (passes_subtotal=True
                    # O hay razon para sub mismatch — descuento listado o tax incluido).
                    items_include_charges = bool(data.get('precios_items_incluyen_cargos', False))
                    has_discount_listed = any(c.get('isDiscount') for c in charges)
                    sub_explicado = items_include_charges or has_discount_listed

                    passes_subtotal = None
                    if subtotal and subtotal > 0:
                        passes_subtotal = (abs(items_sum - subtotal) / subtotal) <= tolerance

                    applied_charges = 0.0
                    if not items_include_charges:
                        for ch in charges:
                            # Cargos sugeridos (propina sugerida, tip suggestion)
                            # NO se suman al total — son referenciales.
                            if ch.get('is_suggested'):
                                continue
                            v = ch.get('value') or 0
                            is_disc = ch.get('isDiscount') or False
                            magnitude = abs(v) if is_disc else v
                            if ch.get('valueType') == 'percent':
                                amt = items_sum * magnitude / 100
                            else:
                                amt = magnitude
                            applied_charges += -amt if is_disc else amt
                    computed_total = items_sum + applied_charges

                    passes_total = None
                    if total and total > 0:
                        passes_total = (abs(computed_total - total) / total) <= tolerance

                    # Fallback edge case: cuando el total no cuadra Y hay cargos %
                    # cuyo cálculo (% × subtotal) no coincide con el `_valor_impreso`
                    # que reportó Gemini, usamos `_valor_impreso` como fuente de
                    # verdad. Convertimos esos cargos a fixed con ese valor y
                    # recalculamos. Esto suele pasar cuando el modelo lee bien
                    # el porcentaje pero el subtotal interno no es el mismo que
                    # la boleta usó para calcular (off-by-1 item, redondeos, etc).
                    if passes_total is False:
                        any_fixed = False
                        for ch in charges:
                            if ch.get('included_in_items'):
                                continue
                            if ch.get('valueType') != 'percent':
                                continue
                            vp = ch.get('_valor_impreso')
                            if not isinstance(vp, (int, float)) or vp <= 0:
                                continue
                            calculado = items_sum * (ch.get('value') or 0) / 100
                            if abs(calculado - vp) / vp > tolerance:
                                logger.info(
                                    f"🔧 Cargo '{ch['name']}' (%={ch['value']}) calculó ${calculado:.2f} "
                                    f"pero la boleta imprime ${vp}. Cambio a fixed con valor impreso."
                                )
                                ch['valueType'] = 'fixed'
                                ch['value'] = vp
                                any_fixed = True
                        if any_fixed:
                            # Recomputar applied_charges y passes_total con los cargos corregidos
                            applied_charges = 0.0
                            if not items_include_charges:
                                for ch in charges:
                                    if ch.get('is_suggested'):
                                        continue
                                    v = ch.get('value') or 0
                                    is_disc = ch.get('isDiscount') or False
                                    magnitude = abs(v) if is_disc else v
                                    if ch.get('valueType') == 'percent':
                                        amt = items_sum * magnitude / 100
                                    else:
                                        amt = magnitude
                                    applied_charges += -amt if is_disc else amt
                            computed_total = items_sum + applied_charges
                            passes_total = (abs(computed_total - total) / total) <= tolerance

                    if passes_total is False:
                        needs_review = True
                        review_message = (
                            f"Total calculado (${computed_total:.2f}) difiere del total impreso (${total})"
                        )
                    elif passes_subtotal is False and not sub_explicado:
                        needs_review = True
                        review_message = (
                            f"Suma de items (${items_sum}) difiere del subtotal (${subtotal}) "
                            f"y no hay descuento ni tax incluido que lo explique"
                        )
                    else:
                        needs_review = False
                        review_message = None

                    r1_applied = (
                        passes_subtotal is False and passes_total is True and sub_explicado
                    )
                    if r1_applied:
                        reason = "tax incluido en items" if items_include_charges else "descuento listado"
                        logger.info(f"✅ R1 rescató boleta: sub mismatch explicado por {reason}")

                    # Limpiar campos internos antes de exponer al frontend
                    for ch in charges:
                        ch.pop('_valor_impreso', None)

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
                        'price_mode': price_mode,  # 'unitario' o 'total_linea'
                        'decimal_places': decimal_places,
                        'number_format': number_format,
                        'merchant_name': data.get('nombre_comercio') or '',
                        'needs_review': needs_review,
                        'review_message': review_message,
                        'confidence_score': quality_score,
                        'ocr_source': 'gemini',
                        'items_include_charges': items_include_charges,
                        'r1_applied': r1_applied,
                        'validation': {
                            'quality_score': quality_score,
                            'is_valid': not needs_review,
                            'quality_level': 'verified' if not needs_review else 'review'
                        }
                    }

                    # Log items
                    logger.info(f"✅ Gemini extrajo: Total=${total}, Subtotal=${subtotal}, Items={len(items)}, Charges={len(charges)}, PriceMode={price_mode}, DecimalPlaces={decimal_places}")
                    logger.info(f"💰 Moneda tiene decimales: {currency_has_decimals} → decimal_places={decimal_places}")
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

# Instancia global del servicio (lazy initialization)
_gemini_service = None


def get_gemini_service() -> GeminiOCRService:
    """
    Lazy initialization del servicio Gemini.
    Solo se inicializa cuando se necesita, no durante el import.
    Esto permite que el servidor inicie rápido y pase los health checks de Render.
    """
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiOCRService()
    return _gemini_service


def validate_receipt(image_bytes: bytes) -> bool:
    """
    Quick validation to check if image is a receipt.

    Args:
        image_bytes: Bytes of the image

    Returns:
        True if image appears to be a receipt, False otherwise
    """
    return get_gemini_service().is_receipt(image_bytes)


def process_image(image_bytes: bytes, skip_validation: bool = False):
    """
    Procesa imagen con Gemini OCR.
    Reemplaza process_image_parallel de ocr_enhanced.py.

    Args:
        image_bytes: Bytes de la imagen

    Returns:
        Dict con resultado estructurado o raise Exception si falla
    """
    logger.info("🚀 Iniciando procesamiento con Gemini...")

    service = get_gemini_service()
    if not service.is_available():
        logger.error("❌ Gemini no disponible")
        raise Exception("Gemini OCR no disponible")

    result = service.process_image_structured(image_bytes)

    if not result or not result.get('success'):
        logger.error("❌ Resultado de Gemini no válido")
        raise Exception("No se pudo procesar la imagen")

    # Deduplicate similar items (e.g., "Chelada" appearing multiple times)
    original_items = result.get('items', [])
    deduplicated_items = deduplicate_items(original_items)
    result['items'] = deduplicated_items

    logger.info(f"✅ OCR completado: {len(deduplicated_items)} items, score: {result['validation']['quality_score']}")

    return result
