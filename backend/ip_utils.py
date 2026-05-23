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
