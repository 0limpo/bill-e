"""Cloudflare Turnstile verification (proteccion anti-bot).

Setup:
  1. Crear sitio Turnstile en https://dash.cloudflare.com → Turnstile.
     Modo recomendado: "Managed" (challenge invisible para humanos).
  2. Setear `TURNSTILE_SECRET` en backend env (Render).
  3. Setear `NEXT_PUBLIC_TURNSTILE_SITE_KEY` en frontend env (Vercel).
  4. El frontend renderiza el widget con la site key, captura el token,
     y lo envia en el header `cf-turnstile-token` o en el body.

Comportamiento:
  - Si `TURNSTILE_SECRET` NO esta seteado → verify_token() devuelve True
    (no-op), util para dev/staging y para no romper produccion al deployar.
  - Si esta seteado y el token falta o es invalido → False (endpoint debe 403).
"""

from __future__ import annotations

import os
from typing import Optional

import httpx

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def is_configured() -> bool:
    return bool(os.getenv("TURNSTILE_SECRET"))


async def verify_token(token: Optional[str], remote_ip: Optional[str] = None) -> bool:
    """Valida el token de Turnstile contra Cloudflare.

    Returns True si la verificacion paso (o si Turnstile no esta configurado).
    Returns False si el token es invalido, expiro, o fallo el call a Cloudflare.
    """
    secret = os.getenv("TURNSTILE_SECRET")
    if not secret:
        return True  # No-op cuando no esta configurado

    if not token:
        return False

    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(VERIFY_URL, data=data)
        if res.status_code != 200:
            print(f"Turnstile verify HTTP {res.status_code}: {res.text[:200]}")
            return False
        body = res.json()
        if not body.get("success"):
            print(f"Turnstile verify failed: {body.get('error-codes')}")
            return False
        return True
    except Exception as e:
        # Fail-closed cuando esta configurado y el call rompe — preferimos
        # rechazar a dejar pasar trafico no validado.
        print(f"Turnstile verify exception: {e}")
        return False
