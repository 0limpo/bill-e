"""
Parser deterministico de strings de precio.

Filosofia:
- Gemini transcribe valores como strings, tal cual aparecen en la boleta.
- Aqui inspeccionamos la muestra completa de strings (items + cargos +
  subtotal + total) y deducimos el formato dominante (separador + digitos).
- Una vez detectado, parseamos cada string a numero usando reglas estrictas.

Formato detectado:
- digitos_post: 0, 2, o 3 (digitos despues del separador principal).
- separador_principal: '.', ',', o 'ninguno'.

Interpretacion:
- digitos_post == 2: separador es decimal. USD/EUR. has_decimals=True.
- digitos_post == 3: separador es miles. CLP/MXN. has_decimals=False.
- digitos_post == 0: sin separador, valores enteros. has_decimals=False.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import List, Literal, Optional, Tuple, Union

Separator = Literal[".", ",", "ninguno"]

# Solo aceptamos digitos, separadores y signo
_CLEAN_RE = re.compile(r"[^\d.,\-]")


def _clean(s: str) -> str:
    """Quita simbolos de moneda, espacios, etc. Conserva digitos y separadores."""
    return _CLEAN_RE.sub("", s or "").strip()


def _classify_single(s: str) -> Tuple[Separator, int]:
    """
    Inspecciona UN string y devuelve (separador_principal, digitos_post).

    El separador principal es el ULTIMO '.' o ',' que aparece. Los digitos_post
    es el numero de digitos consecutivos despues. Si no hay separadores → 'ninguno', 0.

    Ejemplos:
        '4.600'       → ('.', 3)
        '4.99'        → ('.', 2)
        '1.234.567'   → ('.', 3)
        '1,500.50'    → ('.', 2)   # ultimo separador es el '.'
        '1.500,50'    → (',', 2)
        '38600'       → ('ninguno', 0)
        '4.6'         → ('.', 1)   # caso truncado, digitos_post=1
        '4.60'        → ('.', 2)
    """
    s = _clean(s).lstrip("-")
    if not s:
        return ("ninguno", 0)
    last_dot = s.rfind(".")
    last_comma = s.rfind(",")
    last_sep_idx = max(last_dot, last_comma)
    if last_sep_idx == -1:
        return ("ninguno", 0)
    sep = s[last_sep_idx]
    digits_after = len(s) - last_sep_idx - 1
    # Solo contamos digitos puros (no signos)
    after = s[last_sep_idx + 1:]
    digits_after = len(after) if after.isdigit() else 0
    return (sep, digits_after)


def detect_format(samples: List[Optional[Union[str, float, int]]]) -> Tuple[Separator, int]:
    """
    Toma una lista de strings (puede contener None/floats/ints — los ignoramos
    o convertimos a string) y devuelve el formato dominante.

    Reglas de voto:
    - Solo considera samples que NO sean None ni vacios.
    - Cada sample emite (separador, digitos_post).
    - El (sep, digits) con mayor recuento gana.
    - En empate, prefiere digits=3 sobre digits=2 sobre digits=0 (mas conservador
      ante valores grandes).
    - Si la mayoria tiene digits in {0, 1}, devolvemos ('ninguno', 0) salvo
      que >=1 sample muestre 3 digitos (señal fuerte de miles).
    """
    votes: Counter = Counter()
    n_valid = 0
    for s in samples:
        if s is None:
            continue
        s_str = str(s).strip()
        if not s_str:
            continue
        n_valid += 1
        sep, digits = _classify_single(s_str)
        votes[(sep, digits)] += 1

    if not votes:
        return ("ninguno", 0)

    # Señal fuerte: si CUALQUIER sample tiene digits=3 con sep claro,
    # asumimos miles (CLP-style). Es muy poco probable que un USD tenga
    # un valor terminado en .YYY (seria una boleta loca tipo "$1.234").
    strong_thousand = [k for k in votes if k[1] == 3 and k[0] in (".", ",")]
    if strong_thousand:
        # Si hay strong_thousand, devolver ese formato (el mas frecuente)
        return max(strong_thousand, key=lambda k: votes[k])

    # Sin señal de miles, separador decimal manda (digits=2)
    decimal_keys = [k for k in votes if k[1] == 2 and k[0] in (".", ",")]
    if decimal_keys:
        return max(decimal_keys, key=lambda k: votes[k])

    # Sin separadores significativos
    return ("ninguno", 0)


def parse_price(
    s: Optional[Union[str, float, int]],
    fmt_sep: Separator,
    fmt_digits: int,
) -> Optional[float]:
    """
    Parsea un string a float aplicando el formato detectado.

    fmt_sep + fmt_digits describen el formato GLOBAL de la boleta. Aplicamos
    ese formato al string s, incluso si s no tiene el separador esperado
    (Gemini puede truncar trailing zeros).

    Reglas:
    - Si fmt_digits == 0: parseamos como entero (strip separadores residuales).
    - Si fmt_digits == 2 (decimales): el ULTIMO separador en s es decimal,
      el otro (si aparece) es miles → strip. Si s no tiene separador, es
      entero (1000 → 1000.0).
    - Si fmt_digits == 3 (miles): TODOS los separadores fmt_sep son thousand-sep.
      Los grupos despues del primer separador se pad a 3 digitos para recuperar
      trailing zeros perdidos por Gemini (4.6 → 4.600 → 4600).
    """
    if s is None:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    is_negative = raw.lstrip().startswith("-")
    clean = _clean(raw).lstrip("-")
    if not clean:
        return None
    sign = -1 if is_negative else 1

    # --- Caso entero ---
    if fmt_digits == 0:
        # Quita cualquier separador residual y parsea como int → float
        digits = re.sub(r"[.,]", "", clean)
        try:
            return sign * float(int(digits))
        except ValueError:
            return None

    # --- Caso decimales ---
    if fmt_digits == 2:
        dec_sep = fmt_sep if fmt_sep in (".", ",") else "."
        # Si s no tiene NINGUN separador → entero → float (ej. "100" → 100.0)
        if "." not in clean and "," not in clean:
            try:
                return sign * float(clean)
            except ValueError:
                return None
        last_dot = clean.rfind(".")
        last_comma = clean.rfind(",")
        last_sep_idx = max(last_dot, last_comma)
        actual_sep = clean[last_sep_idx]
        # El thousand-sep es el OTRO caracter
        other_sep = "," if actual_sep == "." else "."
        # Strip thousand-seps
        stripped = clean.replace(other_sep, "")
        # Convertir el actual_sep a "." si no lo es
        if actual_sep != ".":
            stripped = stripped.replace(actual_sep, ".")
        try:
            return sign * float(stripped)
        except ValueError:
            return None

    # --- Caso miles (digits=3) ---
    if fmt_digits == 3:
        sep = fmt_sep if fmt_sep in (".", ",") else "."
        # Si s no tiene separador, asumir que ya viene como entero (sin truncar):
        # ej. "38600" con fmt=("." ,3) → 38600. No multiplicar.
        if sep not in clean and "." not in clean and "," not in clean:
            try:
                return sign * float(int(clean))
            except ValueError:
                return None
        # Splitear por el separador detectado. Los grupos despues del primero
        # deben tener 3 digitos. Si tienen menos, pad con ceros (recupera
        # truncado tipo "4.6" → "4.600").
        groups = clean.split(sep)
        try:
            result = int(groups[0])
            for g in groups[1:]:
                # Strip otros separadores residuales (ej. "1.500,50" no aplica
                # aqui porque fmt_digits=3 implica que NO hay decimales; pero
                # por seguridad)
                g_clean = re.sub(r"[.,]", "", g)
                if not g_clean:
                    continue
                # Pad con ceros si tiene menos de 3 digitos (truncamiento)
                if len(g_clean) < 3:
                    g_clean = g_clean + "0" * (3 - len(g_clean))
                # Si tiene MAS de 3 digitos (ej. "12.3456" raro), tomamos
                # los primeros 3 (logueable como warning)
                if len(g_clean) > 3:
                    g_clean = g_clean[:3]
                result = result * 1000 + int(g_clean)
            return sign * float(result)
        except ValueError:
            return None

    return None


def has_decimals(fmt_sep: Separator, fmt_digits: int) -> bool:
    """Conveniencia: True si el formato implica precios con centavos."""
    return fmt_digits == 2


def get_number_format(fmt_sep: Separator, fmt_digits: int):
    """
    Deriva {thousands, decimal} a partir del separador detectado y los digitos.

    Regla:
      - digits == 2: el separador detectado ES el decimal. El otro caracter
        es el separador de miles.
      - digits == 3: el separador detectado ES el de miles. El otro caracter
        es el decimal.
      - digits == 0 (sin separador detectable): devuelve None — no hay
        evidencia para decidir, el caller debe usar su propio default.

    Ejemplos:
      (".", 2) -> {thousands: ",", decimal: "."}   # US
      (",", 2) -> {thousands: ".", decimal: ","}   # EUR
      (".", 3) -> {thousands: ".", decimal: ","}   # CLP/MXN
      (",", 3) -> {thousands: ",", decimal: "."}   # US estilo enteros con miles
      ("ninguno", 0) -> None
    """
    if fmt_digits == 2 and fmt_sep in (".", ","):
        decimal_sep = fmt_sep
        thousands_sep = "," if fmt_sep == "." else "."
        return {"thousands": thousands_sep, "decimal": decimal_sep}
    if fmt_digits == 3 and fmt_sep in (".", ","):
        thousands_sep = fmt_sep
        decimal_sep = "," if fmt_sep == "." else "."
        return {"thousands": thousands_sep, "decimal": decimal_sep}
    return None
