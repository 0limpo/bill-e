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
