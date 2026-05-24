"""Tests for Polar tip checkout extension and webhook tip branch."""

import inspect
import pytest


def test_create_checkout_accepts_amount_kwarg():
    from polar_service import create_checkout
    sig = inspect.signature(create_checkout)
    assert "amount" in sig.parameters, "create_checkout must accept an `amount` kwarg for PWYW products"
    assert sig.parameters["amount"].default is None, "amount should default to None (use product price)"


def test_create_checkout_passes_amount_in_body(monkeypatch):
    """When amount is provided, Polar body must include it (in cents)."""
    import polar_service
    captured = {}

    class FakeResp:
        status_code = 201
        def json(self): return {"id": "co_1", "url": "https://polar.test/co_1"}

    class FakeClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return None
        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            return FakeResp()

    monkeypatch.setattr(polar_service, "httpx", type("X", (), {"AsyncClient": FakeClient})())
    monkeypatch.setenv("POLAR_ACCESS_TOKEN", "test_token")

    import asyncio
    asyncio.run(polar_service.create_checkout(product_id="prod_tip", amount=7.0))

    assert captured["json"].get("amount") == 700, "amount must be in cents (USD * 100)"


def test_tip_checkout_request_model_validates_min_amount():
    from main import TipCheckoutRequest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        TipCheckoutRequest(session_id="abc", amount_usd=0.5, participant_count=1, google_email="g@x.com")


def test_compute_charged_amount_always_returns_full_amount():
    """Host always pays the full tip to Polar regardless of is_split.
    The split toggle is for display purposes only — Bill-e's revenue is
    independent of the host's split choice."""
    from main import _compute_charged_amount
    assert _compute_charged_amount(7.0, True, 4) == 7.0
    assert _compute_charged_amount(7.0, False, 4) == 7.0
    assert _compute_charged_amount(7.0, True, 1) == 7.0
    assert _compute_charged_amount(3.49, True, 10) == 3.49


def test_record_tip_inserts_row_and_is_idempotent(monkeypatch):
    from postgres_db import record_tip
    inserts = []

    class FakeSess:
        def add(self, obj): inserts.append(obj)
        def commit(self): pass
        def query(self, model):
            class Q:
                def filter_by(self, **kw):
                    class R:
                        def first(_self): return None
                    return R()
            return Q()
        def rollback(self): pass

    sess = FakeSess()
    ok = record_tip(
        sess,
        session_id="s1",
        host_email="g@x.com",
        amount_total_usd=7.0,
        amount_charged_usd=1.75,
        is_split=True,
        participant_count=4,
        polar_order_id="po_1",
    )
    assert ok is True
    assert len(inserts) == 1


def test_record_tip_skips_duplicate_polar_order_id():
    from postgres_db import record_tip, Tip

    class FakeSess:
        def add(self, obj): self.added = obj
        def commit(self): pass
        def query(self, model):
            class Q:
                def filter_by(self, **kw):
                    class R:
                        def first(_self):
                            return Tip(polar_order_id=kw.get("polar_order_id"))
                    return R()
            return Q()

    sess = FakeSess()
    ok = record_tip(
        sess,
        session_id="s1",
        host_email="g@x.com",
        amount_total_usd=7.0,
        amount_charged_usd=1.75,
        is_split=True,
        participant_count=4,
        polar_order_id="po_dup",
    )
    assert ok is False
    assert not hasattr(sess, "added")


def test_tip_model_has_total_paid_usd_column():
    from postgres_db import Tip
    cols = {c.name for c in Tip.__table__.columns}
    assert "total_paid_usd" in cols


def test_record_tip_accepts_and_stores_total_paid_usd(monkeypatch):
    from postgres_db import record_tip
    inserts = []

    class FakeSess:
        def add(self, obj): inserts.append(obj)
        def commit(self): pass
        def query(self, model):
            class Q:
                def filter_by(self, **kw):
                    class R:
                        def first(_self): return None
                    return R()
            return Q()

    sess = FakeSess()
    ok = record_tip(
        sess,
        session_id="s1",
        host_email="g@x.com",
        amount_total_usd=7.0,
        amount_charged_usd=1.75,
        is_split=True,
        participant_count=4,
        polar_order_id="po_with_tax",
        total_paid_usd=7.85,
    )
    assert ok is True
    assert len(inserts) == 1
    assert inserts[0].total_paid_usd == "7.85"


def test_record_tip_total_paid_usd_is_optional():
    """Backwards compatible: total_paid_usd defaults to None."""
    from postgres_db import record_tip
    inserts = []

    class FakeSess:
        def add(self, obj): inserts.append(obj)
        def commit(self): pass
        def query(self, model):
            class Q:
                def filter_by(self, **kw):
                    class R:
                        def first(_self): return None
                    return R()
            return Q()

    sess = FakeSess()
    ok = record_tip(
        sess,
        session_id="s1",
        host_email="g@x.com",
        amount_total_usd=7.0,
        amount_charged_usd=1.75,
        is_split=False,
        participant_count=1,
        polar_order_id="po_no_tax_yet",
    )
    assert ok is True
    assert inserts[0].total_paid_usd is None


def test_update_tip_request_validates_min():
    from main import UpdateTipRequest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        UpdateTipRequest(total_paid_usd=0.5, owner_token="dummy")


def test_update_tip_request_requires_owner_token():
    from main import UpdateTipRequest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        UpdateTipRequest(total_paid_usd=5.0)  # missing owner_token
