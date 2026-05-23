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
