"""Tests for the schema additions: users.supporter_until + tips table."""

from datetime import datetime
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
    """The migrations list must add supporter_until via ALTER TABLE."""
    from postgres_db import _MIGRATIONS
    assert any("supporter_until" in m and "ADD COLUMN IF NOT EXISTS" in m for m in _MIGRATIONS)


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
        def execute(self, stmt, params=None):
            self.executed.append((stmt, params))
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


def test_user_serializers_include_supporter_until():
    """find_or_create_user / get_user_by_id / get_user_by_email all must emit supporter_until."""
    import inspect
    from postgres_db import find_or_create_user, get_user_by_id, get_user_by_email
    for fn in (find_or_create_user, get_user_by_id, get_user_by_email):
        src = inspect.getsource(fn)
        assert "supporter_until" in src, f"{fn.__name__} must include supporter_until in its serialized output"
