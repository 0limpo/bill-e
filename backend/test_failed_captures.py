"""
Standalone tests para persist_failed_capture y prune_old_captures.

Usa un engine SQLite in-memory para no tocar Postgres real. Run:
    python backend/test_failed_captures.py
"""

import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))

# Ensure UTF-8 output on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Configurar SQLite in-memory ANTES de importar postgres_db
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import postgres_db  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402


def _setup_fake_db():
    """Initialize a fresh SQLite in-memory DB with the schema."""
    eng = create_engine("sqlite:///:memory:")
    postgres_db.Base.metadata.create_all(bind=eng)
    postgres_db.engine = eng
    postgres_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=eng)
    postgres_db.db_available = True


def test_persist_hard_fail():
    _setup_fake_db()
    postgres_db.persist_failed_capture(
        image_bytes=b"\xff\xd8\xff\xe0fake",
        image_mime="image/jpeg",
        reason="hard_fail",
        error_msg="Gemini timeout",
        gemini_raw=None,
        session_id="sess-123",
        endpoint="ocr",
        ip_hash="abc",
    )
    with postgres_db.get_db() as db:
        rows = db.query(postgres_db.FailedOcrCapture).all()
    assert len(rows) == 1
    r = rows[0]
    assert r.reason == "hard_fail"
    assert r.error_msg == "Gemini timeout"
    assert r.gemini_raw is None
    assert r.image_bytes == b"\xff\xd8\xff\xe0fake"
    assert r.session_id == "sess-123"
    assert r.endpoint == "ocr"


def test_persist_needs_review():
    _setup_fake_db()
    postgres_db.persist_failed_capture(
        image_bytes=b"\x89PNG\r\n\x1a\nfake",
        image_mime="image/png",
        reason="needs_review",
        error_msg=None,
        gemini_raw={"items": [], "needs_review": True},
        session_id="sess-456",
        endpoint="upload",
        ip_hash=None,
    )
    with postgres_db.get_db() as db:
        rows = db.query(postgres_db.FailedOcrCapture).all()
    assert len(rows) == 1
    assert rows[0].reason == "needs_review"
    assert rows[0].gemini_raw == {"items": [], "needs_review": True}


def test_persist_swallows_db_errors():
    _setup_fake_db()
    # Forzar fallo: SessionLocal = None
    postgres_db.SessionLocal = None
    # No debe levantar
    postgres_db.persist_failed_capture(
        image_bytes=b"x",
        image_mime="image/jpeg",
        reason="hard_fail",
        error_msg="err",
        gemini_raw=None,
        session_id="s",
        endpoint="ocr",
        ip_hash=None,
    )
    print("  (swallowed DB error as expected)")


def test_prune_deletes_old_keeps_new():
    _setup_fake_db()
    # Insert una vieja (>30 días) y una reciente manipulando created_at directamente.
    with postgres_db.get_db() as db:
        old = postgres_db.FailedOcrCapture(
            image_bytes=b"old", image_mime="image/jpeg", image_size_bytes=3,
            reason="hard_fail", session_id="old", endpoint="ocr",
            created_at=datetime.utcnow() - timedelta(days=35),
        )
        new = postgres_db.FailedOcrCapture(
            image_bytes=b"new", image_mime="image/jpeg", image_size_bytes=3,
            reason="hard_fail", session_id="new", endpoint="ocr",
            created_at=datetime.utcnow() - timedelta(days=5),
        )
        db.add(old)
        db.add(new)

    deleted = postgres_db.prune_old_captures(retention_days=30)
    assert deleted == 1

    with postgres_db.get_db() as db:
        remaining = db.query(postgres_db.FailedOcrCapture).all()
    assert len(remaining) == 1
    assert remaining[0].session_id == "new"


if __name__ == "__main__":
    test_persist_hard_fail()
    print("✓ persist_hard_fail")
    test_persist_needs_review()
    print("✓ persist_needs_review")
    test_persist_swallows_db_errors()
    print("✓ persist_swallows_db_errors")
    test_prune_deletes_old_keeps_new()
    print("✓ prune_deletes_old_keeps_new")
    print("\nAll failed_captures tests passed.")
