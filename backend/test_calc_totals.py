"""
test_calc_totals.py

Standalone parity test for backend's calculate_totals.
Mirrors frontend/scripts/test-bill-engine.ts so we can confirm both
engines agree on the same per-person numbers — important because the
snapshot.totals field (computed by the backend) is what /bills history
uses for the "your share" line.

Run with:  python backend/test_calc_totals.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from collaborative_session import calculate_totals  # noqa: E402

EPS = 0.01
passes = 0
failures = 0
failed_names = []


def close(a, b):
    return abs(a - b) < EPS


def assert_close(actual, expected, label):
    if not close(actual, expected):
        raise AssertionError(f"{label}: expected {expected}, got {actual} (diff {actual - expected})")


def scenario(name):
    def decorator(fn):
        global passes, failures
        try:
            fn()
            passes += 1
            print(f"  PASS  {name}")
        except Exception as e:
            failures += 1
            failed_names.append(name)
            print(f"  FAIL  {name}")
            print(f"        {e}")
        return fn
    return decorator


def make(items, assignments, participants, charges=None):
    return {
        "items": items,
        "assignments": assignments,
        "participants": [
            {"id": pid, "name": name, "phone": None, "role": "owner" if i == 0 else "editor"}
            for i, (pid, name) in enumerate(participants)
        ],
        "charges": charges or [],
        "tip": 0,
    }


def by_name(totals, name):
    for t in totals:
        if t["name"] == name:
            return t
    raise AssertionError(f"participant {name} not found in totals")


print("\n=== Backend calculate_totals parity test ===\n")


# --- S1 trivial ---
@scenario("S1 · single item, single owner")
def s1():
    s = make(
        items=[{"id": "i1", "name": "Cafe", "price": 1500, "quantity": 1}],
        assignments={"i1": [{"participant_id": "A", "quantity": 1}]},
        participants=[("A", "Ana")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["subtotal"], 1500, "Ana subtotal")


# --- S2 qty>1 single owner ---
@scenario("S2 · item qty=3, single owner")
def s2():
    s = make(
        items=[{"id": "i1", "name": "Empanada", "price": 2000, "quantity": 3}],
        assignments={"i1": [{"participant_id": "A", "quantity": 3}]},
        participants=[("A", "Ana")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["subtotal"], 6000, "Ana subtotal")


# --- S5 the regression case ---
@scenario("S5 · qty=3 split 1+2 (regression case)")
def s5():
    s = make(
        items=[{"id": "i1", "name": "Alt+F4", "price": 4900, "quantity": 3, "mode": "individual"}],
        assignments={
            "i1": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 2},
            ]
        },
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["subtotal"], 4900, "Ana")
    assert_close(by_name(t, "Bruno")["subtotal"], 9800, "Bruno")


# --- S8 percent charge proportional ---
@scenario("S8 · percent + proportional")
def s8():
    s = make(
        items=[
            {"id": "i1", "name": "A", "price": 8000, "quantity": 1},
            {"id": "i2", "name": "B", "price": 12000, "quantity": 1},
        ],
        assignments={
            "i1": [{"participant_id": "A", "quantity": 1}],
            "i2": [{"participant_id": "B", "quantity": 1}],
        },
        charges=[{"id": "tip", "name": "Tip", "value": 10, "valueType": "percent",
                  "isDiscount": False, "distribution": "proportional"}],
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["total"], 8800, "Ana total")
    assert_close(by_name(t, "Bruno")["total"], 13200, "Bruno total")


# --- S10 per_person ---
@scenario("S10 · fixed + per_person")
def s10():
    s = make(
        items=[
            {"id": "i1", "name": "A", "price": 8000, "quantity": 1},
            {"id": "i2", "name": "B", "price": 12000, "quantity": 1},
        ],
        assignments={
            "i1": [{"participant_id": "A", "quantity": 1}],
            "i2": [{"participant_id": "B", "quantity": 1}],
        },
        charges=[{"id": "c", "name": "Servicio", "value": 1000, "valueType": "fixed",
                  "isDiscount": False, "distribution": "per_person"}],
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["charges_total"], 500, "Ana per_person")
    assert_close(by_name(t, "Bruno")["charges_total"], 500, "Bruno per_person")


# --- S11 fixed_per_person ---
@scenario("S11 · fixed + fixed_per_person")
def s11():
    s = make(
        items=[
            {"id": "i1", "name": "A", "price": 8000, "quantity": 1},
            {"id": "i2", "name": "B", "price": 12000, "quantity": 1},
        ],
        assignments={
            "i1": [{"participant_id": "A", "quantity": 1}],
            "i2": [{"participant_id": "B", "quantity": 1}],
        },
        charges=[{"id": "c", "name": "Cubierto", "value": 1500, "valueType": "fixed",
                  "isDiscount": False, "distribution": "fixed_per_person"}],
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["charges_total"], 1500, "Ana fixed_per_person")
    assert_close(by_name(t, "Bruno")["charges_total"], 1500, "Bruno fixed_per_person")


# --- S12 discount ---
@scenario("S12 · 10% discount proportional")
def s12():
    s = make(
        items=[
            {"id": "i1", "name": "A", "price": 10000, "quantity": 1},
            {"id": "i2", "name": "B", "price": 10000, "quantity": 1},
        ],
        assignments={
            "i1": [{"participant_id": "A", "quantity": 1}],
            "i2": [{"participant_id": "B", "quantity": 1}],
        },
        charges=[{"id": "d", "name": "Desc", "value": 10, "valueType": "percent",
                  "isDiscount": True, "distribution": "proportional"}],
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["total"], 9000, "Ana total with discount")
    assert_close(by_name(t, "Bruno")["total"], 9000, "Bruno total with discount")


# --- S15 the actual Sakura bill ---
@scenario("S15 · Sakura sushi bill (full replication)")
def s15():
    items = [
        {"id": "item_0", "name": "Alt+F4", "price": 4300, "quantity": 1, "mode": "individual"},
        {"id": "item_0_e1_db57a4", "name": "Alt+F4", "price": 4900, "quantity": 3, "mode": "individual"},
        {"id": "item_1", "name": "Kolsch", "price": 4900, "quantity": 1, "mode": "individual"},
        {"id": "item_2", "name": "Gianluigi vegano", "price": 6000, "quantity": 1, "mode": "individual"},
        {"id": "item_3", "name": "CON papas fritas", "price": 1500, "quantity": 2, "mode": "individual"},
        {"id": "item_4", "name": "Gianluigi carne", "price": 5500, "quantity": 1, "mode": "individual"},
        {"id": "item_5", "name": "Apicdate", "price": 13400, "quantity": 1, "mode": "individual"},
    ]
    s = make(
        items=items,
        assignments={
            "item_0": [{"participant_id": "Lu", "quantity": 1}],
            "item_0_e1_db57a4": [
                {"participant_id": "Lu", "quantity": 1},
                {"participant_id": "Diego", "quantity": 2},
            ],
            "item_1": [{"participant_id": "Gon", "quantity": 1}],
            "item_2": [{"participant_id": "Lu", "quantity": 1}],
            "item_3": [
                {"participant_id": "Lu", "quantity": 1},
                {"participant_id": "Diego", "quantity": 1},
            ],
            "item_4": [{"participant_id": "Diego", "quantity": 1}],
            "item_5": [{"participant_id": "Gon", "quantity": 1}],
        },
        charges=[{"id": "tip", "name": "PROPINA SUGERIDA 10", "value": 10,
                  "valueType": "percent", "isDiscount": False, "distribution": "proportional"}],
        participants=[("Gon", "Gon"), ("Lu", "Lu"), ("Diego", "Diego")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Gon")["subtotal"], 18300, "Gon subtotal")
    assert_close(by_name(t, "Lu")["subtotal"], 16700, "Lu subtotal")
    assert_close(by_name(t, "Diego")["subtotal"], 16800, "Diego subtotal")
    assert_close(by_name(t, "Gon")["total"], 20130, "Gon total")
    assert_close(by_name(t, "Lu")["total"], 18370, "Lu total")
    assert_close(by_name(t, "Diego")["total"], 18480, "Diego total")
    grand_total = sum(p["total"] for p in t)
    assert_close(grand_total, 56980, "sum totals == receipt total")


# --- S6 grupal qty=1 shared by 3 ---
@scenario("S6 · grupal qty=1 compartido por 3")
def s6():
    s = make(
        items=[{"id": "i1", "name": "Pizza", "price": 12000, "quantity": 1, "mode": "grupal"}],
        assignments={
            "i1": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 1},
                {"participant_id": "C", "quantity": 1},
            ]
        },
        participants=[("A", "Ana"), ("B", "Bruno"), ("C", "Carla")],
    )
    t = calculate_totals(s)
    # Cada uno debería pagar 4000 (12000/3), no 12000.
    assert_close(by_name(t, "Ana")["subtotal"], 4000, "Ana grupal")
    assert_close(by_name(t, "Bruno")["subtotal"], 4000, "Bruno grupal")
    assert_close(by_name(t, "Carla")["subtotal"], 4000, "Carla grupal")


# --- S7 grupal qty=2 shared by 3 ---
@scenario("S7 · grupal qty=2 compartido por 3")
def s7():
    s = make(
        items=[{"id": "i1", "name": "Bandeja", "price": 12000, "quantity": 2, "mode": "grupal"}],
        assignments={
            "i1": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 1},
                {"participant_id": "C", "quantity": 1},
            ]
        },
        participants=[("A", "Ana"), ("B", "Bruno"), ("C", "Carla")],
    )
    t = calculate_totals(s)
    # Cada uno: (12000*2)/3 = 8000.
    assert_close(by_name(t, "Ana")["subtotal"], 8000, "Ana grupal qty2")
    assert_close(by_name(t, "Bruno")["subtotal"], 8000, "Bruno")
    assert_close(by_name(t, "Carla")["subtotal"], 8000, "Carla")


# --- S14 per-unit shared by 2 ---
@scenario("S14 · per-unit (_unit_N) compartido por 2")
def s14():
    s = make(
        items=[{"id": "i1", "name": "Vino", "price": 18000, "quantity": 1}],
        assignments={
            "i1_unit_0": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 1},
            ]
        },
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["subtotal"], 9000, "Ana unit/2")
    assert_close(by_name(t, "Bruno")["subtotal"], 9000, "Bruno unit/2")


# --- S20 5 personas qty=10 reparto desigual ---
@scenario("S20 · 5 personas reparten qty=10 (1+1+2+3+3)")
def s20():
    s = make(
        items=[{"id": "i1", "name": "Cerveza", "price": 3500, "quantity": 10, "mode": "individual"}],
        assignments={
            "i1": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 1},
                {"participant_id": "C", "quantity": 2},
                {"participant_id": "D", "quantity": 3},
                {"participant_id": "E", "quantity": 3},
            ]
        },
        participants=[("A", "Ana"), ("B", "Bruno"), ("C", "Carla"), ("D", "Diana"), ("E", "Eli")],
    )
    t = calculate_totals(s)
    assert_close(by_name(t, "Ana")["subtotal"], 3500, "Ana 1")
    assert_close(by_name(t, "Diana")["subtotal"], 10500, "Diana 3")
    assert_close(by_name(t, "Eli")["subtotal"], 10500, "Eli 3")
    grand = sum(p["subtotal"] for p in t)
    assert_close(grand, 35000, "sum == 10×3500")


# --- S24 mezcla individual + grupal ---
@scenario("S24 · mezcla individual + grupal")
def s24():
    s = make(
        items=[
            {"id": "i1", "name": "Plato A", "price": 8000, "quantity": 1, "mode": "individual"},
            {"id": "i2", "name": "Postre", "price": 6000, "quantity": 1, "mode": "grupal"},
            {"id": "i3", "name": "Cerveza", "price": 3000, "quantity": 4, "mode": "individual"},
        ],
        assignments={
            "i1": [{"participant_id": "A", "quantity": 1}],
            "i2": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 1},
            ],
            "i3": [
                {"participant_id": "A", "quantity": 1},
                {"participant_id": "B", "quantity": 3},
            ],
        },
        participants=[("A", "Ana"), ("B", "Bruno")],
    )
    t = calculate_totals(s)
    # A: 8000 + (6000/2) + 3000 = 14000
    # B: (6000/2) + 9000 = 12000
    assert_close(by_name(t, "Ana")["subtotal"], 14000, "Ana mezcla")
    assert_close(by_name(t, "Bruno")["subtotal"], 12000, "Bruno mezcla")


print(f"\n=== Result: {passes} passed, {failures} failed ===\n")
if failures > 0:
    print("Failed scenarios:")
    for n in failed_names:
        print(f"  - {n}")
    sys.exit(1)
