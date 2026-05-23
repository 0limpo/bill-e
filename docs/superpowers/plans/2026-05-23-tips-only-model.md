# Tips-Only Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Bill-e from "free-tier (5 sessions) + Premium $3.49" to "everything free + voluntary tip", with a permanent tip widget in StepShare and a 90-day "Supporter" badge for migrated Premium users. Soft launch reversible — no Premium code is deleted in this plan.

**Architecture:** Backend cap is raised to 500 as anti-abuse defense; tip checkout reuses Polar with a new pay-what-you-want product and a metadata-keyed webhook branch; a new `tips` table records paid tips; frontend replaces the existing split-subscription block in StepShare with a `TipWidget` component that mirrors the same split mechanic. Supporters are flagged via a new `users.supporter_until` column populated by a one-shot migration on `init_db`.

**Tech Stack:** Python (FastAPI), SQLAlchemy, Polar.sh, Next.js (App Router), TypeScript, Tailwind, PostHog. No Alembic — schema migrations are inline `ALTER TABLE IF NOT EXISTS` in `postgres_db._run_migrations`.

**Spec:** `docs/superpowers/specs/2026-05-23-tips-only-model-design.md` (commit `6a4b5a2`).

---

## File Structure

**Backend (modified)**:
- `backend/postgres_db.py` — add `supporter_until` to `User`, add `Tip` model, extend `_run_migrations`, add `record_tip()` and `migrate_premium_to_supporter()` helpers.
- `backend/free_tier.py:29` — `FREE_SESSIONS_LIMIT = 500`.
- `backend/polar_service.py` — extend `create_checkout` with optional `amount` param.
- `backend/main.py` — new endpoint `/api/polar/tip-checkout`; extend webhook handler to record tips on metadata `kind=tip`.

**Backend (new tests)**:
- `backend/test_tips.py` — endpoint + webhook tip-branch tests.
- `backend/test_supporter_migration.py` — migration script tests.

**Frontend (new)**:
- `frontend/src/components/TipWidget.tsx`
- `frontend/src/components/MeetTheDeveloper.tsx`

**Frontend (modified)**:
- `frontend/src/lib/api.ts` — `createTipCheckout` + types.
- `frontend/src/lib/auth.ts` — add `supporter_until` to `AuthUser`.
- `frontend/src/lib/tracking.ts` — tip events.
- `frontend/src/lib/i18n.ts` — tip widget keys (seed: en + es; other 10 langs follow existing translation flow as separate work).
- `frontend/src/components/steps/StepShare.tsx` — replace split-subscription block with `TipWidget`.
- `frontend/src/app/page.tsx` — landing copy update.
- Header component (TBD: find via grep in T14) — badge logic.

**Out of scope for this plan**: cleanup of dead Premium code (separate PR per spec Sección 6), TWA dormancy (separate PR), Play Store assets, multi-language translations beyond en/es (separate translation task).

**Pre-flight (manual, by Gonzalo)**: create a Polar product "Bill-e Tip" with **pay-what-you-want** pricing enabled. Capture its `product_id`. Set as env var `POLAR_TIP_PRODUCT_ID` on Render. This is required before T4 can be tested in any non-mocked environment.

---

## Phase A — Backend

### Task A1: Add `supporter_until` column and `tips` table

**Files:**
- Modify: `backend/postgres_db.py:32-56` (extend `_run_migrations`), `backend/postgres_db.py:242` (extend `User` model)
- Create: `backend/test_supporter_migration.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_supporter_migration.py`:

```python
"""Tests for the schema additions: users.supporter_until + tips table."""

from datetime import datetime, timedelta
import pytest


def test_user_model_has_supporter_until_column():
    from postgres_db import User
    cols = {c.name for c in User.__table__.columns}
    assert "supporter_until" in cols, "User model must declare supporter_until"


def test_tip_model_exists_with_expected_columns():
    from postgres_db import Tip
    cols = {c.name for c in Tip.__table__.columns}
    expected = {
        "id", "session_id", "host_email", "amount_total_usd",
        "amount_charged_usd", "is_split", "participant_count",
        "polar_order_id", "created_at",
    }
    missing = expected - cols
    assert not missing, f"Tip missing columns: {missing}"


def test_polar_order_id_is_unique_on_tip():
    from postgres_db import Tip
    polar_col = Tip.__table__.columns["polar_order_id"]
    assert polar_col.unique, "polar_order_id must have a UNIQUE constraint"


def test_migrations_list_includes_supporter_until():
    """The inline migrations list must add supporter_until via ALTER TABLE."""
    import inspect
    from postgres_db import _run_migrations
    src = inspect.getsource(_run_migrations)
    assert "supporter_until" in src
    assert "ADD COLUMN IF NOT EXISTS" in src
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest test_supporter_migration.py -v`
Expected: 4 failures (model attributes / Tip class do not exist yet).

- [ ] **Step 3: Add the `Tip` model and extend `User`**

In `backend/postgres_db.py`, locate the `User` class (line ~242) and add inside it (next to `is_premium`):

```python
    # Supporter badge (90 days after Premium → Tip migration cutover).
    # Independent of `is_premium`/`premium_expires`, which remain dormant.
    supporter_until = Column(DateTime, nullable=True)
```

Then add a new `Tip` model below `User` (before `__table_args__` lines or after the class — any consistent spot):

```python
class Tip(Base):
    """One paid tip via Polar. Idempotent by polar_order_id."""
    __tablename__ = "tips"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String(64), nullable=False, index=True)
    host_email = Column(String(255), nullable=False, index=True)
    amount_total_usd = Column(String(16), nullable=False)  # decimal as string to avoid float
    amount_charged_usd = Column(String(16), nullable=False)
    is_split = Column(Boolean, nullable=False, default=False)
    participant_count = Column(Integer, nullable=False, default=1)
    polar_order_id = Column(String(128), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
```

Then extend `_run_migrations` (line ~32) to add the column on existing DBs:

```python
    migrations = [
        "ALTER TABLE session_snapshots ADD COLUMN IF NOT EXISTS bill_name VARCHAR(255)",
        "ALTER TABLE session_snapshots ADD COLUMN IF NOT EXISTS merchant_name VARCHAR(255)",
        "ALTER TABLE session_snapshots ADD COLUMN IF NOT EXISTS user_id UUID",
        "ALTER TABLE session_snapshots ADD COLUMN IF NOT EXISTS totals JSON",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS supporter_until TIMESTAMP",
    ]
```

The `tips` table is auto-created by `Base.metadata.create_all(bind=engine)` in `init_db()` — no manual SQL needed for the new table.

- [ ] **Step 4: Run the tests again, expect pass**

Run: `cd backend && python -m pytest test_supporter_migration.py -v`
Expected: 4 passes.

- [ ] **Step 5: Commit**

```bash
git add backend/postgres_db.py backend/test_supporter_migration.py
git commit -m "feat(db): supporter_until column en users + tabla tips"
```

---

### Task A2: One-shot Premium → Supporter migration

**Files:**
- Modify: `backend/postgres_db.py` (add `migrate_premium_to_supporter()` + invoke in `init_db()`)
- Modify: `backend/test_supporter_migration.py` (add test)

- [ ] **Step 1: Write the failing test**

Append to `backend/test_supporter_migration.py`:

```python
def test_migrate_premium_to_supporter_uses_premium_expires_when_future(monkeypatch):
    """If user has premium_expires in the future, supporter_until = expires + 90d."""
    from postgres_db import migrate_premium_to_supporter, User
    fake_now = datetime(2026, 5, 23, 12, 0, 0)

    class FakeQuery:
        def filter(self, *args, **kwargs):
            return self
        def update(self, mapping, synchronize_session=False):
            self.mapping = mapping
            return 1

    class FakeSession:
        def __init__(self):
            self.executed = []
        def execute(self, stmt):
            self.executed.append(stmt)
            class R: rowcount = 1
            return R()
        def commit(self): pass

    captured = {}
    def fake_text(sql):
        captured["sql"] = sql
        return sql
    monkeypatch.setattr("postgres_db.text", fake_text, raising=False)

    sess = FakeSession()
    result = migrate_premium_to_supporter(sess, now=fake_now)
    assert "supporter_until" in captured["sql"].lower()
    assert "is_premium" in captured["sql"].lower()
    assert "interval '90 days'" in captured["sql"].lower() or "interval" in captured["sql"].lower()
    assert result.get("rows_updated") == 1
```

(Note: this test exercises the SQL shape, not the exact DB outcome — Postgres is mocked. The migration itself runs against a real DB on `init_db()`.)

- [ ] **Step 2: Run the test, expect fail**

Run: `cd backend && python -m pytest test_supporter_migration.py::test_migrate_premium_to_supporter_uses_premium_expires_when_future -v`
Expected: ImportError (`migrate_premium_to_supporter` does not exist).

- [ ] **Step 3: Implement the migration helper**

In `backend/postgres_db.py`, add near the bottom (after other helpers):

```python
from sqlalchemy import text  # ensure text is imported at top of file if not already


def migrate_premium_to_supporter(db_session=None, *, now=None) -> Dict[str, Any]:
    """One-shot migration: set supporter_until for every is_premium=True user.

    Idempotent: re-running on already-migrated users overwrites supporter_until
    to the same formula. Safe to call on every init_db().

    Formula: supporter_until = GREATEST(now, premium_expires) + 90 days
    """
    if now is None:
        now = datetime.utcnow()

    sql = text(
        """
        UPDATE users
        SET supporter_until = COALESCE(
            GREATEST(:now, premium_expires),
            :now
        ) + INTERVAL '90 days'
        WHERE is_premium = TRUE
          AND (supporter_until IS NULL OR supporter_until < :now)
        """
    )

    if db_session is not None:
        result = db_session.execute(sql, {"now": now})
        db_session.commit()
        return {"rows_updated": getattr(result, "rowcount", 0)}

    # Fall back to global engine if no session passed (init_db usage).
    if engine is None:
        return {"rows_updated": 0, "skipped": "engine_unavailable"}
    with engine.connect() as conn:
        result = conn.execute(sql, {"now": now})
        conn.commit()
        return {"rows_updated": getattr(result, "rowcount", 0)}
```

Then in `init_db()` (line ~58), after `_run_migrations(engine)`, add:

```python
        # One-shot Premium → Supporter migration. Idempotent.
        try:
            stats = migrate_premium_to_supporter(now=datetime.utcnow())
            print(f"Supporter migration: {stats}")
        except Exception as e:
            print(f"Supporter migration warning (may be OK): {e}")
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd backend && python -m pytest test_supporter_migration.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/postgres_db.py backend/test_supporter_migration.py
git commit -m "feat(db): migracion idempotente premium→supporter (90d badge)"
```

---

### Task A3: Raise FREE_SESSIONS_LIMIT to 500

**Files:**
- Modify: `backend/free_tier.py:29`
- Modify: `backend/test_free_tier.py` (update affected test expectations)

- [ ] **Step 1: Update the constant**

In `backend/free_tier.py:29`, change:

```python
FREE_SESSIONS_LIMIT = 5
```

to:

```python
# Anti-abuse defense only; reachable only by automated scripts/abuse,
# not by humans. The "5 boletas free + Premium $3.49" model was retired
# 2026-05-23 in favor of voluntary tips. See spec
# docs/superpowers/specs/2026-05-23-tips-only-model-design.md
FREE_SESSIONS_LIMIT = 500
```

- [ ] **Step 2: Inspect existing tests for hardcoded `5`**

Run: `cd backend && grep -n "FREE_SESSIONS_LIMIT\|sessions_limit\|free_remaining" test_free_tier.py`
Expected: list of tests referencing the old limit. Update any test that hardcodes `5` or asserts `sessions_limit == 5` to compare against `FREE_SESSIONS_LIMIT` symbolically (import from `free_tier`) or update to `500`. If a test exercises "blocked at 5", consider either (a) rewriting it to construct a list of 500 ids (slow) or (b) parametrizing on a smaller constant via `monkeypatch.setattr(free_tier, "FREE_SESSIONS_LIMIT", 5)`. Prefer (b).

- [ ] **Step 3: Run the suite**

Run: `cd backend && python -m pytest test_free_tier.py -v`
Expected: all pass after the test adjustments.

- [ ] **Step 4: Commit**

```bash
git add backend/free_tier.py backend/test_free_tier.py
git commit -m "chore(free-tier): subir cap a 500 (defensa antiabuso, modelo tips-only)"
```

---

### Task A4: Extend `polar_service.create_checkout` with optional `amount`

**Files:**
- Modify: `backend/polar_service.py:36-79`
- Create: `backend/test_tips.py` (first test)

- [ ] **Step 1: Write the failing test**

Create `backend/test_tips.py`:

```python
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
```

- [ ] **Step 2: Run the test, expect fail**

Run: `cd backend && python -m pytest test_tips.py::test_create_checkout_accepts_amount_kwarg -v`
Expected: FAIL — `amount` not in signature.

- [ ] **Step 3: Extend `create_checkout`**

In `backend/polar_service.py:36`, change the signature and body construction:

```python
async def create_checkout(
    *,
    product_id: str,
    customer_email: Optional[str] = None,
    success_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    amount: Optional[float] = None,
) -> Dict[str, Any]:
    """Create a hosted checkout session in Polar.

    `amount` (USD) is used for pay-what-you-want products. When provided,
    it is sent in cents as `amount` per the Polar API. Omit for fixed-price
    products.

    On success returns the API response (contains `id` and `url`).
    On failure returns {"_error": ..., "_status": ..., "_base": ...}.
    """
    token = os.getenv("POLAR_ACCESS_TOKEN")
    if not token:
        return {"_error": "POLAR_ACCESS_TOKEN not configured", "_status": 0}

    body: Dict[str, Any] = {"product_id": product_id}
    if customer_email:
        body["customer_email"] = customer_email
    if success_url:
        body["success_url"] = success_url
    if amount is not None:
        body["amount"] = int(round(amount * 100))  # Polar expects cents
    if metadata:
        body["metadata"] = {k: str(v) for k, v in metadata.items() if v is not None}
    # ... rest unchanged
```

(Leave the `httpx.AsyncClient.post(...)` block as-is.)

- [ ] **Step 4: Run the tests, expect pass**

Run: `cd backend && python -m pytest test_tips.py -v`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/polar_service.py backend/test_tips.py
git commit -m "feat(polar): create_checkout acepta amount para productos PWYW"
```

---

### Task A5: New endpoint `POST /api/polar/tip-checkout`

**Files:**
- Modify: `backend/main.py` (add request model + endpoint, near `/api/polar/checkout` at line ~2397)
- Modify: `backend/test_tips.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/test_tips.py`:

```python
def test_tip_checkout_request_model_validates_min_amount():
    from main import TipCheckoutRequest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        TipCheckoutRequest(session_id="abc", amount_usd=0.5, participant_count=1, google_email="g@x.com")


def test_tip_checkout_splits_amount_when_is_split(monkeypatch):
    """When is_split=True, host is charged amount_usd / participant_count."""
    from main import _compute_charged_amount  # helper introduced for testability
    assert _compute_charged_amount(7.0, True, 4) == 1.75
    assert _compute_charged_amount(7.0, False, 4) == 7.0
    assert _compute_charged_amount(7.0, True, 1) == 7.0  # split with 1 participant = full
```

- [ ] **Step 2: Run the tests, expect fail**

Run: `cd backend && python -m pytest test_tips.py -v -k "tip_checkout"`
Expected: ImportError on `TipCheckoutRequest` and `_compute_charged_amount`.

- [ ] **Step 3: Implement the request model, helper, and endpoint**

In `backend/main.py`, near the top with other Pydantic models (search for `class PolarCheckoutRequest`):

```python
class TipCheckoutRequest(BaseModel):
    session_id: str
    amount_usd: float = Field(ge=1.0, description="Total tip in USD. Min $1 (Polar fee floor).")
    is_split: bool = False
    participant_count: int = Field(ge=1, default=1)
    google_email: str
    device_id: Optional[str] = None
```

Add the helper above the endpoint:

```python
def _compute_charged_amount(amount_total: float, is_split: bool, participant_count: int) -> float:
    """How much the host pays via Polar. Editors' share is informational only."""
    if is_split and participant_count > 1:
        return round(amount_total / participant_count, 2)
    return round(amount_total, 2)
```

Then add the endpoint right after `/api/polar/checkout` (around line ~2449):

```python
@app.post("/api/polar/tip-checkout")
async def create_polar_tip_checkout(req: TipCheckoutRequest):
    """Create a Polar PWYW checkout for a tip. Returns hosted URL."""
    if not polar_available or not polar_service.is_configured():
        raise HTTPException(status_code=503, detail="Polar not configured")

    tip_product_id = os.getenv("POLAR_TIP_PRODUCT_ID")
    if not tip_product_id:
        raise HTTPException(status_code=503, detail="POLAR_TIP_PRODUCT_ID not configured")

    frontend_url = os.getenv("FRONTEND_URL", "https://billeocr.com")
    success_url = (
        f"{frontend_url}/s/{req.session_id}"
        f"?tip_success=true&amount={req.amount_usd}"
    )

    charged = _compute_charged_amount(req.amount_usd, req.is_split, req.participant_count)

    metadata = {
        "kind": "tip",
        "session_id": req.session_id,
        "host_email": req.google_email,
        "tip_amount_total": req.amount_usd,
        "tip_amount_charged": charged,
        "is_split": req.is_split,
        "participant_count": req.participant_count,
    }

    checkout = await polar_service.create_checkout(
        product_id=tip_product_id,
        customer_email=req.google_email,
        success_url=success_url,
        metadata=metadata,
        amount=charged,
    )

    if not checkout or "_error" in checkout:
        err = (checkout or {}).get("_error", "unknown")
        status = (checkout or {}).get("_status", 0)
        raise HTTPException(status_code=502, detail=f"Polar {status}: {err}")

    return {
        "checkout_id": checkout.get("id"),
        "checkout_url": checkout.get("url"),
        "amount_charged_usd": charged,
    }
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `cd backend && python -m pytest test_tips.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_tips.py
git commit -m "feat(api): endpoint /api/polar/tip-checkout con split host/editores"
```

---

### Task A6: Extend Polar webhook to record paid tips

**Files:**
- Modify: `backend/main.py:2472-2508` (webhook handler `order.paid` branch)
- Modify: `backend/postgres_db.py` (add `record_tip` helper)
- Modify: `backend/test_tips.py`

- [ ] **Step 1: Write the failing test for the helper**

Append to `backend/test_tips.py`:

```python
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
```

- [ ] **Step 2: Run the tests, expect fail**

Run: `cd backend && python -m pytest test_tips.py -v -k "record_tip"`
Expected: ImportError on `record_tip`.

- [ ] **Step 3: Implement `record_tip` and extend the webhook**

In `backend/postgres_db.py`, add helper:

```python
def record_tip(
    db,
    *,
    session_id: str,
    host_email: str,
    amount_total_usd: float,
    amount_charged_usd: float,
    is_split: bool,
    participant_count: int,
    polar_order_id: str,
) -> bool:
    """Insert a Tip row. Returns False if polar_order_id already exists (idempotent)."""
    existing = db.query(Tip).filter_by(polar_order_id=polar_order_id).first()
    if existing is not None:
        return False
    tip = Tip(
        session_id=session_id,
        host_email=host_email,
        amount_total_usd=f"{amount_total_usd:.2f}",
        amount_charged_usd=f"{amount_charged_usd:.2f}",
        is_split=is_split,
        participant_count=participant_count,
        polar_order_id=polar_order_id,
    )
    db.add(tip)
    db.commit()
    return True
```

In `backend/main.py:2472` (`if event_type == "order.paid":`), insert a tip branch BEFORE the existing premium-granting logic. Read `metadata.get("kind")` to discriminate:

```python
    if event_type == "order.paid":
        metadata = data.get("metadata") or {}
        customer = data.get("customer") or {}
        polar_order_id = str(data.get("id") or "")
        email = (
            metadata.get("user_email")
            or metadata.get("host_email")
            or customer.get("email")
            or data.get("customer_email")
        )

        # NEW: tip branch (does not grant premium).
        if metadata.get("kind") == "tip":
            if not email or not polar_order_id:
                print(f"Polar tip received without email or order id: {metadata}")
                return {"received": True}
            if postgres_available:
                try:
                    with postgres_db.get_db() as db:
                        if db is not None:
                            recorded = postgres_db.record_tip(
                                db,
                                session_id=str(metadata.get("session_id") or ""),
                                host_email=email,
                                amount_total_usd=float(metadata.get("tip_amount_total") or 0),
                                amount_charged_usd=float(metadata.get("tip_amount_charged") or 0),
                                is_split=str(metadata.get("is_split")).lower() == "true",
                                participant_count=int(metadata.get("participant_count") or 1),
                                polar_order_id=polar_order_id,
                            )
                            print(f"Polar tip recorded={recorded} order={polar_order_id} email={email}")
                except Exception as e:
                    print(f"Polar tip persist failed: {e}")
            # PostHog event via existing analytics surface (best-effort).
            try:
                from analytics import capture_event
                capture_event(
                    "tip_paid_webhook",
                    distinct_id=email,
                    properties={
                        "amount_total": float(metadata.get("tip_amount_total") or 0),
                        "amount_charged": float(metadata.get("tip_amount_charged") or 0),
                        "is_split": str(metadata.get("is_split")).lower() == "true",
                        "participant_count": int(metadata.get("participant_count") or 1),
                        "polar_order_id": polar_order_id,
                    },
                )
            except Exception as e:
                print(f"Polar tip analytics failed: {e}")
            return {"received": True}

        # EXISTING premium-granting logic continues unchanged below this point...
```

(Verify the `analytics.capture_event` name in your tree; if the helper is named differently, e.g. `track_event`, adapt accordingly.)

- [ ] **Step 4: Run the tests, expect pass**

Run: `cd backend && python -m pytest test_tips.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/postgres_db.py backend/test_tips.py
git commit -m "feat(api): polar webhook persiste tips idempotente + tracking PostHog"
```

---

## Phase B — Frontend

> **Note:** The frontend has no Jest/Vitest setup. Verification steps below use type-check + manual browser smoke tests. Do NOT skip the manual smoke tests; they are the only safety net.

### Task B1: `lib/api.ts` — types and `createTipCheckout`

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add request/response types**

In `frontend/src/lib/api.ts`, add near other request/response types:

```ts
// Tip checkout
export interface CreateTipCheckoutRequest {
  session_id: string;
  amount_usd: number;
  is_split: boolean;
  participant_count: number;
  google_email: string;
  device_id?: string;
}

export interface CreateTipCheckoutResponse {
  checkout_id: string;
  checkout_url: string;
  amount_charged_usd: number;
}
```

- [ ] **Step 2: Add the `createTipCheckout` function**

In the same file, add:

```ts
/**
 * Create a Polar PWYW checkout for a voluntary tip.
 * Returns the hosted checkout URL.
 */
export async function createTipCheckout(
  req: CreateTipCheckoutRequest
): Promise<CreateTipCheckoutResponse> {
  return apiRequest<CreateTipCheckoutResponse>("/api/polar/tip-checkout", {
    method: "POST",
    body: JSON.stringify(req),
  });
}
```

- [ ] **Step 3: Verify the type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api-client): createTipCheckout + types para PWYW tip"
```

---

### Task B2: `lib/auth.ts` — add `supporter_until` field

**Files:**
- Modify: `frontend/src/lib/auth.ts`

- [ ] **Step 1: Extend `AuthUser`**

In `frontend/src/lib/auth.ts`, locate `AuthUser` interface (line ~17-25) and add:

```ts
export interface AuthUser {
  // ... existing fields ...
  is_premium: boolean;
  premium_expires?: string;
  supporter_until?: string;  // ISO timestamp; if > now(), show "Supporter ✨" badge
}
```

Update `setStoredUser` / `getStoredUser` if either explicitly whitelists fields (search for usages); they likely just serialize the whole object, in which case no change is needed.

- [ ] **Step 2: Add `isSupporter(user)` helper**

In `frontend/src/lib/auth.ts`, add:

```ts
/**
 * True iff the user has an active supporter badge.
 * Premium users migrated on 2026-05-23 receive `supporter_until = now + 90d`.
 */
export function isSupporter(user: AuthUser | null | undefined): boolean {
  if (!user?.supporter_until) return false;
  const until = new Date(user.supporter_until).getTime();
  return Number.isFinite(until) && until > Date.now();
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/auth.ts
git commit -m "feat(auth): campo supporter_until y helper isSupporter"
```

---

### Task B3: i18n keys for the tip widget (en + es seed)

**Files:**
- Modify: `frontend/src/lib/i18n.ts`

- [ ] **Step 1: Add keys to English and Spanish**

Open `frontend/src/lib/i18n.ts`. Locate the `en` and `es` blocks. Add the following keys to **both** (using the existing key-path convention; if i18n uses flat keys, prefix with `tip_`):

For `en`:
```ts
  // Tip widget (StepShare)
  tip_widget_title: "Support Bill-e",
  tip_widget_subtitle: "Your tip keeps the developer awake ☕",
  tip_preset_3: "$3",
  tip_preset_7: "$7",
  tip_preset_15: "$15",
  tip_preset_custom: "Other",
  tip_custom_min_error: "Minimum $1 USD",
  tip_split_toggle: "Split Bill-e among everyone ({count} people)",
  tip_split_per_person: "${amount} each — shows as \"Bill-e\" in their share",
  tip_cta: "Tip ${amount}",
  tip_thanks_title: "✓ Thanks for your support",
  tip_thanks_again: "Tip again",
  tip_meet_developer: "Meet the developer →",
  // Header badge
  badge_supporter: "Supporter ✨",
```

For `es` (LATAM neutro, sin voseo):
```ts
  tip_widget_title: "Apoya a Bill-e",
  tip_widget_subtitle: "Tu tip mantiene al desarrollador despierto ☕",
  tip_preset_3: "$3",
  tip_preset_7: "$7",
  tip_preset_15: "$15",
  tip_preset_custom: "Otro",
  tip_custom_min_error: "Mínimo $1 USD",
  tip_split_toggle: "Dividir Bill-e entre todos ({count} personas)",
  tip_split_per_person: "${amount} c/u — aparece como \"Bill-e\" en su parte",
  tip_cta: "Dar tip ${amount}",
  tip_thanks_title: "✓ Gracias por tu apoyo",
  tip_thanks_again: "Dar otro tip",
  tip_meet_developer: "Conoce al desarrollador →",
  badge_supporter: "Supporter ✨",
```

Other 10 languages: leave English fallback for now. **A separate translation task** will fill them following the project's existing translation flow (per memoria `feedback_i18n_neutral.md`).

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/i18n.ts
git commit -m "feat(i18n): keys del tip widget en en/es (resto pendiente)"
```

---

### Task B4: `MeetTheDeveloper` component

**Files:**
- Create: `frontend/src/components/MeetTheDeveloper.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { getTranslator, type Language } from "@/lib/i18n";

interface Props {
  lang: Language;
}

/**
 * Expandable "Meet the developer" card. Shown inline below the TipWidget CTA.
 * The bio is authored by Gonzalo (placeholder content here — replace before launch).
 */
export function MeetTheDeveloper({ lang }: Props) {
  const t = getTranslator(lang);
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-emerald-600 underline-offset-2 hover:underline"
        aria-expanded={open}
      >
        {t("tip_meet_developer")}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 flex gap-3 items-start">
          {/* TODO(Gonzalo): replace src with your photo at /public/about/gonzalo.jpg
              and write your bio. This placeholder must be replaced before launch. */}
          <div className="h-12 w-12 shrink-0 rounded-full bg-emerald-200 flex items-center justify-center text-emerald-700 font-semibold">
            G
          </div>
          <p className="text-gray-700 leading-relaxed">
            {/* Bio placeholder — Gonzalo to author before launch. */}
            (bio pendiente)
          </p>
        </div>
      )}
    </div>
  );
}
```

The TODO is explicit; Gonzalo replaces the placeholder text and avatar before launch.

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MeetTheDeveloper.tsx
git commit -m "feat(ui): componente MeetTheDeveloper expandible (placeholder bio)"
```

---

### Task B5: `TipWidget` component

**Files:**
- Create: `frontend/src/components/TipWidget.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMemo, useState, useEffect } from "react";
import { createTipCheckout } from "@/lib/api";
import { getTranslator, type Language } from "@/lib/i18n";
import { MeetTheDeveloper } from "./MeetTheDeveloper";
import { trackTipPresetClicked, trackTipCustomEntered, trackTipSplitToggled, trackTipCheckoutStarted } from "@/lib/tracking";

const PRESETS = [3, 7, 15] as const;
const DEFAULT_PRESET = 7;
const MIN_CUSTOM = 1;

interface Props {
  sessionId: string;
  participantCount: number;  // editors + host
  hostEmail: string;
  lang: Language;
  /** Already-tipped flag from `?tip_success=true` URL query. */
  alreadyTipped?: boolean;
}

export function TipWidget({
  sessionId,
  participantCount,
  hostEmail,
  lang,
  alreadyTipped = false,
}: Props) {
  const t = getTranslator(lang);
  const [selected, setSelected] = useState<number | "custom">(DEFAULT_PRESET);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isSplit, setIsSplit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(alreadyTipped);

  useEffect(() => { setCollapsed(alreadyTipped); }, [alreadyTipped]);

  const totalAmount = useMemo(() => {
    if (selected === "custom") {
      const n = parseFloat(customAmount);
      return Number.isFinite(n) ? n : 0;
    }
    return selected;
  }, [selected, customAmount]);

  const canSplit = participantCount >= 2;
  const chargedAmount = useMemo(() => {
    if (isSplit && canSplit) return Math.round((totalAmount / participantCount) * 100) / 100;
    return totalAmount;
  }, [totalAmount, isSplit, participantCount, canSplit]);

  const isValid = totalAmount >= MIN_CUSTOM;

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      trackTipCheckoutStarted({
        amount_total: totalAmount,
        amount_charged_host: chargedAmount,
        is_split: isSplit && canSplit,
      });
      const res = await createTipCheckout({
        session_id: sessionId,
        amount_usd: totalAmount,
        is_split: isSplit && canSplit,
        participant_count: participantCount,
        google_email: hostEmail,
      });
      window.location.href = res.checkout_url;
    } catch (e: any) {
      setError(e?.message || "Error");
      setSubmitting(false);
    }
  }

  if (collapsed) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="text-emerald-700 font-medium">{t("tip_thanks_title")}</p>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-2 text-sm text-emerald-600 underline-offset-2 hover:underline"
        >
          {t("tip_thanks_again")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
      <h3 className="font-semibold text-gray-900">💚 {t("tip_widget_title")}</h3>
      <p className="text-sm text-gray-600 mt-1">{t("tip_widget_subtitle")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => {
              setSelected(amount);
              trackTipPresetClicked({ amount, was_default: amount === DEFAULT_PRESET });
            }}
            className={
              "px-4 py-2 rounded-lg border " +
              (selected === amount
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-white text-gray-700 border-gray-300 hover:border-emerald-400")
            }
          >
            ${amount}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelected("custom")}
          className={
            "px-4 py-2 rounded-lg border " +
            (selected === "custom"
              ? "bg-emerald-600 text-white border-emerald-600"
              : "bg-white text-gray-700 border-gray-300 hover:border-emerald-400")
          }
        >
          {t("tip_preset_custom")}
        </button>
      </div>

      {selected === "custom" && (
        <div className="mt-3">
          <input
            type="number"
            inputMode="decimal"
            min={MIN_CUSTOM}
            step="0.5"
            value={customAmount}
            onChange={(e) => {
              setCustomAmount(e.target.value);
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= MIN_CUSTOM) {
                trackTipCustomEntered({ amount: n });
              }
            }}
            placeholder={`$${MIN_CUSTOM}.00`}
            className="w-full px-3 py-2 rounded-lg border border-gray-300"
          />
          {customAmount && totalAmount < MIN_CUSTOM && (
            <p className="text-xs text-red-600 mt-1">{t("tip_custom_min_error")}</p>
          )}
        </div>
      )}

      {canSplit && (
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={isSplit}
            onChange={(e) => {
              setIsSplit(e.target.checked);
              trackTipSplitToggled({ is_on: e.target.checked, participants: participantCount });
            }}
            className="mt-1"
          />
          <span>
            {t("tip_split_toggle").replace("{count}", String(participantCount))}
            {isSplit && (
              <span className="block text-xs text-gray-500 mt-0.5">
                {t("tip_split_per_person").replace("{amount}", chargedAmount.toFixed(2))}
              </span>
            )}
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="mt-4 w-full px-4 py-3 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
      >
        {t("tip_cta").replace("{amount}", chargedAmount.toFixed(2))}
      </button>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      <MeetTheDeveloper lang={lang} />
    </div>
  );
}
```

- [ ] **Step 2: Stub the tracking functions (will be implemented in B7)**

Edit `frontend/src/lib/tracking.ts`, add:

```ts
export function trackTipPresetClicked(p: { amount: number; was_default: boolean }) { capture("tip_preset_clicked", p); }
export function trackTipCustomEntered(p: { amount: number }) { capture("tip_custom_entered", p); }
export function trackTipSplitToggled(p: { is_on: boolean; participants: number }) { capture("tip_split_toggled", p); }
export function trackTipCheckoutStarted(p: { amount_total: number; amount_charged_host: number; is_split: boolean }) { capture("tip_checkout_started", p); }
export function trackTipWidgetShown(p: { session_id: string; participant_count: number; is_supporter: boolean }) { capture("tip_widget_shown", p); }
export function trackTipCheckoutReturned(p: { success: boolean; amount: number }) { capture("tip_checkout_returned", p); }
export function trackTipSkipped(p: { session_id: string }) { capture("tip_skipped", p); }
```

(Where `capture` is the existing PostHog wrapper in `tracking.ts`. If the wrapper is named differently — e.g. `track`, `trackEvent` — adapt accordingly. Confirm by grepping `tracking.ts` for the existing function used by other `trackXxx` exports.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TipWidget.tsx frontend/src/lib/tracking.ts
git commit -m "feat(ui): TipWidget con presets, split, custom min y tracking stubs"
```

---

### Task B6: Integrate `TipWidget` into `StepShare`, replacing split-subscription block

**Files:**
- Modify: `frontend/src/components/steps/StepShare.tsx`

- [ ] **Step 1: Locate the existing split-subscription block**

Run: `cd frontend && grep -n "billCostShared\|premiumPrice\|splitSubscription\|split.*premium" src/components/steps/StepShare.tsx`
Read the relevant block to confirm the boundaries (the props passed in and the toggle/preview JSX).

- [ ] **Step 2: Replace the block**

Remove the existing split-subscription card (the JSX block that displays the toggle "Dividir Bill-e entre todos" preview with cards showing host + other). Replace it with the `<TipWidget />` invocation:

```tsx
import { TipWidget } from "@/components/TipWidget";
// ... existing imports ...

// Inside the component, after the share CTA, replace the split-subscription block with:
<TipWidget
  sessionId={sessionId}
  participantCount={participants.length}
  hostEmail={user?.email ?? ""}
  lang={lang}
  alreadyTipped={searchParams.get("tip_success") === "true"}
/>
```

Adjust prop names to match what StepShare already has in scope (`sessionId`, `participants`, `user`, `lang`, etc.). Remove the now-unused state (`billCostShared`, helper computations like `hostRecovery`, `premiumPrice` injection) **only if they are no longer referenced**. If `premiumPrice` is still used by the bill total/inline summary for any other purpose, leave it.

- [ ] **Step 3: Emit `tip_widget_shown` on mount**

Add a `useEffect` near the top of `StepShare` that fires once when the share step renders:

```tsx
useEffect(() => {
  trackTipWidgetShown({
    session_id: sessionId,
    participant_count: participants.length,
    is_supporter: isSupporter(user),
  });
}, [sessionId]);
```

Import `trackTipWidgetShown` from `@/lib/tracking` and `isSupporter` from `@/lib/auth`.

- [ ] **Step 4: Type-check + manual smoke test**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

Then run the dev server: `cd frontend && npm run dev`
Open `http://localhost:3000`, walk through OCR → edit → reach StepShare. Verify:
- The TipWidget renders below the share CTA.
- Presets selectable; $7 default highlighted.
- "Other" expands to numeric input, blocks values < $1.
- Split toggle visible if 2+ participants; per-person amount updates live.
- Clicking "Dar tip $X" attempts to navigate to Polar (will fail without `POLAR_TIP_PRODUCT_ID` configured locally — that is OK at this stage; error message is acceptable).
- "Conoce al desarrollador →" expands the placeholder card.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/steps/StepShare.tsx
git commit -m "feat(step-share): reemplaza split-subscription por TipWidget"
```

---

### Task B7: Tip success state on return from Polar

**Files:**
- Modify: `frontend/src/app/s/[sessionId]/page.tsx` (or wherever the session page reads URL params)

- [ ] **Step 1: Read and track `?tip_success`**

In `frontend/src/app/s/[sessionId]/page.tsx`, locate the `useSearchParams()` usage (search for `tip_success` first to confirm not already handled). Add a `useEffect` that fires `trackTipCheckoutReturned` when `tip_success=true` appears:

```tsx
useEffect(() => {
  const tipSuccess = searchParams.get("tip_success");
  if (tipSuccess === "true") {
    const amount = parseFloat(searchParams.get("amount") || "0");
    trackTipCheckoutReturned({ success: true, amount });
  }
}, []);
```

The `TipWidget` already reads `alreadyTipped` from its parent (which checks the same query param via Task B6, Step 2). No additional state plumbing needed.

- [ ] **Step 2: Optional — clear the URL params after read**

To avoid the success state persisting if the user navigates away and back, after firing the event, use `router.replace(\`/s/${sessionId}\`)` to scrub the params. This is optional polish.

- [ ] **Step 3: Manual smoke test**

Simulate the return by appending `?tip_success=true&amount=7` to a session URL in the browser. Verify the `TipWidget` shows the "✓ Gracias por tu apoyo" state.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/s/[sessionId]/page.tsx
git commit -m "feat(s/[id]): tracking de tip_checkout_returned al volver de Polar"
```

---

### Task B8: Header badge — Supporter takes precedence over Premium/Free

**Files:**
- Modify: header component (locate in Step 1)

- [ ] **Step 1: Find the header tier badge**

Run: `cd frontend && grep -rn "Premium\|Free" src/components/ | grep -i "header\|badge\|tier"` and `grep -rn "isPremium" src/components/ | head -20`. Identify the component that renders the avatar + tier badge (per memoria, added in commit `df0585b`).

- [ ] **Step 2: Update the badge logic**

In the identified header component, replace the existing Premium/Free conditional with:

```tsx
import { isSupporter } from "@/lib/auth";

// ... inside the component:
{isSupporter(user)
  ? <span className="badge-supporter">{t("badge_supporter")}</span>
  : null}
```

Remove or comment-out the legacy `isPremium ? "Premium" : "Free"` rendering (they are no longer meaningful badges in the new model — supporter or nothing). Keep the avatar itself.

- [ ] **Step 3: Type-check + manual smoke test**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

Manual smoke: log in as a user whose `supporter_until > now()` in the backend → header shows "Supporter ✨". Log in as a user without the field → header shows no badge. Log in as a never-paid user → header shows no badge.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/<header-file>.tsx
git commit -m "feat(header): badge Supporter sustituye a Premium/Free"
```

---

## Phase C — Comms

### Task C1: Landing copy update

**Files:**
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: Replace Premium-pricing copy**

Run: `cd frontend && grep -n "3\\.49\\|Premium\\|premium" src/app/page.tsx`
Replace any hero/pricing text that names "$3.49" or "Premium" with the new positioning: **"Gratis. Con tips voluntarios si te sirve."** (Spanish) / **"Free. With voluntary tips if it helps you."** (English fallback).

Use existing i18n keys if the landing uses translations; otherwise add new keys.

- [ ] **Step 2: Manual smoke**

Run `npm run dev`, open `/`, confirm Premium pricing block is gone, new copy reads correctly in both en and es.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/lib/i18n.ts
git commit -m "feat(landing): copy gratis-con-tips reemplaza precio Premium"
```

---

### Task C2: Privacy/FAQ note about the model change

**Files:**
- Modify: privacy page (locate in Step 1)

- [ ] **Step 1: Locate the privacy/about page**

Run: `cd frontend && grep -rln "privacy\\|privacidad\\|FAQ" src/app/ | head -10`. Identify the page(s) where a brief note belongs.

- [ ] **Step 2: Add the note**

Add a short paragraph (en + es) explaining the 2026-05-23 model change. Suggested:

- **EN**: "On 2026-05-23 Bill-e migrated from a paid Premium model ($3.49) to a free model funded by voluntary tips. Users who had paid Premium retain a 'Supporter ✨' badge for 90 days as a thank-you. No refunds are issued automatically. If you have questions about a past payment, contact us."
- **ES**: "El 2026-05-23 Bill-e cambió de un modelo Premium pagado ($3.49) a un modelo gratis sostenido por tips voluntarios. Los usuarios que pagaron Premium conservan un badge 'Supporter ✨' por 90 días como agradecimiento. No hay reembolsos automáticos. Si tienes una consulta sobre un pago previo, escríbenos."

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/<privacy-file>
git commit -m "docs(privacy): nota del cambio de modelo a tips voluntarios"
```

---

## Phase D — Final verification

### Task D1: End-to-end manual smoke

- [ ] **Step 1: Backend boot**

Run: `cd backend && uvicorn main:app --reload --port 8000`
Expected: log lines:
- `PostgreSQL database initialized successfully`
- `Database migrations completed successfully`
- `Supporter migration: {'rows_updated': N}` (N ≥ 0)

- [ ] **Step 2: Frontend boot**

Run: `cd frontend && npm run dev`
Expected: server on `http://localhost:3000`.

- [ ] **Step 3: Walk a full host flow**

1. Open `/`, confirm new landing copy.
2. Upload a receipt → reach StepEdit.
3. Reach StepShare. Confirm:
   - TipWidget present, $7 highlighted.
   - Choose $3, then "Otro" + enter $5, confirm minimum guard at $0.50.
   - With 2+ participants present, toggle "Dividir entre todos", confirm per-person amount.
   - Click "Dar tip $X" — confirm POST to `/api/polar/tip-checkout` (check Network tab) returns a Polar URL (or 503 if `POLAR_TIP_PRODUCT_ID` not set locally — that is expected without the env var).
4. Open dev tools → Application → Local Storage; confirm `auth.ts` does not break for `supporter_until=undefined`.
5. Simulate return: navigate to `/s/<session_id>?tip_success=true&amount=7`. Confirm TipWidget shows the "✓ Gracias por tu apoyo" state.

- [ ] **Step 4: Confirm PostHog events**

In PostHog → Activity, filter for: `tip_widget_shown`, `tip_preset_clicked`, `tip_split_toggled`, `tip_checkout_started`. Each should appear from the manual smoke flow above. `tip_paid_webhook` requires a real Polar payment — defer to staging/prod validation.

- [ ] **Step 5: Pre-deploy checklist**

- [ ] Polar dashboard: "Bill-e Tip" PWYW product created; `POLAR_TIP_PRODUCT_ID` set on Render env.
- [ ] Polar webhook URL configured to `/api/polar/webhook` (already configured from existing Premium flow — no change needed).
- [ ] PostHog dashboard "Tips" created with the funnel + KPI insights from spec Sección 5.
- [ ] Bio + photo replaced in `MeetTheDeveloper.tsx` (TODO removed).
- [ ] Translations for the other 10 languages either authored or accepted to fall through to English temporarily.

- [ ] **Step 6: Final commit (if any pending docs touched during smoke)**

```bash
git status
# If anything pending:
git add <files>
git commit -m "chore: ajustes post-smoke"
```

---

## Done criteria

- All Phase A backend tests pass: `cd backend && python -m pytest test_supporter_migration.py test_tips.py test_free_tier.py -v`
- `npx tsc --noEmit` clean in frontend.
- Manual smoke (Task D1) green from upload → tip checkout.
- Telemetry events visible in PostHog.
- Spec Sección 6 (cleanup) NOT executed in this plan — scheduled 2-4 weeks post-launch.
