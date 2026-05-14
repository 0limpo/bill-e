"""
Tests del adapter boleta_to_bill_e con strings.
Simula respuestas de Gemini en distintos formatos.
"""
import sys
from prompt_v3 import boleta_to_bill_e


def assert_eq(name, got, expected, tol=0.01):
    if isinstance(expected, float):
        ok = abs(got - expected) <= tol
    else:
        ok = got == expected
    status = "OK" if ok else "FAIL"
    print(f"  [{status}] {name}: got={got!r} expected={expected!r}")
    return ok


def section(t):
    print(f"\n{'='*60}\n{t}\n{'='*60}")


fails = []


# ============================================================
section("1) Elkika CLP — adapter completo")
# ============================================================
b = {
    'nombre_comercio': 'Elkika',
    'items': [
        {'id': 'i1', 'nombre': 'AMBAR', 'total_linea': '4.600', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i2', 'nombre': 'STELLA', 'total_linea': '4.100', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i3', 'nombre': 'COCA', 'total_linea': '2.300', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': None,
    'cargos': [{'id': 'c1', 'nombre': 'Propina', 'valor': '1.100', 'tipo': 'fixed', 'valor_impreso': None}],
    'descuentos': [],
    'total_impreso': '11.000',
}
r = boleta_to_bill_e(b)
if not assert_eq('format sep', r['_format_separator'], '.'): fails.append('1-sep')
if not assert_eq('format digits', r['_format_digits'], 3): fails.append('1-digits')
if not assert_eq('decimales', r['moneda_tiene_decimales'], False): fails.append('1-dec')
if not assert_eq('item AMBAR precio', r['items'][0]['precio'], 4600.0): fails.append('1-ambar')
if not assert_eq('item COCA precio', r['items'][2]['precio'], 2300.0): fails.append('1-coca')
if not assert_eq('cargo Propina valor', r['cargos'][0]['valor'], 1100.0): fails.append('1-propina')
if not assert_eq('total', r['total'], 11000.0): fails.append('1-total')


# ============================================================
section("2) USD legitimo (Tack Room)")
# ============================================================
b = {
    'nombre_comercio': 'Tack Room',
    'items': [
        {'id': 'i1', 'nombre': 'Burger', 'total_linea': '12.95', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i2', 'nombre': 'Fries', 'total_linea': '8.50', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': '21.45',
    'cargos': [{'id': 'c1', 'nombre': 'Tax', 'valor': '8.875', 'tipo': 'percent', 'valor_impreso': '1.90'}],
    'descuentos': [],
    'total_impreso': '23.35',
}
r = boleta_to_bill_e(b)
if not assert_eq('format sep', r['_format_separator'], '.'): fails.append('2-sep')
if not assert_eq('format digits', r['_format_digits'], 2): fails.append('2-digits')
if not assert_eq('decimales', r['moneda_tiene_decimales'], True): fails.append('2-dec')
if not assert_eq('item Burger precio', r['items'][0]['precio'], 12.95): fails.append('2-burger')
if not assert_eq('cargo Tax valor (%)', r['cargos'][0]['valor'], 8.875): fails.append('2-tax-val')
if not assert_eq('cargo Tax tipo', r['cargos'][0]['tipo'], 'percent'): fails.append('2-tax-tipo')
if not assert_eq('cargo Tax valor_impreso', r['cargos'][0]['_valor_impreso'], 1.90): fails.append('2-tax-vi')
if not assert_eq('subtotal', r['subtotal'], 21.45): fails.append('2-sub')
if not assert_eq('total', r['total'], 23.35): fails.append('2-total')


# ============================================================
section("3) EUR (España) con miles + decimales")
# ============================================================
b = {
    'nombre_comercio': 'Restaurante Madrid',
    'items': [
        {'id': 'i1', 'nombre': 'Paella', 'total_linea': '24,50', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i2', 'nombre': 'Vino', 'total_linea': '1.250,00', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': '1.274,50',
    'cargos': [{'id': 'c1', 'nombre': 'IVA', 'valor': '10', 'tipo': 'percent', 'valor_impreso': '127,45'}],
    'descuentos': [],
    'total_impreso': '1.401,95',
}
r = boleta_to_bill_e(b)
if not assert_eq('format sep', r['_format_separator'], ','): fails.append('3-sep')
if not assert_eq('format digits', r['_format_digits'], 2): fails.append('3-digits')
if not assert_eq('decimales', r['moneda_tiene_decimales'], True): fails.append('3-dec')
if not assert_eq('item Paella', r['items'][0]['precio'], 24.50): fails.append('3-paella')
if not assert_eq('item Vino (1.250)', r['items'][1]['precio'], 1250.0): fails.append('3-vino')
if not assert_eq('subtotal', r['subtotal'], 1274.50): fails.append('3-sub')
if not assert_eq('total', r['total'], 1401.95): fails.append('3-total')
if not assert_eq('cargo IVA valor_impreso', r['cargos'][0]['_valor_impreso'], 127.45): fails.append('3-iva')


# ============================================================
section("4) CLP con miles multiples (boleta grande)")
# ============================================================
b = {
    'nombre_comercio': 'Tienda',
    'items': [
        {'id': 'i1', 'nombre': 'TV', 'total_linea': '1.234.567', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i2', 'nombre': 'Cable', 'total_linea': '50.000', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': '1.284.567',
    'cargos': [],
    'descuentos': [{'id': 'd1', 'nombre': 'Descuento', 'valor': '100.000', 'tipo': 'fixed', 'valor_impreso': None}],
    'total_impreso': '1.184.567',
}
r = boleta_to_bill_e(b)
if not assert_eq('format', (r['_format_separator'], r['_format_digits']), ('.', 3)): fails.append('4-fmt')
if not assert_eq('item TV', r['items'][0]['precio'], 1234567.0): fails.append('4-tv')
if not assert_eq('item Cable', r['items'][1]['precio'], 50000.0): fails.append('4-cable')
if not assert_eq('total', r['total'], 1184567.0): fails.append('4-total')
if not assert_eq('descuento', r['cargos'][0]['valor'], 100000.0): fails.append('4-disc')


# ============================================================
section("5) Truncado: Gemini devolvio '4.6' en vez de '4.600'")
# ============================================================
b = {
    'nombre_comercio': 'Bar',
    'items': [
        {'id': 'i1', 'nombre': 'Cerveza', 'total_linea': '4.6', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i2', 'nombre': 'Otra', 'total_linea': '4.600', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': None,
    'cargos': [],
    'descuentos': [],
    'total_impreso': '9.200',
}
r = boleta_to_bill_e(b)
if not assert_eq('format', (r['_format_separator'], r['_format_digits']), ('.', 3)): fails.append('5-fmt')
if not assert_eq('item Cerveza (truncado)', r['items'][0]['precio'], 4600.0): fails.append('5-cerv')
if not assert_eq('item Otra', r['items'][1]['precio'], 4600.0): fails.append('5-otra')
if not assert_eq('total', r['total'], 9200.0): fails.append('5-tot')


# ============================================================
section("6) precio_tipo='total' con CLP (Koobideh style)")
# ============================================================
b = {
    'nombre_comercio': 'Chelokababi CLP',
    'items': [
        {'id': 'i1', 'nombre': 'Koobideh x 7', 'total_linea': '115.500', 'cantidad': 7, 'precio_tipo': 'total'},
        {'id': 'i2', 'nombre': 'Nan', 'total_linea': '8.950', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': '124.450',
    'cargos': [],
    'descuentos': [],
    'total_impreso': '124.450',
}
r = boleta_to_bill_e(b)
if not assert_eq('format', (r['_format_separator'], r['_format_digits']), ('.', 3)): fails.append('6-fmt')
# Koobideh: total_linea=115500, cantidad=7 → precio_unitario=16500
if not assert_eq('Koobideh unitario', r['items'][0]['precio'], 16500.0): fails.append('6-koo-unit')
if not assert_eq('Koobideh _total_linea', r['items'][0]['_total_linea'], 115500.0): fails.append('6-koo-tot')
if not assert_eq('Nan', r['items'][1]['precio'], 8950.0): fails.append('6-nan')


# ============================================================
section("7) Entero sin separadores (CLP impreso sin puntos)")
# ============================================================
b = {
    'nombre_comercio': 'Carrito',
    'items': [
        {'id': 'i1', 'nombre': 'Item A', 'total_linea': '4500', 'cantidad': 1, 'precio_tipo': 'unitario'},
        {'id': 'i2', 'nombre': 'Item B', 'total_linea': '8000', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': None,
    'cargos': [],
    'descuentos': [],
    'total_impreso': '12500',
}
r = boleta_to_bill_e(b)
if not assert_eq('format', (r['_format_separator'], r['_format_digits']), ('ninguno', 0)): fails.append('7-fmt')
if not assert_eq('decimales', r['moneda_tiene_decimales'], False): fails.append('7-dec')
if not assert_eq('item A', r['items'][0]['precio'], 4500.0): fails.append('7-a')
if not assert_eq('total', r['total'], 12500.0): fails.append('7-tot')


# ============================================================
section("8) Descuento percent (debe quedar como percent, no parsearse como moneda)")
# ============================================================
b = {
    'nombre_comercio': 'Araxi',
    'items': [
        {'id': 'i1', 'nombre': 'Burger', 'total_linea': '20.00', 'cantidad': 1, 'precio_tipo': 'unitario'},
    ],
    'subtotal_impreso': '20.00',
    'cargos': [],
    'descuentos': [{'id': 'd1', 'nombre': '10% off', 'valor': '10', 'tipo': 'percent', 'valor_impreso': '2.00'}],
    'total_impreso': '18.00',
}
r = boleta_to_bill_e(b)
if not assert_eq('format', (r['_format_separator'], r['_format_digits']), ('.', 2)): fails.append('8-fmt')
if not assert_eq('descuento tipo', r['cargos'][0]['tipo'], 'percent'): fails.append('8-tipo')
if not assert_eq('descuento valor', r['cargos'][0]['valor'], 10.0): fails.append('8-val')
if not assert_eq('descuento es_descuento', r['cargos'][0]['es_descuento'], True): fails.append('8-isdesc')
if not assert_eq('descuento _valor_impreso', r['cargos'][0]['_valor_impreso'], 2.0): fails.append('8-vi')


# ============================================================
section("9) Boleta con tax incluido en items (UE)")
# ============================================================
b = {
    'nombre_comercio': 'IKEA',
    'items': [
        {'id': 'i1', 'nombre': 'Silla', 'total_linea': '24,99', 'cantidad': 1, 'precio_tipo': 'unitario', 'incluye': ['c1']},
        {'id': 'i2', 'nombre': 'Mesa', 'total_linea': '99,99', 'cantidad': 1, 'precio_tipo': 'unitario', 'incluye': ['c1']},
    ],
    'subtotal_impreso': '124,98',
    'cargos': [{'id': 'c1', 'nombre': 'IVA', 'valor': '21', 'tipo': 'percent', 'valor_impreso': '21,71'}],
    'descuentos': [],
    'total_impreso': '124,98',
}
r = boleta_to_bill_e(b)
if not assert_eq('format', (r['_format_separator'], r['_format_digits']), (',', 2)): fails.append('9-fmt')
if not assert_eq('items incluyen cargos', r['precios_items_incluyen_cargos'], True): fails.append('9-incl')
if not assert_eq('Silla', r['items'][0]['precio'], 24.99): fails.append('9-silla')
if not assert_eq('IVA valor', r['cargos'][0]['valor'], 21.0): fails.append('9-iva')


# ============================================================
section("RESULTADO")
# ============================================================
if fails:
    print(f"\n{len(fails)} FALLAS:")
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)
else:
    print("\nTodos los tests del adapter PASARON")
