"""
Bill-e free tier counter.

Tracks how many sessions each identity (logged-in user or anonymous
device) has consumed — i.e. reached step 3 of. Free identities are
capped at FREE_SESSIONS_LIMIT. Premium users have unlimited.

Storage layout (Redis, no TTL — the cap persists across cleared cookies):
- `free_sessions:user:{user_id}`     -> JSON list of session_ids
- `free_sessions:device:{device_id}` -> JSON list of session_ids

Idempotency: counting is by set membership over session_ids. Calling
`record_session_use` with a session_id already in the list is a no-op,
which lets the frontend retry the p2→p3 transition safely.

Identity matching:
- Logged-in user (user_id present): user list is authoritative.
- Anonymous (only device_id): device list is authoritative.
- On login (`merge_device_into_user`): the device list is absorbed
  into the user list (union of session_ids). The device list is left
  intact so subsequent anonymous use on that device keeps counting
  from the existing baseline — otherwise users could log out, clear
  the user link, and get a fresh 5.
"""

import json
from typing import Dict, List, Optional, Set, Tuple

FREE_SESSIONS_LIMIT = 5
SESSION_TTL_SECONDS = 24 * 60 * 60  # 24h — collaborative session lifetime in Redis


def _user_key(user_id: str) -> str:
    return f"free_sessions:user:{user_id}"


def _device_key(device_id: str) -> str:
    return f"free_sessions:device:{device_id}"


def _load_session_ids(redis_client, key: str) -> List[str]:
    raw = redis_client.get(key) if redis_client else None
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return [str(s) for s in data] if isinstance(data, list) else []
    except (TypeError, ValueError):
        return []


def _save_session_ids(redis_client, key: str, session_ids: List[str]) -> None:
    redis_client.set(key, json.dumps(session_ids))


def _is_premium_user(redis_client, user_id: Optional[str]) -> bool:
    """Resolve premium status for a logged-in user via the existing
    email-based check (Redis cache + Postgres fallback)."""
    if not user_id:
        return False
    try:
        import postgres_db
        user = postgres_db.get_user_by_id(user_id)
    except Exception:
        return False
    if not user:
        return False
    email = user.get("email")
    if not email:
        return False
    try:
        from collaborative_session import check_premium_by_email
        return bool(check_premium_by_email(redis_client, email).get("is_premium"))
    except Exception:
        return False


def _resolve_counter(
    redis_client,
    user_id: Optional[str],
    device_id: Optional[str],
) -> Tuple[str, List[str]]:
    """Pick the authoritative key for this identity and return its list.

    user_id wins over device_id. If neither is present, returns an
    empty key with an empty list — caller treats this as "no identity"
    and typically rejects the action.
    """
    if user_id:
        key = _user_key(user_id)
    elif device_id:
        key = _device_key(device_id)
    else:
        return "", []
    return key, _load_session_ids(redis_client, key)


def get_status(
    redis_client,
    user_id: Optional[str] = None,
    device_id: Optional[str] = None,
) -> Dict:
    """Return current free-tier status for this identity.

    Shape:
        {
            "sessions_used":   int,         # how many session_ids counted
            "sessions_limit":  int,         # FREE_SESSIONS_LIMIT
            "free_remaining":  int,         # max(0, limit - used)
            "is_premium":      bool,
            "identity":        "user"|"device"|"none",
        }
    """
    is_premium = _is_premium_user(redis_client, user_id)
    _, session_ids = _resolve_counter(redis_client, user_id, device_id)
    used = len(session_ids)
    identity = "user" if user_id else ("device" if device_id else "none")
    return {
        "sessions_used": used,
        "sessions_limit": FREE_SESSIONS_LIMIT,
        "free_remaining": max(0, FREE_SESSIONS_LIMIT - used),
        "is_premium": is_premium,
        "identity": identity,
    }


def record_session_use(
    redis_client,
    session_id: str,
    user_id: Optional[str] = None,
    device_id: Optional[str] = None,
) -> Dict:
    """Idempotently record that this identity used `session_id`.

    Returns the post-record status plus an `allowed` flag:
    - Premium: always allowed, list still updated (for analytics).
    - Already counted (session_id in list): allowed, no change.
    - Under limit: allowed, list appended.
    - At/over limit and not premium: NOT allowed, list NOT appended.

    The caller is responsible for blocking the p2→p3 transition when
    `allowed` is False.
    """
    if not session_id:
        raise ValueError("session_id is required")

    is_premium = _is_premium_user(redis_client, user_id)
    key, session_ids = _resolve_counter(redis_client, user_id, device_id)

    if not key:
        # No identity at all — cannot record. Caller decides what to
        # do (typically: reject the action and prompt for device_id).
        return {
            "allowed": False,
            "sessions_used": 0,
            "sessions_limit": FREE_SESSIONS_LIMIT,
            "free_remaining": FREE_SESSIONS_LIMIT,
            "is_premium": False,
            "reason": "no_identity",
        }

    already_counted = session_id in session_ids
    used = len(session_ids)

    if already_counted:
        return {
            "allowed": True,
            "sessions_used": used,
            "sessions_limit": FREE_SESSIONS_LIMIT,
            "free_remaining": max(0, FREE_SESSIONS_LIMIT - used),
            "is_premium": is_premium,
            "already_counted": True,
        }

    if not is_premium and used >= FREE_SESSIONS_LIMIT:
        return {
            "allowed": False,
            "sessions_used": used,
            "sessions_limit": FREE_SESSIONS_LIMIT,
            "free_remaining": 0,
            "is_premium": False,
            "reason": "limit_reached",
        }

    session_ids.append(session_id)
    _save_session_ids(redis_client, key, session_ids)
    used = len(session_ids)
    return {
        "allowed": True,
        "sessions_used": used,
        "sessions_limit": FREE_SESSIONS_LIMIT,
        "free_remaining": max(0, FREE_SESSIONS_LIMIT - used),
        "is_premium": is_premium,
        "recorded": True,
    }


def check_can_join(
    redis_client,
    session_id: str,
    user_id: Optional[str] = None,
    device_id: Optional[str] = None,
) -> Dict:
    """Decide whether this identity is allowed to JOIN a session.

    Unlike `record_session_use`, this is read-only — it does not append
    the session to the counter. The actual increment still happens at
    the p2->p3 transition via `record_session_use`. The point of this
    check is to give the editor a paywall *before* they invest time
    editing assignments only to be blocked at the share step.

    Allows when:
    - identity is premium, OR
    - this session_id is already in the identity's list (idempotent —
      returning to a session they already counted), OR
    - sessions_used < FREE_SESSIONS_LIMIT.

    Otherwise blocks with reason="limit_reached".
    """
    if not session_id:
        raise ValueError("session_id is required")

    is_premium = _is_premium_user(redis_client, user_id)
    _, session_ids = _resolve_counter(redis_client, user_id, device_id)
    used = len(session_ids)
    remaining = max(0, FREE_SESSIONS_LIMIT - used)

    base = {
        "sessions_used": used,
        "sessions_limit": FREE_SESSIONS_LIMIT,
        "free_remaining": remaining,
        "is_premium": is_premium,
    }

    if is_premium:
        return {"allowed": True, **base}

    if session_id in session_ids:
        return {"allowed": True, "already_counted": True, **base}

    if used >= FREE_SESSIONS_LIMIT:
        return {"allowed": False, "reason": "limit_reached", **base}

    return {"allowed": True, **base}


def merge_device_into_user(
    redis_client,
    user_id: str,
    device_id: str,
) -> Dict:
    """Absorb a device's session list into a user's. Called on login.

    Union by session_id. The device list is left intact so subsequent
    anonymous use of the same device keeps its baseline (prevents the
    "log out and get 5 fresh" loophole).

    Returns the user's status after the merge.
    """
    if not user_id or not device_id:
        return get_status(redis_client, user_id=user_id, device_id=device_id)

    user_list = _load_session_ids(redis_client, _user_key(user_id))
    device_list = _load_session_ids(redis_client, _device_key(device_id))

    if not device_list:
        # Nothing to merge; just return current user status.
        return get_status(redis_client, user_id=user_id)

    user_set: Set[str] = set(user_list)
    merged = list(user_list)
    added = 0
    for sid in device_list:
        if sid not in user_set:
            merged.append(sid)
            user_set.add(sid)
            added += 1

    if added > 0:
        _save_session_ids(redis_client, _user_key(user_id), merged)

    status = get_status(redis_client, user_id=user_id)
    status["merged_from_device"] = added
    return status
