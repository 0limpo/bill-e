"""
Tests del parser de precios. Cubre todos los formatos esperados de boletas reales.
"""

import sys
from price_parser import detect_format, parse_price, has_decimals, _classify_single, get_number_format


def t(name, got, expected):
    """Mini-assertion con output legible."""
    ok = got == expected
    status = "OK" if ok else "FAIL"
    print(f"  [{status}] {name}: got={got!r} expected={expected!r}")
    return ok


def section(title):
    print(f"\n{'='*60}\n{title}\n{'='*60}")


def main():
    fails = []

    # ============================================================
    section("1) _classify_single — clasificacion por string individual")
    # ============================================================
    cases = [
        ("4.600",     (".", 3)),
        ("4.99",      (".", 2)),
        ("1.234.567", (".", 3)),
        ("1,500.50",  (".", 2)),
        ("1.500,50",  (",", 2)),
        ("38600",     ("ninguno", 0)),
        ("4.6",       (".", 1)),
        ("4.60",      (".", 2)),
        ("$4.600",    (".", 3)),
        ("  4,99  ",  (",", 2)),
        ("0",         ("ninguno", 0)),
        ("",          ("ninguno", 0)),
        ("-12.50",    (".", 2)),  # negativo
    ]
    for s, expected in cases:
        got = _classify_single(s)
        if not t(f"_classify('{s}')", got, expected):
            fails.append(f"_classify({s!r})")

    # ============================================================
    section("2) detect_format — voto sobre muestra")
    # ============================================================
    detect_cases = [
        # CLP simple: todos x.YYY
        ("CLP simple",
         ["4.600", "4.100", "4.600", "2.300", "38.600"],
         (".", 3)),
        # CLP grande con miles multiples
        ("CLP con millones",
         ["1.234.567", "500.000", "12.345"],
         (".", 3)),
        # USD decimales
        ("USD decimales",
         ["4.99", "12.50", "0.99", "100.00"],
         (".", 2)),
        # EUR decimales
        ("EUR decimales",
         ["4,99", "12,50"],
         (",", 2)),
        # Boleta entera CLP sin separadores
        ("CLP entero",
         ["4600", "4100", "38600"],
         ("ninguno", 0)),
        # USD con miles (raro)
        ("USD con miles",
         ["1,500.50", "2,300.99"],
         (".", 2)),
        # EUR con miles
        ("EUR con miles",
         ["1.500,50", "2.300,99"],
         (",", 2)),
        # Mixto: dos items con miles claros + un truncado
        ("CLP con un valor truncado",
         ["4.600", "4.100", "4.6"],  # ultimo perdio el cero
         (".", 3)),
        # Señal fuerte de miles aun con minoria
        ("Un solo valor con .YYY entre varios sin separador",
         ["4.600", "100", "200"],
         (".", 3)),
        # Empate: prefiere .YYY sobre .YY
        ("Empate decimal vs miles",
         ["4.99", "4.600"],
         (".", 3)),
        # Solo valores enteros pequeños
        ("Enteros USD-style",
         ["5", "10", "25"],
         ("ninguno", 0)),
        # Muestra vacia
        ("Vacio",
         [None, "", "  "],
         ("ninguno", 0)),
    ]
    for name, samples, expected in detect_cases:
        got = detect_format(samples)
        if not t(name, got, expected):
            fails.append(name)

    # ============================================================
    section("3) parse_price — parseo con formato detectado")
    # ============================================================
    parse_cases = [
        # (input, fmt_sep, fmt_digits, expected)
        # --- CLP simple .YYY ---
        ("4.600",     ".", 3, 4600.0),
        ("38.600",    ".", 3, 38600.0),
        ("4.6",       ".", 3, 4600.0),     # truncado → padding
        ("4.60",      ".", 3, 4600.0),     # truncado parcial → padding
        ("4.6000",    ".", 3, 4600.0),     # excedente → trunca a 3
        ("1.234.567", ".", 3, 1234567.0),  # multi-grupo
        ("38600",     ".", 3, 38600.0),    # sin separador → entero
        # --- USD decimales .YY ---
        ("4.99",      ".", 2, 4.99),
        ("100.00",    ".", 2, 100.00),
        ("1,500.50",  ".", 2, 1500.50),    # miles "," + decimal "."
        ("100",       ".", 2, 100.0),      # sin separador → entero
        # --- EUR decimales ,YY ---
        ("4,99",      ",", 2, 4.99),
        ("1.500,50",  ",", 2, 1500.50),
        # --- Entero sin separador ---
        ("38600",     "ninguno", 0, 38600.0),
        ("4600",      "ninguno", 0, 4600.0),
        # --- Limpiezas ---
        ("$4.600",    ".", 3, 4600.0),
        ("  4,99  ",  ",", 2, 4.99),
        # --- Negativos (descuentos) ---
        ("-4.600",    ".", 3, -4600.0),
        ("-4.99",     ".", 2, -4.99),
        # --- None / vacio ---
        (None,        ".", 3, None),
        ("",          ".", 2, None),
    ]
    for s, sep, digits, expected in parse_cases:
        got = parse_price(s, sep, digits)
        if not t(f"parse({s!r}, sep={sep!r}, digits={digits})", got, expected):
            fails.append(f"parse({s!r})")

    # ============================================================
    section("4) Casos reales end-to-end (detect + parse muestra completa)")
    # ============================================================
    real_cases = [
        # Boleta Elkika (la del Render log):
        # items reales en CLP: 4600, 4100, 4100, 4600, 2300, 4100, 3500, 3700, 7600
        # total 38600
        ("Elkika CLP",
         ["4.600", "4.100", "4.100", "4.600", "2.300", "4.100",
          "3.500", "3.700", "7.600", "38.600", "3.860"],
         (".", 3),
         False,
         [4600, 4100, 4100, 4600, 2300, 4100, 3500, 3700, 7600, 38600, 3860]),
        # Boleta USD legitima
        ("Tack Room USD",
         ["12.95", "8.50", "21.45", "1.50"],
         (".", 2),
         True,
         [12.95, 8.50, 21.45, 1.50]),
        # Boleta EUR (España)
        ("EUR estilo",
         ["12,50", "4,99", "17,49"],
         (",", 2),
         True,
         [12.50, 4.99, 17.49]),
        # CLP con miles grande (compra de 1M+)
        ("CLP millones",
         ["1.234.567", "234.567", "1.469.134"],
         (".", 3),
         False,
         [1234567, 234567, 1469134]),
        # CLP donde Gemini trunco zeros en algunos
        ("CLP con truncados",
         ["4.6", "4.100", "4.600", "2.3", "38.6"],
         (".", 3),
         False,
         [4600, 4100, 4600, 2300, 38600]),
    ]
    for name, samples, expected_fmt, expected_has_decimals, expected_parsed in real_cases:
        fmt = detect_format(samples)
        if not t(f"{name} fmt", fmt, expected_fmt):
            fails.append(f"{name} fmt")
        if not t(f"{name} has_decimals", has_decimals(*fmt), expected_has_decimals):
            fails.append(f"{name} has_decimals")
        parsed = [parse_price(s, *fmt) for s in samples]
        if not t(f"{name} parsed", parsed, [float(x) for x in expected_parsed]):
            fails.append(f"{name} parsed")

    # ============================================================
    section("5) get_number_format — derivacion de {thousands, decimal}")
    # ============================================================
    nf_cases = [
        # (sep, digits, expected_format)
        (".", 2, {"thousands": ",", "decimal": "."}),  # US (4.99 + 1,500)
        (",", 2, {"thousands": ".", "decimal": ","}),  # EUR (4,99 + 1.500)
        (".", 3, {"thousands": ".", "decimal": ","}),  # CLP/MXN (4.600)
        (",", 3, {"thousands": ",", "decimal": "."}),  # US enteros con miles (4,600)
        ("ninguno", 0, None),                          # sin info
    ]
    for sep, digits, expected in nf_cases:
        got = get_number_format(sep, digits)
        if not t(f"get_number_format({sep!r}, {digits})", got, expected):
            fails.append(f"nf({sep},{digits})")

    # ============================================================
    section("RESULTADO")
    # ============================================================
    if fails:
        print(f"\n{len(fails)} FALLAS:")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("\nTodos los tests PASARON")


if __name__ == "__main__":
    main()
