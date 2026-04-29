"""Polar.sh integration: checkout creation and webhook signature verification.

Polar uses the Standard Webhooks scheme for webhook signing:
https://www.standardwebhooks.com/

The signing secret comes prefixed with `whsec_` and the payload to sign is
"{webhook-id}.{webhook-timestamp}.{body}" using HMAC-SHA256.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from typing import Any, Dict, Optional

import httpx

PRODUCTION_BASE_URL = "https://api.polar.sh"
SANDBOX_BASE_URL = "https://sandbox-api.polar.sh"


def _base_url() -> str:
    """Return Polar API base URL. Defaults to sandbox to avoid accidental
    real charges; set POLAR_ENV=production once the org is live."""
    env = (os.getenv("POLAR_ENV") or "sandbox").strip().lower()
    return PRODUCTION_BASE_URL if env == "production" else SANDBOX_BASE_URL


def is_configured() -> bool:
    return bool(os.getenv("POLAR_ACCESS_TOKEN") and os.getenv("POLAR_PRODUCT_ID"))


async def create_checkout(
    *,
    product_id: str,
    customer_email: Optional[str] = None,
    success_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Create a hosted checkout session in Polar.

    Returns the API response on success (contains `id` and `url`),
    or None on failure.
    """
    token = os.getenv("POLAR_ACCESS_TOKEN")
    if not token:
        print("POLAR_ACCESS_TOKEN not configured")
        return None

    body: Dict[str, Any] = {"product_id": product_id}
    if customer_email:
        body["customer_email"] = customer_email
    if success_url:
        body["success_url"] = success_url
    if metadata:
        # Polar requires metadata values to be strings
        body["metadata"] = {k: str(v) for k, v in metadata.items() if v is not None}

    base = _base_url()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                f"{base}/v1/checkouts/",
                json=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
        if res.status_code in (200, 201):
            return res.json()
        print(f"Polar checkout error ({base}) {res.status_code}: {res.text}")
        return None
    except Exception as e:
        print(f"Polar checkout exception ({base}): {e}")
        return None


def verify_webhook_signature(payload: bytes, headers: Dict[str, str]) -> bool:
    """Verify a Polar webhook signature using the Standard Webhooks scheme."""
    secret = os.getenv("POLAR_WEBHOOK_SECRET")
    if not secret:
        print("POLAR_WEBHOOK_SECRET not configured")
        return False

    # Header lookups must be case-insensitive
    lower = {k.lower(): v for k, v in headers.items()}
    webhook_id = lower.get("webhook-id")
    webhook_timestamp = lower.get("webhook-timestamp")
    webhook_signature = lower.get("webhook-signature")

    if not webhook_id or not webhook_timestamp or not webhook_signature:
        return False

    # Standard Webhooks: secret is "whsec_<base64>". Some providers omit the
    # prefix and ship a raw string — handle both.
    if secret.startswith("whsec_"):
        try:
            secret_bytes = base64.b64decode(secret[len("whsec_"):])
        except Exception:
            secret_bytes = secret.encode()
    else:
        secret_bytes = secret.encode()

    signed_content = f"{webhook_id}.{webhook_timestamp}.{payload.decode('utf-8', errors='replace')}"
    expected_sig = base64.b64encode(
        hmac.new(secret_bytes, signed_content.encode(), hashlib.sha256).digest()
    ).decode()

    # Header format: space-separated "v1,signature1 v1,signature2"
    for token in webhook_signature.split():
        if "," not in token:
            continue
        version, sig = token.split(",", 1)
        if version == "v1" and hmac.compare_digest(sig, expected_sig):
            return True
    return False
