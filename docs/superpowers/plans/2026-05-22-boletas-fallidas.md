# Captura de boletas fallidas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturar automáticamente las imágenes de boletas que fallan el OCR o son marcadas como `needs_review`, persistirlas en Postgres hasta 30 días, y exportarlas a `ocr-benchmark/incoming/` con un script local.

**Architecture:** Modelo SQLAlchemy nuevo (`FailedOcrCapture`) en `postgres_db.py`, función fire-and-forget `persist_failed_capture()` llamada desde el `finally` de los dos endpoints OCR de `main.py`. Auto-prune lazy on-insert (DELETE > 30 días dentro de la misma transacción). Tres endpoints admin (list / image / delete) detrás de un token compartido. Script Python local para sincronizar y borrar.

**Tech Stack:** FastAPI, SQLAlchemy (declarative Base, sessionmaker), Postgres (Render), pytest-style standalone test scripts con fakes en memoria, Python `requests` para el script de sync.

**Spec:** `docs/superpowers/specs/2026-05-22-boletas-fallidas-design.md`

---

## File Structure

**Backend (modificar / crear):**

- `backend/postgres_db.py` — agregar modelo `FailedOcrCapture` + función `persist_failed_capture()` + función `prune_old_captures()` + funciones admin `list_failed_captures()`, `get_failed_capture()`, `delete_failed_capture()`.
- `backend/image_utils.py` — **nuevo**. Una sola función `detect_image_mime(image_bytes) -> str`.
- `backend/ip_utils.py` — **nuevo**. `extract_client_ip(request)` (refactor desde main.py) y `hash_ip(ip)`.
- `backend/main.py` — agregar dependency `verify_admin_token`, los tres endpoints admin, e insertar la llamada a `persist_failed_capture()` en el `finally` de los dos endpoints OCR.
- `backend/test_failed_captures.py` — **nuevo**. Tests standalone con fake DB.
- `backend/test_image_utils.py` — **nuevo**. Tests para `detect_image_mime`.
- `backend/test_ip_utils.py` — **nuevo**. Tests para extract/hash IP.

**Tooling local:**

- `ocr-benchmark/scripts/sync-failed-boletas.py` — **nuevo**. Script CLI.
- `ocr-benchmark/scripts/__init__.py` — **nuevo** vacío si hace falta.

**Frontend:**

- `frontend/src/lib/i18n.ts` — agregar la línea de privacidad en los 12 idiomas (o el archivo donde vivan las strings de la página `/privacy`).

**Infra (manual):**

- Render env var `ADMIN_TOKEN` (string aleatorio, ≥ 32 chars).
- Local: `~/.bill-e-admin-token` o env `BILL_E_ADMIN_TOKEN`.

---

## Task 1: Helper `detect_image_mime` con TDD

**Files:**
- Create: `backend/image_utils.py`
- Test: `backend/test_image_utils.py`

- [ ] **Step 1: Escribir test fallido**

`backend/test_image_utils.py`:

```python
"""
test_image_utils.py

Standalone tests para detect_image_mime. Run:
    python backend/test_image_utils.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import image_utils  # noqa: E402


def test_jpeg():
    # JPEG magic: FF D8 FF
    assert image_utils.detect_image_mime(b"\xff\xd8\xff\xe0\x00\x10JFIF") == "image/jpeg"


def test_png():
    # PNG magic: 89 50 4E 47 0D 0A 1A 0A
    assert image_utils.detect_image_mime(b"\x89PNG\r\n\x1a\n\x00\x00") == "image/png"


def test_webp():
    # WebP: RIFF....WEBP
    assert image_utils.detect_image_mime(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"


def test_unknown_defaults_to_octet_stream():
    assert image_utils.detect_image_mime(b"not a real image") == "application/octet-stream"


def test_empty_bytes():
    assert image_utils.detect_image_mime(b"") == "application/octet-stream"


if __name__ == "__main__":
    test_jpeg()
    test_png()
    test_webp()
    test_unknown_defaults_to_octet_stream()
    test_empty_bytes()
    print("All image_utils tests passed.")
```

- [ ] **Step 2: Correr test y verificar fallo**

```
python backend/test_image_utils.py
```

Expected: `ModuleNotFoundError: No module named 'image_utils'`.

- [ ] **Step 3: Implementar `detect_image_mime`**

`backend/image_utils.py`:

```python
"""Image utilities — pure functions, no I/O."""


def detect_image_mime(image_bytes: bytes) -> str:
    """
    Inspect magic bytes and return the MIME type. Falls back to
    'application/octet-stream' if the format is unrecognized.
    """
    if len(image_bytes) < 4:
        return "application/octet-stream"

    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:4] == b"RIFF" and len(image_bytes) >= 12 and image_bytes[8:12] == b"WEBP":
        return "image/webp"

    return "application/octet-stream"
```

- [ ] **Step 4: Correr test y verificar éxito**

```
python backend/test_image_utils.py
```

Expected: `All image_utils tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/image_utils.py backend/test_image_utils.py
git commit -m "feat(backend): detect_image_mime helper con magic bytes (JPEG/PNG/WebP)"
```

---

## Task 2: Helpers `extract_client_ip` y `hash_ip`

**Files:**
- Create: `backend/ip_utils.py`
- Test: `backend/test_ip_utils.py`

- [ ] **Step 1: Escribir test fallido**

`backend/test_ip_utils.py`:

```python
"""
Standalone tests para ip_utils. Run:
    python backend/test_ip_utils.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import ip_utils  # noqa: E402


class FakeRequest:
    def __init__(self, headers=None, client_host=None):
        self.headers = headers or {}
        self.client = type("C", (), {"host": client_host})() if client_host else None


def test_extract_cf_connecting_ip_wins():
    req = FakeRequest(
        headers={"CF-Connecting-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8"},
        client_host="9.9.9.9",
    )
    assert ip_utils.extract_client_ip(req) == "1.2.3.4"


def test_x_forwarded_for_fallback():
    req = FakeRequest(
        headers={"X-Forwarded-For": "5.6.7.8, 10.0.0.1"},
        client_host="9.9.9.9",
    )
    assert ip_utils.extract_client_ip(req) == "5.6.7.8"


def test_client_host_fallback():
    req = FakeRequest(headers={}, client_host="9.9.9.9")
    assert ip_utils.extract_client_ip(req) == "9.9.9.9"


def test_extract_returns_unknown_if_nothing():
    req = FakeRequest(headers={}, client_host=None)
    assert ip_utils.extract_client_ip(req) == "unknown"


def test_hash_ip_is_sha256_hex():
    h = ip_utils.hash_ip("1.2.3.4")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)
    # Determinism
    assert ip_utils.hash_ip("1.2.3.4") == h


def test_hash_ip_none_returns_none():
    assert ip_utils.hash_ip(None) is None
    assert ip_utils.hash_ip("") is None


if __name__ == "__main__":
    test_extract_cf_connecting_ip_wins()
    test_x_forwarded_for_fallback()
    test_client_host_fallback()
    test_extract_returns_unknown_if_nothing()
    test_hash_ip_is_sha256_hex()
    test_hash_ip_none_returns_none()
    print("All ip_utils tests passed.")
```

- [ ] **Step 2: Correr test y verificar fallo**

```
python backend/test_ip_utils.py
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implementar `ip_utils.py`**

`backend/ip_utils.py`:

```python
"""IP extraction & hashing utilities."""

import hashlib
from typing import Optional


def extract_client_ip(request) -> str:
    """
    Resolve real client IP from common proxy headers.

    Priority:
    1. CF-Connecting-IP (Cloudflare)
    2. X-Forwarded-For (first IP in the comma-separated list)
    3. request.client.host (FastAPI direct)
    4. 'unknown'
    """
    headers = getattr(request, "headers", {}) or {}

    cf = headers.get("CF-Connecting-IP") or headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()

    xff = headers.get("X-Forwarded-For") or headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()

    client = getattr(request, "client", None)
    if client and getattr(client, "host", None):
        return client.host

    return "unknown"


def hash_ip(ip: Optional[str]) -> Optional[str]:
    """SHA-256 hex digest of an IP. Returns None for empty/None input."""
    if not ip:
        return None
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Correr test y verificar éxito**

```
python backend/test_ip_utils.py
```

Expected: `All ip_utils tests passed.`

- [ ] **Step 5: Commit**

```bash
git add backend/ip_utils.py backend/test_ip_utils.py
git commit -m "feat(backend): ip_utils con extract_client_ip y hash_ip"
```

---

## Task 3: Modelo SQLAlchemy `FailedOcrCapture`

**Files:**
- Modify: `backend/postgres_db.py` (agregar el modelo cerca de los otros, después de `Payment`)

- [ ] **Step 1: Agregar el modelo después de los modelos existentes**

Buscar en `postgres_db.py` la sección `# Models` y agregar **al final de esa sección**, antes del primer `def` que viene después:

```python
class FailedOcrCapture(Base):
    """
    Imagen + metadata de boletas que fallaron OCR o quedaron en needs_review.
    Capturadas para alimentar ocr-benchmark/ y mejorar el prompt.
    Retención: 30 días (auto-prune lazy on-insert).
    """
    __tablename__ = "failed_ocr_captures"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    image_bytes = Column(
        # SQLAlchemy LargeBinary maps to bytea on Postgres
        __import__("sqlalchemy").LargeBinary,
        nullable=False,
    )
    image_mime = Column(String(50), nullable=False)
    image_size_bytes = Column(Integer, nullable=False)

    reason = Column(String(20), nullable=False)  # 'hard_fail' | 'needs_review'
    error_msg = Column(Text)
    gemini_raw = Column(JSONB)

    session_id = Column(String(64), nullable=False, index=True)
    endpoint = Column(String(20), nullable=False)  # 'ocr' | 'upload'

    ip_hash = Column(String(64))
```

**Nota:** el `__import__("sqlalchemy").LargeBinary` es un hack para no tener que tocar el import statement de arriba. Si prefieres, agrega `LargeBinary` al import de `sqlalchemy` y úsalo directo:

```python
from sqlalchemy import (
    create_engine, Column, String, Integer, Boolean, DateTime,
    Text, JSON, LargeBinary, Enum as SQLEnum, Index, cast
)
```

y luego `image_bytes = Column(LargeBinary, nullable=False)`. Esta variante es preferible — hazla así.

- [ ] **Step 2: Verificar que el modelo se crea en init_db**

`Base.metadata.create_all(bind=engine)` en `init_db()` (línea ~76) crea automáticamente todas las tablas registradas. No hace falta tocar nada más para que la nueva tabla aparezca.

- [ ] **Step 3: Verificar sintaxis con import**

```
python -c "import sys; sys.path.insert(0, 'backend'); import postgres_db; print(postgres_db.FailedOcrCapture.__tablename__)"
```

Expected: `failed_ocr_captures`

- [ ] **Step 4: Commit**

```bash
git add backend/postgres_db.py
git commit -m "feat(db): modelo FailedOcrCapture para boletas fallidas de OCR"
```

---

## Task 4: Función `persist_failed_capture` + auto-prune

**Files:**
- Modify: `backend/postgres_db.py` (agregar funciones al final)
- Create: `backend/test_failed_captures.py`

- [ ] **Step 1: Escribir test fallido**

`backend/test_failed_captures.py`:

```python
"""
Standalone tests para persist_failed_capture y prune_old_captures.

Usa un engine SQLite in-memory para no tocar Postgres real. Run:
    python backend/test_failed_captures.py
"""

import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))

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
    postgres_db.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=eng)
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
```

- [ ] **Step 2: Correr test y verificar fallo**

```
python backend/test_failed_captures.py
```

Expected: `AttributeError: module 'postgres_db' has no attribute 'persist_failed_capture'`

- [ ] **Step 3: Implementar `persist_failed_capture` + `prune_old_captures`**

Agregar al **final** de `backend/postgres_db.py`:

```python
# ============================================================================
# Failed OCR captures
# ============================================================================

def persist_failed_capture(
    image_bytes: bytes,
    image_mime: str,
    reason: str,                       # 'hard_fail' | 'needs_review'
    error_msg: Optional[str],
    gemini_raw: Optional[Dict[str, Any]],
    session_id: str,
    endpoint: str,                     # 'ocr' | 'upload'
    ip_hash: Optional[str],
) -> None:
    """
    Fire-and-forget. Inserta una captura fallida y aprovecha para borrar
    capturas con > 30 días. Nunca propaga excepciones.
    """
    try:
        if SessionLocal is None:
            return
        with get_db() as db:
            if db is None:
                return
            row = FailedOcrCapture(
                image_bytes=image_bytes,
                image_mime=image_mime,
                image_size_bytes=len(image_bytes),
                reason=reason,
                error_msg=error_msg,
                gemini_raw=gemini_raw,
                session_id=session_id,
                endpoint=endpoint,
                ip_hash=ip_hash,
            )
            db.add(row)
            # Auto-prune dentro de la misma transacción
            cutoff = datetime.utcnow() - timedelta(days=30)
            db.query(FailedOcrCapture).filter(
                FailedOcrCapture.created_at < cutoff
            ).delete(synchronize_session=False)
    except Exception as e:
        print(f"persist_failed_capture failed (swallowed): {e}")


def prune_old_captures(retention_days: int = 30) -> int:
    """Borra capturas más viejas que `retention_days`. Retorna cuántas borró."""
    if SessionLocal is None:
        return 0
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    with get_db() as db:
        if db is None:
            return 0
        return db.query(FailedOcrCapture).filter(
            FailedOcrCapture.created_at < cutoff
        ).delete(synchronize_session=False)


def list_failed_captures(limit: int = 500) -> List[Dict[str, Any]]:
    """Devuelve metadata (sin bytes) de las capturas más recientes."""
    if SessionLocal is None:
        return []
    with get_db() as db:
        if db is None:
            return []
        rows = (
            db.query(FailedOcrCapture)
            .order_by(FailedOcrCapture.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": str(r.id),
                "created_at": r.created_at.isoformat(),
                "reason": r.reason,
                "error_msg": r.error_msg,
                "session_id": r.session_id,
                "endpoint": r.endpoint,
                "image_mime": r.image_mime,
                "image_size_bytes": r.image_size_bytes,
                "gemini_raw": r.gemini_raw,
            }
            for r in rows
        ]


def get_failed_capture(capture_id: str) -> Optional[Dict[str, Any]]:
    """Devuelve la fila completa (con bytes). None si no existe."""
    if SessionLocal is None:
        return None
    with get_db() as db:
        if db is None:
            return None
        try:
            row = (
                db.query(FailedOcrCapture)
                .filter(FailedOcrCapture.id == capture_id)
                .first()
            )
        except Exception:
            return None
        if row is None:
            return None
        return {
            "id": str(row.id),
            "image_bytes": bytes(row.image_bytes),
            "image_mime": row.image_mime,
        }


def delete_failed_capture(capture_id: str) -> int:
    """Borra una captura. Idempotente: 0 si no existe, 1 si se borró."""
    if SessionLocal is None:
        return 0
    with get_db() as db:
        if db is None:
            return 0
        try:
            return db.query(FailedOcrCapture).filter(
                FailedOcrCapture.id == capture_id
            ).delete(synchronize_session=False)
        except Exception:
            return 0
```

**Y agregar el import faltante de `timedelta`** al top del archivo si no está:

```python
from datetime import datetime, timedelta
```

- [ ] **Step 4: Correr test y verificar éxito**

```
python backend/test_failed_captures.py
```

Expected:
```
✓ persist_hard_fail
✓ persist_needs_review
  (swallowed DB error as expected)
✓ persist_swallows_db_errors
✓ prune_deletes_old_keeps_new

All failed_captures tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add backend/postgres_db.py backend/test_failed_captures.py
git commit -m "feat(db): persist_failed_capture + prune + helpers admin (CRUD)"
```

---

## Task 5: Hook en endpoints OCR `/ocr` y `/upload`

**Files:**
- Modify: `backend/main.py` (los dos `finally` blocks de las líneas ~404-416 y ~513-525 según el grep — confirmar al editar)

- [ ] **Step 1: Inspeccionar los `finally` actuales**

Buscar en `main.py` las dos secciones donde aparece `analytics_tracker.track_ocr_usage(`. Hay dos — una en `/api/session/{session_id}/ocr` y otra en `/api/session/{session_id}/upload`.

- [ ] **Step 2: Agregar imports al top de main.py**

Agregar (si no están ya):

```python
from postgres_db import persist_failed_capture
from image_utils import detect_image_mime
from ip_utils import extract_client_ip, hash_ip
```

- [ ] **Step 3: Modificar el `finally` de `/ocr` (endpoint `process_receipt_ocr`)**

**Justo después** del bloque que llama a `analytics_tracker.track_ocr_usage(...)`, agregar dentro del mismo `finally`:

```python
            # Captura de boletas fallidas o needs_review para mejorar OCR
            try:
                should_capture = (
                    not _ocr_succeeded
                    or bool(ocr_result.get("needs_review"))
                )
                if should_capture:
                    persist_failed_capture(
                        image_bytes=image_bytes,
                        image_mime=detect_image_mime(image_bytes),
                        reason="hard_fail" if not _ocr_succeeded else "needs_review",
                        error_msg=_ocr_error_msg,
                        gemini_raw=ocr_result if _ocr_succeeded else None,
                        session_id=session_id,
                        endpoint="ocr",
                        ip_hash=hash_ip(extract_client_ip(request)),
                    )
            except Exception as cap_err:
                print(f"persist_failed_capture (ocr) failed: {cap_err}")
```

- [ ] **Step 4: Modificar el `finally` de `/upload` (endpoint `upload_receipt_image`)**

Idéntico al paso 3 pero con `endpoint="upload"`:

```python
            # Captura de boletas fallidas o needs_review para mejorar OCR
            try:
                should_capture = (
                    not _ocr_succeeded
                    or bool(ocr_result.get("needs_review"))
                )
                if should_capture:
                    persist_failed_capture(
                        image_bytes=image_bytes,
                        image_mime=detect_image_mime(image_bytes),
                        reason="hard_fail" if not _ocr_succeeded else "needs_review",
                        error_msg=_ocr_error_msg,
                        gemini_raw=ocr_result if _ocr_succeeded else None,
                        session_id=session_id,
                        endpoint="upload",
                        ip_hash=hash_ip(extract_client_ip(request)),
                    )
            except Exception as cap_err:
                print(f"persist_failed_capture (upload) failed: {cap_err}")
```

- [ ] **Step 5: Verificar que el módulo importa**

```
python -c "import sys; sys.path.insert(0, 'backend'); import main"
```

Expected: sin error de import.

- [ ] **Step 6: Refactor (opcional, si la lógica de extraer IP ya vive en main.py)**

Si encuentras código de extracción de IP en el setup del rate-limit de main.py (alrededor de las líneas 146-175 según el grep), reemplazar por una llamada a `extract_client_ip(request)` para evitar duplicación. **Si no encuentras código directo a refactorizar, salta este paso.**

- [ ] **Step 7: Commit**

```bash
git add backend/main.py
git commit -m "feat(ocr): persistir boletas fallidas y needs_review en finally block"
```

---

## Task 6: Admin auth dependency

**Files:**
- Modify: `backend/main.py` (agregar la dependency cerca del top, después de los imports)

- [ ] **Step 1: Agregar la dependency**

Cerca del top de `main.py`, después de los imports y de las constantes existentes (ej. después de `ALLOWED_ORIGINS`):

```python
from fastapi import Header

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def verify_admin_token(x_admin_token: Optional[str] = Header(None)) -> None:
    """FastAPI dependency: valida el header X-Admin-Token contra ADMIN_TOKEN env."""
    if not ADMIN_TOKEN:
        # Si la env var no está seteada en el server, rechazar todo
        raise HTTPException(status_code=503, detail="Admin endpoints not configured")
    if not x_admin_token or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")
```

`Optional` ya debería estar importado de `typing`. Si no, agregar al import correspondiente.

- [ ] **Step 2: Verificar import**

```
python -c "import sys; sys.path.insert(0, 'backend'); import main; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(admin): verify_admin_token dependency con header X-Admin-Token"
```

---

## Task 7: Endpoint `GET /api/admin/failed-captures` (list)

**Files:**
- Modify: `backend/main.py` (agregar al final de la sección de OCR/admin endpoints)

- [ ] **Step 1: Agregar el endpoint**

En `main.py`, agregar (ubicación: antes de `if __name__ == "__main__"` o donde queden agrupados los admin endpoints):

```python
from postgres_db import list_failed_captures, get_failed_capture, delete_failed_capture


@app.get("/api/admin/failed-captures")
async def admin_list_failed_captures(
    limit: int = 500,
    _: None = Depends(verify_admin_token),
):
    """Lista capturas con metadata (sin bytes)."""
    limit = max(1, min(limit, 1000))
    captures = list_failed_captures(limit=limit)
    return {"captures": captures, "total": len(captures)}
```

`Depends` debería estar importado de `fastapi` (los endpoints existentes ya lo usan o no — confirmar en el archivo y agregar si falta).

- [ ] **Step 2: Verificar import**

```
python -c "import sys; sys.path.insert(0, 'backend'); import main; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Probar manualmente con curl en local**

(Opcional si tienes el backend corriendo local con DATABASE_URL y ADMIN_TOKEN seteados.)

```bash
ADMIN_TOKEN=test123 uvicorn main:app --reload --port 8000
# en otra terminal:
curl -H "X-Admin-Token: test123" http://localhost:8000/api/admin/failed-captures
```

Expected: `{"captures": [], "total": 0}` (la DB está vacía).

```bash
curl http://localhost:8000/api/admin/failed-captures
```

Expected: `{"detail":"Invalid or missing admin token"}` con HTTP 401.

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(admin): GET /api/admin/failed-captures (list metadata)"
```

---

## Task 8: Endpoints `GET /image` y `DELETE`

**Files:**
- Modify: `backend/main.py` (después del endpoint de list)

- [ ] **Step 1: Agregar los dos endpoints**

```python
from fastapi.responses import Response


@app.get("/api/admin/failed-captures/{capture_id}/image")
async def admin_get_failed_capture_image(
    capture_id: str,
    _: None = Depends(verify_admin_token),
):
    """Retorna los bytes binarios de la imagen capturada."""
    cap = get_failed_capture(capture_id)
    if cap is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    return Response(content=cap["image_bytes"], media_type=cap["image_mime"])


@app.delete("/api/admin/failed-captures/{capture_id}", status_code=204)
async def admin_delete_failed_capture(
    capture_id: str,
    _: None = Depends(verify_admin_token),
):
    """Borra una captura. Idempotente: 204 incluso si no existe."""
    delete_failed_capture(capture_id)
    return Response(status_code=204)
```

- [ ] **Step 2: Verificar import**

```
python -c "import sys; sys.path.insert(0, 'backend'); import main; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(admin): GET image bytes + DELETE failed-capture (idempotente)"
```

---

## Task 9: Script local `sync-failed-boletas.py`

**Files:**
- Create: `ocr-benchmark/scripts/sync-failed-boletas.py`

- [ ] **Step 1: Crear el script**

`ocr-benchmark/scripts/sync-failed-boletas.py`:

```python
"""
sync-failed-boletas.py

Sincroniza las capturas de boletas fallidas del backend a
ocr-benchmark/incoming/, eliminándolas del servidor tras la descarga.

Config:
  - BILL_E_ADMIN_TOKEN env var, o archivo ~/.bill-e-admin-token (env gana)
  - BILL_E_BACKEND_URL env var (default: producción)

Uso:
  python ocr-benchmark/scripts/sync-failed-boletas.py
  python ocr-benchmark/scripts/sync-failed-boletas.py --dry-run
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

import requests

DEFAULT_BACKEND = "https://bill-e-backend-lfwp.onrender.com"
TOKEN_FILE = Path.home() / ".bill-e-admin-token"

REPO_ROOT = Path(__file__).resolve().parent.parent  # ocr-benchmark/
INCOMING = REPO_ROOT / "incoming"


def load_token() -> Optional[str]:
    tok = os.getenv("BILL_E_ADMIN_TOKEN")
    if tok:
        return tok.strip()
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    return None


def ext_for(mime: str) -> str:
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }.get(mime, "bin")


def safe_filename(created_at_iso: str, capture_id: str, mime: str) -> str:
    ts = created_at_iso.replace(":", "-").replace(".", "-")
    return f"{ts}_{capture_id}.{ext_for(mime)}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--backend", default=os.getenv("BILL_E_BACKEND_URL", DEFAULT_BACKEND))
    p.add_argument("--dry-run", action="store_true", help="No borra del servidor")
    args = p.parse_args()

    token = load_token()
    if not token:
        print(
            "ERROR: no se encontró admin token. "
            "Definí BILL_E_ADMIN_TOKEN o creá ~/.bill-e-admin-token",
            file=sys.stderr,
        )
        return 1

    INCOMING.mkdir(parents=True, exist_ok=True)
    headers = {"X-Admin-Token": token}

    print(f"GET {args.backend}/api/admin/failed-captures")
    r = requests.get(f"{args.backend}/api/admin/failed-captures", headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"ERROR list: HTTP {r.status_code} — {r.text}", file=sys.stderr)
        return 1
    captures = r.json().get("captures", [])
    print(f"  {len(captures)} captura(s) pendiente(s)")

    n_downloaded = 0
    n_skipped = 0
    n_deleted = 0
    n_errors = 0

    for cap in captures:
        cid = cap["id"]
        fname = safe_filename(cap["created_at"], cid, cap["image_mime"])
        img_path = INCOMING / fname
        sidecar_path = img_path.with_suffix(".json")

        try:
            if img_path.exists():
                print(f"  - {fname} ya existe local, salto descarga")
                n_skipped += 1
            else:
                img_r = requests.get(
                    f"{args.backend}/api/admin/failed-captures/{cid}/image",
                    headers=headers,
                    timeout=60,
                )
                if img_r.status_code != 200:
                    print(f"  ✗ HTTP {img_r.status_code} al bajar {cid}", file=sys.stderr)
                    n_errors += 1
                    continue
                img_path.write_bytes(img_r.content)
                sidecar_path.write_text(json.dumps(cap, indent=2, ensure_ascii=False))
                print(f"  + {fname} ({len(img_r.content)} bytes)")
                n_downloaded += 1

            if not args.dry_run:
                del_r = requests.delete(
                    f"{args.backend}/api/admin/failed-captures/{cid}",
                    headers=headers,
                    timeout=30,
                )
                if del_r.status_code in (200, 204):
                    n_deleted += 1
                else:
                    print(f"  ⚠ DELETE {cid} → HTTP {del_r.status_code}", file=sys.stderr)
                    n_errors += 1
        except Exception as e:
            print(f"  ✗ Error procesando {cid}: {e}", file=sys.stderr)
            n_errors += 1

    print("")
    print(f"Resumen: {n_downloaded} descargada(s), {n_skipped} ya existían, "
          f"{n_deleted} borrada(s) del servidor, {n_errors} error(es)")
    return 0 if n_errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verificar que parsea sin errores**

```
python ocr-benchmark/scripts/sync-failed-boletas.py --help
```

Expected: el help message del argparse.

- [ ] **Step 3: Probar dry-run contra un backend local (opcional)**

```
BILL_E_ADMIN_TOKEN=test123 BILL_E_BACKEND_URL=http://localhost:8000 \
  python ocr-benchmark/scripts/sync-failed-boletas.py --dry-run
```

Expected: lista vacía, sin borrar nada.

- [ ] **Step 4: Commit**

```bash
git add ocr-benchmark/scripts/sync-failed-boletas.py
git commit -m "feat(ocr-benchmark): script sync-failed-boletas DELETE-after-download"
```

---

## Task 10: Línea de privacidad en i18n (12 idiomas)

**Files:**
- Modify: `frontend/src/lib/i18n.ts` (o el archivo donde vivan las strings de `/privacy`)

- [ ] **Step 1: Buscar dónde viven las strings de privacidad**

```
grep -n "privacy\|privacidad\|política" frontend/src/lib/i18n.ts | head -10
```

Si no están en `i18n.ts`, buscar en `frontend/src/app/privacy/`:

```
grep -rn "privacy" frontend/src/app/privacy/
```

- [ ] **Step 2: Agregar la línea en los 12 idiomas**

Para cada idioma, agregar una entrada del estilo `privacyOcrCapture` (o el nombre que calce con el patrón existente) con el texto correspondiente. Usar registro neutro (sin voseo, sin regionalismos):

| Idioma | Texto |
|---|---|
| es | Cuando el escaneo de una boleta falla o requiere revisión, podemos conservar la imagen hasta 30 días para mejorar la precisión del OCR. Estas imágenes son de uso interno y no se comparten con terceros. |
| en | When a receipt scan fails or needs review, we may keep the image for up to 30 days to improve OCR accuracy. These images are for internal use and are not shared with third parties. |
| pt | Quando a digitalização de um recibo falha ou requer revisão, podemos conservar a imagem por até 30 dias para melhorar a precisão do OCR. Estas imagens são para uso interno e não são compartilhadas com terceiros. |
| fr | Lorsque la numérisation d'un reçu échoue ou nécessite une révision, nous pouvons conserver l'image jusqu'à 30 jours pour améliorer la précision de l'OCR. Ces images sont à usage interne et ne sont pas partagées avec des tiers. |
| de | Wenn das Scannen eines Belegs fehlschlägt oder überprüft werden muss, können wir das Bild bis zu 30 Tage aufbewahren, um die OCR-Genauigkeit zu verbessern. Diese Bilder werden intern verwendet und nicht an Dritte weitergegeben. |
| it | Quando la scansione di una ricevuta fallisce o richiede revisione, possiamo conservare l'immagine fino a 30 giorni per migliorare la precisione dell'OCR. Queste immagini sono per uso interno e non vengono condivise con terzi. |
| ja | レシートのスキャンが失敗したり確認が必要な場合、OCRの精度向上のために最大30日間画像を保存することがあります。これらの画像は社内利用のみで、第三者と共有することはありません。 |
| zh | 当收据扫描失败或需要审核时，我们可能会保留图像最多30天以提高OCR准确性。这些图像仅供内部使用，不会与第三方共享。 |
| ko | 영수증 스캔이 실패하거나 검토가 필요한 경우, OCR 정확도 향상을 위해 최대 30일 동안 이미지를 보관할 수 있습니다. 이러한 이미지는 내부용이며 제3자와 공유되지 않습니다. |
| ru | Если сканирование чека не удалось или требует проверки, мы можем хранить изображение до 30 дней для повышения точности OCR. Эти изображения используются внутри компании и не передаются третьим сторонам. |
| ar | عندما يفشل مسح الإيصال أو يتطلب مراجعة، قد نحتفظ بالصورة لمدة تصل إلى 30 يومًا لتحسين دقة OCR. هذه الصور للاستخدام الداخلي ولا تتم مشاركتها مع أطراف ثالثة. |
| hi | जब रसीद स्कैन विफल हो जाता है या समीक्षा की आवश्यकता होती है, तो हम OCR सटीकता में सुधार के लिए छवि को 30 दिनों तक रख सकते हैं। ये छवियां आंतरिक उपयोग के लिए हैं और तीसरे पक्ष के साथ साझा नहीं की जाती हैं। |

Confirmar la lista de 12 idiomas con la memoria `feedback_i18n_neutral.md` — si la lista canónica difiere, ajustar.

- [ ] **Step 3: Renderizar la nueva clave en la página `/privacy`**

Buscar el componente que renderiza la página de privacidad:

```
grep -rn "privacy" frontend/src/app/privacy/ frontend/src/components/
```

Agregar un párrafo más usando `t('privacyOcrCapture')` (o el nombre real).

- [ ] **Step 4: Verificar typecheck**

```
cd frontend && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/i18n.ts frontend/src/app/privacy/
git commit -m "docs(privacy): mencionar retencion de imagenes de OCR fallido (30d)"
```

---

## Task 11: Setear `ADMIN_TOKEN` en Render y deploy

**Files:** infra manual

- [ ] **Step 1: Generar token aleatorio**

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Guardar el output en un manager de passwords y en `~/.bill-e-admin-token`:

```bash
echo "<token-de-arriba>" > ~/.bill-e-admin-token
chmod 600 ~/.bill-e-admin-token
```

- [ ] **Step 2: Setear `ADMIN_TOKEN` en Render**

Render dashboard → bill-e-backend service → Environment → Add Environment Variable:
- Key: `ADMIN_TOKEN`
- Value: el token de arriba

Click "Save Changes" (Render redespliega automáticamente).

- [ ] **Step 3: Push del código a `main`**

```bash
git push origin main
```

Vercel redespliega el frontend (privacy line). Render redespliega el backend.

- [ ] **Step 4: Esperar el deploy y verificar healthcheck**

```bash
curl https://bill-e-backend-lfwp.onrender.com/health
# o el endpoint que use Bill-e
```

- [ ] **Step 5: Verificar admin endpoint en producción**

```bash
ADMIN_TOKEN=<el-token> curl -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://bill-e-backend-lfwp.onrender.com/api/admin/failed-captures
```

Expected: `{"captures": [], "total": 0}` (vacío al principio).

```bash
curl https://bill-e-backend-lfwp.onrender.com/api/admin/failed-captures
```

Expected: HTTP 401.

- [ ] **Step 6: Probar sync local contra producción (dry-run)**

```bash
python ocr-benchmark/scripts/sync-failed-boletas.py --dry-run
```

Expected: `0 captura(s) pendiente(s)` y resumen.

---

## Task 12: Verificación post-deploy con tráfico real

**Files:** N/A (manual)

- [ ] **Step 1: Esperar 24-48 horas**

Después del deploy, dejar correr tráfico orgánico. Con el ~21% histórico de `needs_review`, en 24h con 5-10 scans/día deberían aparecer 1-2 capturas.

- [ ] **Step 2: Listar capturas reales**

```bash
ADMIN_TOKEN=<el-token> curl -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://bill-e-backend-lfwp.onrender.com/api/admin/failed-captures | jq '.captures | length'
```

Expected: > 0.

- [ ] **Step 3: Correr el sync real**

```bash
python ocr-benchmark/scripts/sync-failed-boletas.py
ls ocr-benchmark/incoming/
```

Expected: nuevos archivos `.jpg`/`.png` + `.json` sidecars.

- [ ] **Step 4: Verificar que la DB quedó limpia**

```bash
ADMIN_TOKEN=<el-token> curl -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://bill-e-backend-lfwp.onrender.com/api/admin/failed-captures
```

Expected: `{"captures": [], "total": 0}`.

- [ ] **Step 5: Inspeccionar una imagen y su sidecar**

Abrir uno de los archivos descargados y confirmar que es la boleta real + verificar el JSON sidecar con `reason`, `error_msg`, `gemini_raw`.

---

## Self-review

**Spec coverage:**

| Spec requirement | Task(s) |
|---|---|
| Tabla `failed_ocr_captures` con schema definido | Task 3 |
| Captura silenciosa en `finally` de los 2 endpoints | Task 5 |
| Fire-and-forget (no propaga excepciones) | Task 4 (test `swallows_db_errors`) + Task 5 (try/except local) |
| Auto-prune lazy on-insert a 30 días | Task 4 |
| Endpoint admin GET list | Task 7 |
| Endpoint admin GET image | Task 8 |
| Endpoint admin DELETE (idempotente) | Task 8 |
| Auth con `ADMIN_TOKEN` por header | Task 6 |
| Script local DELETE-after-download | Task 9 |
| Línea en política de privacidad (12 idiomas) | Task 10 |
| Helper `detect_image_mime` | Task 1 |
| Helpers `extract_client_ip` + `hash_ip` | Task 2 |
| Tests para todos los caminos críticos | Tasks 1, 2, 4 |
| Setear `ADMIN_TOKEN` en Render | Task 11 |
| Validar post-deploy con tráfico real | Task 12 |

Cobertura completa.

**Placeholder scan:** sin TBD/TODO/"implement later". Cada step tiene código completo o un comando exacto.

**Type/name consistency:**
- `persist_failed_capture` firma idéntica en Task 4 (definición), Task 5 (uso).
- `detect_image_mime` firma idéntica en Task 1 y Task 5.
- `extract_client_ip` y `hash_ip` firmas idénticas en Task 2 y Task 5.
- `list_failed_captures`, `get_failed_capture`, `delete_failed_capture` firmas idénticas en Task 4 (definición) y Tasks 7-8 (uso).
- `verify_admin_token` firma idéntica en Task 6 (definición) y Tasks 7-8 (uso como `Depends(verify_admin_token)`).
- `ADMIN_TOKEN` env var nombrada idéntica en Task 6, Task 11.

Sin inconsistencias.
