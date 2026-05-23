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
