"""
OAuth Authentication Module for Bill-e
Supports Google, Facebook, and Microsoft sign-in.
"""

import os
import secrets
import httpx
from typing import Dict, Any, Optional
from urllib.parse import urlencode

# OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID", "")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET", "")

MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "")

# URLs
BACKEND_URL = os.getenv("BACKEND_URL", "https://bill-e-backend-lfwp.onrender.com")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://bill-e.vercel.app")

# OAuth endpoints
OAUTH_CONFIG = {
    "google": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
        "scopes": ["openid", "email", "profile"],
    },
    "facebook": {
        "auth_url": "https://www.facebook.com/v18.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v18.0/oauth/access_token",
        "userinfo_url": "https://graph.facebook.com/me",
        "scopes": ["email", "public_profile"],
    },
    "microsoft": {
        "auth_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo_url": "https://graph.microsoft.com/v1.0/me",
        "scopes": ["openid", "email", "profile", "User.Read"],
    },
}


def get_oauth_config(provider: str) -> Optional[Dict]:
    """Get OAuth configuration for a provider."""
    return OAUTH_CONFIG.get(provider)


def get_client_credentials(provider: str) -> tuple:
    """Get client ID and secret for a provider."""
    if provider == "google":
        return GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
    elif provider == "facebook":
        return FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET
    elif provider == "microsoft":
        return MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
    return "", ""


def is_provider_configured(provider: str) -> bool:
    """Check if a provider is properly configured."""
    client_id, client_secret = get_client_credentials(provider)
    return bool(client_id and client_secret)


def get_available_providers() -> list:
    """Get list of configured OAuth providers."""
    providers = []
    for provider in ["google", "facebook", "microsoft"]:
        if is_provider_configured(provider):
            providers.append(provider)
    return providers


def generate_auth_url(
    provider: str,
    redirect_uri: str,
    state: str,
    device_id: str = None
) -> Optional[str]:
    """
    Generate OAuth authorization URL.

    Args:
        provider: OAuth provider (google, facebook, microsoft)
        redirect_uri: Callback URL after authorization
        state: CSRF protection state token
        device_id: Optional device ID to include in state

    Returns:
        Authorization URL or None if provider not configured
    """
    if not is_provider_configured(provider):
        return None

    config = get_oauth_config(provider)
    client_id, _ = get_client_credentials(provider)

    # Build state with device_id if provided
    full_state = f"{state}:{device_id}" if device_id else state

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(config["scopes"]),
        "state": full_state,
    }

    # Provider-specific params
    if provider == "google":
        params["access_type"] = "offline"
        params["prompt"] = "select_account"
    elif provider == "facebook":
        pass  # Facebook uses default params
    elif provider == "microsoft":
        params["response_mode"] = "query"

    return f"{config['auth_url']}?{urlencode(params)}"


async def exchange_code_for_token(
    provider: str,
    code: str,
    redirect_uri: str
) -> Optional[Dict]:
    """
    Exchange authorization code for access token.

    Args:
        provider: OAuth provider
        code: Authorization code from callback
        redirect_uri: Same redirect URI used in auth request

    Returns:
        Token response or None on error
    """
    if not is_provider_configured(provider):
        return None

    config = get_oauth_config(provider)
    client_id, client_secret = get_client_credentials(provider)

    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                config["token_url"],
                data=data,
                headers={"Accept": "application/json"}
            )

            if response.status_code != 200:
                print(f"Token exchange error: {response.status_code} - {response.text}")
                return None

            return response.json()

    except Exception as e:
        print(f"Token exchange exception: {e}")
        return None


async def get_user_info(provider: str, access_token: str) -> Optional[Dict]:
    """
    Get user info from OAuth provider.

    Args:
        provider: OAuth provider
        access_token: Access token from token exchange

    Returns:
        Normalized user info dict or None on error
    """
    config = get_oauth_config(provider)

    try:
        async with httpx.AsyncClient() as client:
            headers = {"Authorization": f"Bearer {access_token}"}

            # Facebook requires fields parameter
            url = config["userinfo_url"]
            if provider == "facebook":
                url += "?fields=id,name,email,picture.type(large)"

            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                print(f"User info error: {response.status_code} - {response.text}")
                return None

            data = response.json()

            # Normalize response to common format
            return normalize_user_info(provider, data)

    except Exception as e:
        print(f"User info exception: {e}")
        return None


def normalize_user_info(provider: str, data: Dict) -> Dict:
    """
    Normalize user info from different providers to common format.

    Returns:
        {
            "provider_id": str,
            "email": str,
            "name": str,
            "picture_url": str
        }
    """
    if provider == "google":
        return {
            "provider_id": data.get("id"),
            "email": data.get("email"),
            "name": data.get("name"),
            "picture_url": data.get("picture"),
        }

    elif provider == "facebook":
        picture_data = data.get("picture", {}).get("data", {})
        return {
            "provider_id": data.get("id"),
            "email": data.get("email"),
            "name": data.get("name"),
            "picture_url": picture_data.get("url"),
        }

    elif provider == "microsoft":
        return {
            "provider_id": data.get("id"),
            "email": data.get("mail") or data.get("userPrincipalName"),
            "name": data.get("displayName"),
            "picture_url": None,  # Microsoft Graph requires separate call for photo
        }

    return {}


def generate_state_token() -> str:
    """Generate a secure random state token for CSRF protection."""
    return secrets.token_urlsafe(32)


def parse_state(state: str) -> tuple:
    """
    Parse state token to extract original state and device_id.

    Returns:
        (state_token, device_id) tuple
    """
    if ":" in state:
        parts = state.split(":", 1)
        return parts[0], parts[1]
    return state, None


# Session token management (simple JWT-like tokens)
import hashlib
import base64
import json
import time

SESSION_SECRET = os.getenv("SESSION_SECRET", "bill-e-session-secret-change-me")
SESSION_EXPIRY = 60 * 60 * 24 * 30  # 30 days


def create_session_token(user_id: str, provider: str, email: str) -> str:
    """
    Create a simple session token.

    Format: base64(json_payload).signature
    """
    payload = {
        "user_id": user_id,
        "provider": provider,
        "email": email,
        "exp": int(time.time()) + SESSION_EXPIRY,
        "iat": int(time.time()),
    }

    payload_json = json.dumps(payload, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode()).decode().rstrip("=")

    signature = hashlib.sha256(
        f"{payload_b64}.{SESSION_SECRET}".encode()
    ).hexdigest()[:32]

    return f"{payload_b64}.{signature}"


def verify_session_token(token: str) -> Optional[Dict]:
    """
    Verify and decode a session token.

    Returns:
        Decoded payload or None if invalid/expired
    """
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None

        payload_b64, signature = parts

        # Verify signature
        expected_sig = hashlib.sha256(
            f"{payload_b64}.{SESSION_SECRET}".encode()
        ).hexdigest()[:32]

        if signature != expected_sig:
            return None

        # Decode payload
        # Add padding if needed
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload_json = base64.urlsafe_b64decode(payload_b64).decode()
        payload = json.loads(payload_json)

        # Check expiry
        if payload.get("exp", 0) < time.time():
            return None

        return payload

    except Exception as e:
        print(f"Token verification error: {e}")
        return None
