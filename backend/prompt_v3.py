"""
prompt_v3.py — Esquema estructurado de Bill-e para extraccion de boletas.

NOTA SDK: el SDK legacy `google-generativeai` no acepta JSON Schema con
`$defs` / `$ref`. Pydantic v2 los genera automaticamente para clases
anidadas. Por eso exponemos `flatten_schema()` que aplana el schema
resolviendo las referencias inline.

Filosofia:
  - El modelo lee la boleta tal cual aparece (texto + valor en columna).
  - Cada linea tiene su precio_tipo (unitario o total) — flexible para boletas mixtas.
  - Cada linea puede incluir cargos/descuentos referenciados por ID.
  - Cargos pueden ser fixed, percent o per_person.
  - subtotal/total impreso son leidos literales (null si no aparecen).

MIRROR de ocr-benchmark/prompt_v3.py — re-sincronizar manualmente si cambia.
"""

import copy

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional


_ALLOWED_KEYS = {
    "type", "format", "description", "nullable", "enum",
    "maxItems", "minItems", "properties", "required", "items",
    "propertyOrdering",
}


def flatten_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Aplana y limpia el schema para el SDK legacy de Gemini.

    Hace 3 cosas:
      1) Resuelve $defs/$ref inline.
      2) Convierte anyOf con tipo null a `nullable: true` (ej. Optional[float]).
      3) Filtra a un whitelist de keys soportadas por OpenAPI 3.0 / Gemini legacy
         (remueve title, default, examples, additionalProperties, etc.).
    """
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", None) or schema.pop("definitions", None) or {}

    def resolve_props(props_dict):
        return {name: resolve(spec) for name, spec in props_dict.items()}

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref = node["$ref"]
                key = ref.split("/")[-1]
                target = defs.get(key, {})
                return resolve(target)

            if "anyOf" in node and isinstance(node["anyOf"], list):
                variants = node["anyOf"]
                non_null = [v for v in variants if v.get("type") != "null"]
                has_null = any(v.get("type") == "null" for v in variants)
                if len(non_null) == 1 and has_null:
                    inner = resolve(non_null[0])
                    inner["nullable"] = True
                    for k in ("description",):
                        if k in node and k not in inner:
                            inner[k] = node[k]
                    return inner

            out = {}
            for k, v in node.items():
                if k not in _ALLOWED_KEYS:
                    continue
                if k == "properties" and isinstance(v, dict):
                    out[k] = resolve_props(v)
                else:
                    out[k] = resolve(v)
            return out
        if isinstance(node, list):
            return [resolve(x) for x in node]
        return node

    return resolve(schema)


# ============================================================
# SCHEMA
# ============================================================

class ItemLinea(BaseModel):
    id: str = Field(description="Identificador correlativo: i1, i2, i3, ...")
    nombre: str = Field(description="Texto tal cual se indica en la boleta")
    total_linea: str = Field(description=(
        "Valor de la columna numerica como STRING, TAL CUAL aparece impreso. "
        "Conserva separadores y trailing zeros. "
        "Ej: '4.600' (no '4.6'), '4.99', '1.234.567', '38600'."
    ))
    cantidad: int = Field(description=(
        "Numero de items de cada linea. Algunas boletas agrupan los items y "
        "tendran cantidad=1 o >1. Otras boletas no agrupan y tendran todas "
        "las lineas con cantidad=1"
    ))
    precio_tipo: Literal["unitario", "total"] = Field(description=(
        "'unitario' si total_linea es el precio por unidad de cada item, "
        "'total' si los items estan agrupados y total_linea es la cantidad "
        "multiplicada por el precio unitario"
    ))
    incluye: List[str] = Field(
        default_factory=list,
        description=(
            "IDs de cargos o descuentos que YA estan incluidos en total_linea "
            "(ej: ['c1'] si el precio ya incluye el cargo c1). Lista vacia si no aplica."
        ),
    )


class Cargo(BaseModel):
    id: str = Field(description="Identificador: c1, c2, c3, ...")
    nombre: str = Field(description="Texto tal cual se indica en la boleta")
    valor: str = Field(description=(
        "Como STRING, TAL CUAL aparece impreso. Conserva separadores. "
        "fixed: monto total del cargo (ej. '5.40', '1.500'). "
        "percent: porcentaje sin simbolo % (ej. '10' para 10%, '8.875' para 8.875%). "
        "per_person: monto POR PERSONA (ej. '2.500')."
    ))
    tipo: Literal["fixed", "percent", "per_person"]
    numero_personas: Optional[int] = Field(
        default=None,
        description=(
            "Solo si tipo='per_person'. Cantidad de personas a las que se cobra. "
            "Si la boleta muestra 'cubierto: 3 pers x $2500', usa numero_personas=3 y valor='2500'. "
            "Si solo muestra el total y un valor por persona, infiere personas=total/valor_por_persona."
        ),
    )
    valor_impreso: Optional[str] = Field(
        default=None,
        description=(
            "Como STRING, TAL CUAL aparece impreso. "
            "Cuando tipo='percent' y la boleta muestra TAMBIEN el monto resultante "
            "explicito en la columna numerica (ej. linea 'Tax 18% .... $5.40'), "
            "anota aqui ese monto ('5.40'). Mantienes tipo='percent' y valor='18' igual, "
            "pero das al sistema el monto real para fallback. null si no aparece."
        ),
    )
    es_sugerencia: bool = Field(
        default=False,
        description=(
            "true cuando el cargo es una SUGERENCIA no cobrada en el total "
            "(ej. 'Propina sugerida', 'Tip suggestion', 'Gratuity suggested'). "
            "La boleta lo muestra como referencia pero NO esta sumado al total impreso. "
            "false (default) cuando el cargo SI esta cobrado y debe sumarse al total."
        ),
    )


class Descuento(BaseModel):
    id: str = Field(description="Identificador: d1, d2, d3, ...")
    nombre: str = Field(description="Texto tal cual se indica en la boleta")
    valor: str = Field(description=(
        "Como STRING, TAL CUAL aparece impreso. Valor positivo (siempre). "
        "El signo lo aplica Bill-e al ser descuento. "
        "fixed: monto total ('5.000'). percent: porcentaje ('10' para 10%)."
    ))
    tipo: Literal["fixed", "percent"]
    valor_impreso: Optional[str] = Field(
        default=None,
        description=(
            "Como STRING, TAL CUAL aparece impreso. "
            "Igual que en Cargo: cuando tipo='percent' y la boleta muestra "
            "el monto del descuento explicito en la columna numerica, anotalo aqui ('2.500'). "
            "null si no aparece."
        ),
    )


class Boleta(BaseModel):
    nombre_comercio: str = Field(description="Nombre del comercio (primeras lineas). Vacio si no se detecta.")
    items: List[ItemLinea] = Field(description="Tabla 1 de items, en el orden que aparecen en la boleta")
    subtotal_impreso: Optional[str] = Field(
        default=None,
        description=(
            "Como STRING, TAL CUAL aparece impreso. Subtotal etiquetado en la boleta. "
            "null si no aparece. NUNCA calcules un valor."
        ),
    )
    cargos: List[Cargo] = Field(description="Cargos (propina, tax, recargos, cubierto). Lista vacia si no hay.")
    descuentos: List[Descuento] = Field(description="Descuentos (promociones, cupones, descuentos por persona). Lista vacia si no hay.")
    total_impreso: Optional[str] = Field(
        default=None,
        description=(
            "Como STRING, TAL CUAL aparece impreso. Total etiquetado en la boleta. "
            "null si no aparece. NUNCA calcules un valor."
        ),
    )


# ============================================================
# PROMPT
# ============================================================

PROMPT_V3 = """Tu tarea es DIGITALIZAR esta boleta: leer fielmente cada linea
y devolver una representacion estructurada en JSON estricto siguiendo el schema.

DIGITALIZAR significa:
- Reproducir cada linea de la boleta como aparece (texto + valor numerico).
- No reordenar, no reagrupar mas alla de lo que la boleta misma agrupa.
- Si la boleta lista "2 Coca Cola $5.000" como una sola linea agrupada, tu
  tambien lo listas asi (cantidad=2, precio_tipo='total', total_linea='5.000').
- Si lista cada Coca por separado, tu tambien (2 lineas, cantidad=1 c/u).

REGLA CRITICA — VALORES NUMERICOS COMO STRINGS:
- TODOS los campos de valor (total_linea, valor, valor_impreso, subtotal_impreso,
  total_impreso) son STRINGS, NO numeros.
- Copia el valor TAL CUAL aparece impreso, sin reformatear:
  * Conserva separadores: '4.600' (no '4.6' ni '4600').
  * Conserva trailing zeros: '4.50' (no '4.5'), '4.600' (no '4.6').
  * Conserva signos negativos si aparecen: '-2.500'.
- NO interpretes formato (USD vs CLP vs EUR). Solo transcribe lo que ves.
- Si la boleta usa coma como decimal ('4,99'), usa coma. Si usa punto, usa punto.

ESTRUCTURA:
- TABLA 1 (items): cada linea con su id (i1, i2, ...), nombre tal cual la boleta,
  total_linea (valor en columna derecha COMO STRING), cantidad, precio_tipo, incluye.
- TABLA 2 (cargos + descuentos): cargos en `cargos` con id c1, c2, ...,
  descuentos en `descuentos` con id d1, d2, ...
- subtotal_impreso y total_impreso: STRINGS TAL CUAL aparecen impresos. Si no
  aparece, deja null. NUNCA calcules un valor para llenar el campo.

REGLAS POR LINEA DE ITEM:
- nombre: copia el texto tal cual aparece, sin reformatear.
- total_linea: el valor en la columna numerica alineada a la derecha.
- Si una linea NO tiene valor en la columna numerica (modificador tipo
  "EXTRA CHEESE", descripcion del item anterior, solicitud especial), NO
  la listes como item separado.
- cantidad: numero de items en la linea. Boletas que agrupan: cantidad>=1.
  Boletas que listan cada uno: cantidad=1.
- precio_tipo: 'unitario' si total_linea es el precio por unidad,
  'total' si total_linea = cantidad x precio_unitario (ya multiplicado).
  Una boleta puede tener LINEAS MIXTAS — decide por linea, no por boleta.
- incluye: si total_linea YA contiene un CARGO adentro (tax, IVA), anota el
  ID en `incluye`. Para descuentos NO uses `incluye` — ver regla de descuentos.
  Ejemplos:
    * Boleta UE/LATAM con tax incluido (cargo c1): cada item incluye=["c1"].
    * Linea sin cargos incluidos: incluye=[].

REGLAS PARA CARGOS:
- tipo 'fixed': cargo de monto fijo ("Service Charge $5.00").
- tipo 'percent': cargo en porcentaje ("Tax 8.875%"). Escala 0-100 (10 para 10%).
- tipo 'per_person': cargo por persona (cubierto, cover charge). valor = monto
  POR PERSONA. Llena tambien numero_personas.
- valor_impreso: cuando uses tipo='percent' y la boleta TAMBIEN muestra el
  monto resultante en la columna numerica (ej. linea "Tax 18% .... $5.40"),
  anota 5.40 en valor_impreso. Mantienes tipo='percent' y valor=18 igual,
  pero das al sistema el monto real para fallback. null si no aparece.
- es_sugerencia=true: cuando el cargo es una SUGERENCIA y NO esta cobrado en
  el total impreso. Patrones tipicos:
    * "Propina sugerida $3.860" (CLP)
    * "Suggested tip 18%: $5.40"
    * "Gratuity (suggested): $4.00"
    * "Tip not included" + monto sugerido
  Estos cargos los muestras al usuario como info pero NO se suman al total.
  Default es_sugerencia=false para cargos cobrados.

REGLAS PARA DESCUENTOS:
- No agregues a `descuentos` los descuentos que aparecen en la descripcion
  o linea de un item (ej: "Hoppiness IPA - 20% off"). En esos casos, anota
  `total_linea` tal cual viene impreso en el detalle (precio final con el
  descuento ya aplicado) y listo.
- Solo lista en `descuentos` cupones o descuentos globales aplicados al
  subtotal (no atados a un item especifico).
- valor SIEMPRE positivo. Bill-e aplica el signo negativo al ser descuento.
- "Cupon 10% off al subtotal" -> tipo=percent, valor=10.
- "Cupon $5.000 off al subtotal" -> tipo=fixed, valor=5000.
- valor_impreso: igual que en cargos — si la boleta muestra el monto del
  descuento explicito junto al porcentaje (ej. "10% off ... -$2.50"), anota
  2.50 en valor_impreso. null si no aparece.

REGLAS PARA SUBTOTAL/TOTAL:
- subtotal_impreso: el numero etiquetado "subtotal" (o equivalente), STRING TAL CUAL. null si no aparece.
- total_impreso: el numero etiquetado "total" (o equivalente), STRING TAL CUAL. null si no aparece.

============================================================
VERIFICACION ANTES DE DEVOLVER (importante)
============================================================

Antes de responder, VERIFICA que la matematica de la boleta cuadre:

CHECK 1 — Suma de items vs subtotal_impreso:
  - Suma cada total_linea de items (ojo: si precio_tipo='unitario',
    suma cantidad x total_linea; si precio_tipo='total', suma total_linea
    sin multiplicar).
  - Esa suma debe igualar subtotal_impreso.
  - Si no cuadra, REVISA:
    - ¿Falto un item? Mira de nuevo la imagen.
    - ¿Los precios YA incluyen tax? Lista el cargo y marca incluye=["c1"]
      en cada item.
    - ¿Algun precio mal leido? Corrigelo.

CHECK 2 — items + cargos - descuentos vs total_impreso:
  - Calcula: suma_items + suma_cargos - suma_descuentos.
  - Para items con incluye=["c1"]: NO sumes el cargo c1 otra vez (ya esta dentro).
  - Esa suma debe igualar total_impreso.
  - Si no cuadra, REVISA cargos y descuentos.

PRINCIPIO: si despues de revisar, la boleta sigue sin cuadrar y la imagen
NO te da mas informacion, devuelve los datos tal cual los leiste (no
inventes cargos genericos para forzar la matematica).

============================================================

Devuelve SOLO el JSON, sin explicaciones."""


# ============================================================
# ADAPTER: Boleta -> formato interno Bill-e
# ============================================================

def boleta_to_bill_e(boleta_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convierte la salida v3 (Boleta con strings) al JSON intermedio que entiende
    el post-procesamiento de gemini_service.py.

    Pasos:
    1) Recolecta TODOS los strings de valor (items, cargos fixed, descuentos
       fixed, subtotal, total) como muestra para detect_format.
    2) Detecta formato dominante (separador + digitos_post).
    3) Parsea cada string a float usando ese formato.
    4) Convierte estructura v3 -> formato Bill-e interno.

    NOTA: cargos/descuentos con tipo='percent' NO se incluyen en la muestra
    de deteccion (su valor es un porcentaje, no un monto en la moneda).
    """
    from price_parser import detect_format, parse_price, has_decimals

    # --- Paso 1: recolectar muestra ---
    samples = []
    for it in boleta_dict.get("items") or []:
        v = it.get("total_linea")
        if v is not None and str(v).strip():
            samples.append(str(v))
    for c in boleta_dict.get("cargos") or []:
        # Solo montos absolutos (fixed, per_person), no percent
        if c.get("tipo") in ("fixed", "per_person"):
            v = c.get("valor")
            if v is not None and str(v).strip():
                samples.append(str(v))
        # valor_impreso si existe (monto resultante del %)
        vi = c.get("valor_impreso")
        if vi is not None and str(vi).strip():
            samples.append(str(vi))
    for d in boleta_dict.get("descuentos") or []:
        if d.get("tipo") == "fixed":
            v = d.get("valor")
            if v is not None and str(v).strip():
                samples.append(str(v))
        vi = d.get("valor_impreso")
        if vi is not None and str(vi).strip():
            samples.append(str(vi))
    sub = boleta_dict.get("subtotal_impreso")
    if sub is not None and str(sub).strip():
        samples.append(str(sub))
    tot = boleta_dict.get("total_impreso")
    if tot is not None and str(tot).strip():
        samples.append(str(tot))

    # --- Paso 2: detectar formato ---
    fmt_sep, fmt_digits = detect_format(samples)
    moneda_decimales = has_decimals(fmt_sep, fmt_digits)

    def _p(s):
        """Parse helper: devuelve 0 si None/invalido (para campos que no aceptan None)."""
        if s is None:
            return 0
        val = parse_price(s, fmt_sep, fmt_digits)
        return val if val is not None else 0

    def _p_opt(s):
        """Parse helper que mantiene None si el input es None."""
        if s is None:
            return None
        return parse_price(s, fmt_sep, fmt_digits)

    def _p_percent(s):
        """
        Parse helper para campos 'percent'. Los porcentajes vienen como '10' o
        '8.875' (un numero, no en formato de moneda). NO usamos el formato
        global de la boleta — siempre interpretamos punto como decimal aqui.
        """
        if s is None:
            return 0
        try:
            return float(str(s).replace(",", "."))
        except (ValueError, TypeError):
            return 0

    # --- Paso 3: items ---
    items_internal = []
    for it in boleta_dict.get("items") or []:
        precio_tipo = it.get("precio_tipo", "unitario")
        cantidad = it.get("cantidad") or 1
        total_linea = _p(it.get("total_linea"))
        if precio_tipo == "total" and cantidad and cantidad > 0:
            precio_unitario = total_linea / cantidad
        else:
            precio_unitario = total_linea

        items_internal.append({
            "nombre": it.get("nombre") or "",
            "cantidad": cantidad,
            "precio": precio_unitario,
            "_total_linea": total_linea,
            "_precio_tipo": precio_tipo,
            "_incluye_ids": it.get("incluye") or [],
            "_id": it.get("id"),
        })

    items_raw_v3 = boleta_dict.get("items") or []
    if items_raw_v3:
        all_incluyen = all((it.get("incluye") or []) for it in items_raw_v3)
        precios_items_incluyen_cargos = all_incluyen
    else:
        precios_items_incluyen_cargos = False

    # --- Paso 4: cargos + descuentos ---
    cargos_internal = []
    for c in boleta_dict.get("cargos") or []:
        tipo = c.get("tipo", "fixed")
        if tipo == "percent":
            valor = _p_percent(c.get("valor"))
        else:
            valor = _p(c.get("valor"))

        es_sugerencia = bool(c.get("es_sugerencia", False))
        if tipo == "per_person":
            n_pers = c.get("numero_personas") or 1
            cargos_internal.append({
                "nombre": c.get("nombre") or "",
                "tipo": "fixed",
                "valor": valor * n_pers,
                "es_descuento": False,
                "es_sugerencia": es_sugerencia,
                "_per_person_valor": valor,
                "_numero_personas": n_pers,
                "_id": c.get("id"),
            })
        else:
            cargos_internal.append({
                "nombre": c.get("nombre") or "",
                "tipo": tipo,
                "valor": valor,
                "es_descuento": False,
                "es_sugerencia": es_sugerencia,
                "_id": c.get("id"),
                "_valor_impreso": _p_opt(c.get("valor_impreso")),
            })

    for d in boleta_dict.get("descuentos") or []:
        tipo = d.get("tipo", "fixed")
        if tipo == "percent":
            valor = _p_percent(d.get("valor"))
        else:
            valor = _p(d.get("valor"))
        cargos_internal.append({
            "nombre": d.get("nombre") or "",
            "tipo": tipo,
            "valor": valor,
            "es_descuento": True,
            "_id": d.get("id"),
            "_valor_impreso": _p_opt(d.get("valor_impreso")),
        })

    return {
        "nombre_comercio": boleta_dict.get("nombre_comercio") or "",
        "moneda_tiene_decimales": moneda_decimales,
        "precio_modo": "unitario",
        "precios_items_incluyen_cargos": precios_items_incluyen_cargos,
        "items": items_internal,
        "cargos": cargos_internal,
        "subtotal": _p(boleta_dict.get("subtotal_impreso")),
        "total": _p(boleta_dict.get("total_impreso")),
        # Metadata del formato detectado (util para debugging y para que el
        # frontend ajuste decimal_places consistentemente)
        "_format_separator": fmt_sep,
        "_format_digits": fmt_digits,
    }
