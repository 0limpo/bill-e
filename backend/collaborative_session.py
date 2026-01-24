# collaborative_session.py
# Sistema de sesiones colaborativas para Bill-e

import uuid
import json
import re
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from enum import Enum

class SessionStatus(str, Enum):
    ASSIGNING = "assigning"
    FINALIZED = "finalized"

class ParticipantRole(str, Enum):
    OWNER = "owner"
    EDITOR = "editor"

def create_collaborative_session(
    redis_client,
    owner_phone: str,
    items: List[Dict],
    total: float,
    subtotal: float,
    tip: float,
    raw_text: str = "",
    charges: List[Dict] = None,
    decimal_places: int = 0,
    has_tip: bool = False,
    number_format: Dict = None,
    price_mode: str = "unitario",
    device_id: str = ""
) -> Dict[str, Any]:
    session_id = str(uuid.uuid4())[:8]
    owner_token = str(uuid.uuid4())

    # Asegurar que cada item tenga un ID
    for i, item in enumerate(items):
        if 'id' not in item:
            item['id'] = f"item_{i}"

    # Asegurar que cada charge tenga un ID
    if charges is None:
        charges = []
    for i, charge in enumerate(charges):
        if 'id' not in charge:
            charge['id'] = f"charge_{i}"

    session_data = {
        "session_id": session_id,
        "owner_token": owner_token,
        "owner_phone": owner_phone,
        "owner_device_id": device_id,
        "status": SessionStatus.ASSIGNING.value,
        "host_step": 1,  # Track which step the host is on (1=Review, 2=Assign, 3=Share)
        "created_at": datetime.now().isoformat(),
        "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
        "items": items,
        "charges": charges,
        "total": total,
        "subtotal": subtotal,
        "tip": tip or 0,
        "tip_percentage": round(((tip or 0) / subtotal * 100) if subtotal and subtotal > 0 else 10),
        "has_tip": has_tip,
        "decimal_places": decimal_places,
        "number_format": number_format or {"thousands": ",", "decimal": "."},
        "price_mode": price_mode,
        "raw_text": raw_text,
        "bill_cost_shared": False,  # Whether to divide Bill-e cost among participants
        "participants": [
            {
                "id": str(uuid.uuid4())[:8],
                "name": "Host",
                "phone": owner_phone,
                "role": ParticipantRole.OWNER.value,
                "joined_at": datetime.now().isoformat()
            }
        ],
        "assignments": {},
        "last_updated": datetime.now().isoformat(),
        "last_updated_by": "system"
    }

    redis_client.setex(
        f"session:{session_id}",
        86400,  # 24 hours
        json.dumps(session_data)
    )

    return {
        "session_id": session_id,
        "owner_token": owner_token,
        "editor_url": f"https://bill-e.vercel.app/s/{session_id}",
        "owner_url": f"https://bill-e.vercel.app/s/{session_id}?owner={owner_token}",
        "expires_at": session_data["expires_at"]
    }


def get_session(redis_client, session_id: str) -> Optional[Dict]:
    data = redis_client.get(f"session:{session_id}")
    if data:
        return json.loads(data)
    return None


def verify_owner(session_data: Dict, owner_token: str) -> bool:
    return session_data.get("owner_token") == owner_token


def verify_owner_device(
    redis_client,
    session_id: str,
    session_data: Dict,
    owner_token: str,
    device_id: str
) -> Dict[str, Any]:
    """
    Verify owner token and device_id.
    Returns {"valid": True} if OK, or {"valid": False, "error": "..."} if not.

    On first access, registers the device_id.
    On subsequent access, checks if device_id matches.
    """
    # First verify the owner token
    if not verify_owner(session_data, owner_token):
        return {"valid": False, "error": "invalid_token"}

    # Check device_id
    current_device = session_data.get("owner_device_id")

    if current_device is None:
        # First access - register this device
        session_data["owner_device_id"] = device_id
        session_data["last_updated"] = datetime.now().isoformat()

        # Save to Redis
        ttl = redis_client.ttl(f"session:{session_id}")
        if ttl > 0:
            redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

        return {"valid": True, "registered": True}

    elif current_device == device_id:
        # Same device - OK
        return {"valid": True}

    else:
        # Different device - reject
        return {"valid": False, "error": "device_mismatch"}


# --- Editor Device Tracking ---

EDITOR_FREE_SESSIONS = 0  # Free sessions before paywall

def check_editor_device_limit(
    redis_client,
    device_id: str,
    session_id: str,
    google_email: str = None
) -> Dict[str, Any]:
    """
    Check if editor device has exceeded free session limit.
    Returns {"allowed": True, "sessions_used": N} if OK.
    Returns {"allowed": False, "sessions_used": N, "limit_reached": True} if limit exceeded.
    """
    device_key = f"editor_device:{device_id}"

    # Get current sessions for this device
    sessions_json = redis_client.get(device_key)
    sessions = json.loads(sessions_json) if sessions_json else []

    # Already in this session? Always allow
    if session_id in sessions:
        return {
            "allowed": True,
            "sessions_used": len(sessions),
            "is_returning": True
        }

    # Check if premium by google_email (database check)
    if google_email:
        try:
            import postgres_db
            user = postgres_db.get_user_by_email(google_email)
            if user and user.get("is_premium"):
                # Check if premium has expired
                premium_expires = user.get("premium_expires")
                if premium_expires:
                    from datetime import datetime
                    expiry_date = datetime.fromisoformat(premium_expires)
                    if datetime.now() <= expiry_date:
                        return {
                            "allowed": True,
                            "sessions_used": len(sessions),
                            "is_premium": True,
                            "unlimited": True
                        }
                else:
                    # No expiry = unlimited premium
                    return {
                        "allowed": True,
                        "sessions_used": len(sessions),
                        "is_premium": True,
                        "unlimited": True
                    }
        except Exception as e:
            print(f"Error checking premium by email in postgres: {e}")

    # Check if premium by email in Redis (set by set_premium_by_email after payment)
    if google_email:
        premium_check = check_premium_by_email(redis_client, google_email)
        print(f"Redis premium check for {google_email}: {premium_check}")
        if premium_check.get("is_premium"):
            return {
                "allowed": True,
                "sessions_used": len(sessions),
                "is_premium": True,
                "unlimited": premium_check.get("unlimited", True)
            }

    # Check if premium (stored in device data) - legacy fallback
    device_data_key = f"editor_device_data:{device_id}"
    device_data_json = redis_client.get(device_data_key)
    device_data = json.loads(device_data_json) if device_data_json else {}

    if device_data.get("is_premium"):
        # Check if premium has expired
        premium_expires = device_data.get("premium_expires")
        if premium_expires:
            expiry_date = datetime.fromisoformat(premium_expires)
            if datetime.now() > expiry_date:
                # Premium expired - treat as free user
                pass
            else:
                # Premium active - unlimited sessions
                return {
                    "allowed": True,
                    "sessions_used": len(sessions),
                    "is_premium": True,
                    "unlimited": True
                }
        else:
            # No expiry set (legacy) - allow
            return {
                "allowed": True,
                "sessions_used": len(sessions),
                "is_premium": True,
                "unlimited": True
            }

    # Check limit
    if len(sessions) >= EDITOR_FREE_SESSIONS:
        return {
            "allowed": False,
            "sessions_used": len(sessions),
            "limit_reached": True,
            "free_limit": EDITOR_FREE_SESSIONS
        }

    return {
        "allowed": True,
        "sessions_used": len(sessions),
        "remaining": EDITOR_FREE_SESSIONS - len(sessions)
    }


def register_editor_session(
    redis_client,
    device_id: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Register a session for an editor device.
    Call this after successfully joining a session.
    For premium users, still track for analytics but return unlimited.
    """
    device_key = f"editor_device:{device_id}"

    # Get current sessions
    sessions_json = redis_client.get(device_key)
    sessions = json.loads(sessions_json) if sessions_json else []

    # Add session if not already present (track for analytics)
    if session_id not in sessions:
        sessions.append(session_id)
        # Store permanently (no TTL)
        redis_client.set(device_key, json.dumps(sessions))

    # Check if premium (for return value)
    device_data_key = f"editor_device_data:{device_id}"
    device_data_json = redis_client.get(device_data_key)
    device_data = json.loads(device_data_json) if device_data_json else {}

    if device_data.get("is_premium"):
        # Check expiry
        premium_expires = device_data.get("premium_expires")
        if premium_expires:
            expiry_date = datetime.fromisoformat(premium_expires)
            if datetime.now() <= expiry_date:
                return {
                    "sessions_used": len(sessions),
                    "unlimited": True,
                    "is_premium": True
                }

    return {
        "sessions_used": len(sessions),
        "remaining": max(0, EDITOR_FREE_SESSIONS - len(sessions))
    }


def set_editor_premium(
    redis_client,
    device_id: str,
    phone: str = None
) -> Dict[str, Any]:
    """
    Mark an editor device as premium (after payment).
    Premium lasts 1 year with unlimited editor sessions.
    """
    device_data_key = f"editor_device_data:{device_id}"

    # Set expiry to 1 year from now
    expiry = (datetime.now() + timedelta(days=365)).isoformat()

    device_data = {
        "is_premium": True,
        "premium_since": datetime.now().isoformat(),
        "premium_expires": expiry,
        "phone": phone
    }

    redis_client.set(device_data_key, json.dumps(device_data))

    return {
        "success": True,
        "is_premium": True,
        "unlimited": True,
        "expires": expiry
    }


# --- Host Session Tracking (by phone number) ---

HOST_FREE_SESSIONS = 0  # Free sessions before paywall


def check_host_session_limit(
    redis_client,
    phone: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Check if host phone has exceeded free session limit.
    Returns {"allowed": True, "sessions_used": N} if OK.
    Returns {"allowed": False, "sessions_used": N, "limit_reached": True} if limit exceeded.
    """
    # Normalize phone number
    phone_normalized = re.sub(r'[^\d]', '', phone)
    host_key = f"host_phone:{phone_normalized}"

    # Get current sessions for this phone
    sessions_json = redis_client.get(host_key)
    sessions = json.loads(sessions_json) if sessions_json else []

    # Already finalized this session? Always allow (re-finalize)
    if session_id in sessions:
        return {
            "allowed": True,
            "sessions_used": len(sessions),
            "is_returning": True
        }

    # Check if premium (stored in host data)
    host_data_key = f"host_phone_data:{phone_normalized}"
    host_data_json = redis_client.get(host_data_key)
    host_data = json.loads(host_data_json) if host_data_json else {}

    if host_data.get("is_premium"):
        # Check remaining premium sessions
        premium_sessions_remaining = host_data.get("sessions_remaining", 0)
        if premium_sessions_remaining > 0:
            return {
                "allowed": True,
                "sessions_used": len(sessions),
                "is_premium": True,
                "premium_remaining": premium_sessions_remaining
            }
        # Premium expired (no sessions left)
        return {
            "allowed": False,
            "sessions_used": len(sessions),
            "premium_expired": True
        }

    # Check free limit
    if len(sessions) >= HOST_FREE_SESSIONS:
        return {
            "allowed": False,
            "sessions_used": len(sessions),
            "limit_reached": True,
            "free_limit": HOST_FREE_SESSIONS
        }

    return {
        "allowed": True,
        "sessions_used": len(sessions),
        "remaining": HOST_FREE_SESSIONS - len(sessions)
    }


def register_host_session(
    redis_client,
    phone: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Register a session for a host phone.
    Call this after successfully finalizing a session.
    """
    # Normalize phone number
    phone_normalized = re.sub(r'[^\d]', '', phone)
    host_key = f"host_phone:{phone_normalized}"

    # Get current sessions
    sessions_json = redis_client.get(host_key)
    sessions = json.loads(sessions_json) if sessions_json else []

    # Add session if not already present
    if session_id not in sessions:
        sessions.append(session_id)
        # Store permanently (no TTL)
        redis_client.set(host_key, json.dumps(sessions))

        # If premium, decrement remaining sessions
        host_data_key = f"host_phone_data:{phone_normalized}"
        host_data_json = redis_client.get(host_data_key)
        host_data = json.loads(host_data_json) if host_data_json else {}

        if host_data.get("is_premium") and host_data.get("sessions_remaining", 0) > 0:
            host_data["sessions_remaining"] -= 1
            redis_client.set(host_data_key, json.dumps(host_data))

    return {
        "sessions_used": len(sessions),
        "remaining": max(0, HOST_FREE_SESSIONS - len(sessions))
    }


def set_host_premium(
    redis_client,
    phone: str,
    host_sessions: int = 20,
    editor_sessions: int = 30
) -> Dict[str, Any]:
    """
    Mark a host phone as premium (after payment).
    Also sets editor premium for the same phone.
    """
    phone_normalized = re.sub(r'[^\d]', '', phone)
    host_data_key = f"host_phone_data:{phone_normalized}"

    # Set expiry to 1 year from now
    expiry = (datetime.now() + timedelta(days=365)).isoformat()

    host_data = {
        "is_premium": True,
        "premium_since": datetime.now().isoformat(),
        "premium_expires": expiry,
        "sessions_remaining": host_sessions,
        "editor_sessions_remaining": editor_sessions,
        "phone": phone
    }

    redis_client.set(host_data_key, json.dumps(host_data))

    return {
        "success": True,
        "is_premium": True,
        "host_sessions": host_sessions,
        "editor_sessions": editor_sessions,
        "expires": expiry
    }


# --- Host tracking by device_id (for web users without phone) ---

def check_host_device_limit(
    redis_client,
    device_id: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Check if host device has exceeded free session limit.
    Returns {"allowed": True, "sessions_used": N} if OK.
    Returns {"allowed": False, "sessions_used": N, "limit_reached": True} if limit exceeded.
    """
    device_key = f"host_device:{device_id}"

    # Get current sessions for this device
    sessions_json = redis_client.get(device_key)
    sessions = json.loads(sessions_json) if sessions_json else []

    # Already finalized this session? Always allow (re-finalize)
    if session_id in sessions:
        return {
            "allowed": True,
            "sessions_used": len(sessions),
            "is_returning": True
        }

    # Check if premium (stored in device data)
    device_data_key = f"host_device_data:{device_id}"
    device_data_json = redis_client.get(device_data_key)
    device_data = json.loads(device_data_json) if device_data_json else {}

    if device_data.get("is_premium"):
        # Check if premium has expired
        premium_expires = device_data.get("premium_expires")
        if premium_expires:
            expiry_date = datetime.fromisoformat(premium_expires)
            if datetime.now() > expiry_date:
                # Premium expired - treat as free user
                pass
            else:
                # Check remaining premium sessions
                premium_sessions_remaining = device_data.get("sessions_remaining", 0)
                if premium_sessions_remaining > 0:
                    return {
                        "allowed": True,
                        "sessions_used": len(sessions),
                        "is_premium": True,
                        "premium_remaining": premium_sessions_remaining
                    }
                # No sessions left
                return {
                    "allowed": False,
                    "sessions_used": len(sessions),
                    "premium_expired": True
                }

    # Check free limit
    if len(sessions) >= HOST_FREE_SESSIONS:
        return {
            "allowed": False,
            "sessions_used": len(sessions),
            "limit_reached": True,
            "free_limit": HOST_FREE_SESSIONS
        }

    return {
        "allowed": True,
        "sessions_used": len(sessions),
        "remaining": HOST_FREE_SESSIONS - len(sessions)
    }


def register_host_device_session(
    redis_client,
    device_id: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Register a session for a host device.
    Call this after successfully finalizing a session.
    """
    device_key = f"host_device:{device_id}"

    # Get current sessions
    sessions_json = redis_client.get(device_key)
    sessions = json.loads(sessions_json) if sessions_json else []

    # Add session if not already present
    if session_id not in sessions:
        sessions.append(session_id)
        # Store permanently (no TTL)
        redis_client.set(device_key, json.dumps(sessions))

        # If premium, decrement remaining sessions
        device_data_key = f"host_device_data:{device_id}"
        device_data_json = redis_client.get(device_data_key)
        device_data = json.loads(device_data_json) if device_data_json else {}

        if device_data.get("is_premium") and device_data.get("sessions_remaining", 0) > 0:
            device_data["sessions_remaining"] -= 1
            redis_client.set(device_data_key, json.dumps(device_data))

    return {
        "sessions_used": len(sessions),
        "remaining": max(0, HOST_FREE_SESSIONS - len(sessions))
    }


def set_host_device_premium(
    redis_client,
    device_id: str,
    host_sessions: int = 20
) -> Dict[str, Any]:
    """
    Mark a host device as premium (after payment).
    """
    device_data_key = f"host_device_data:{device_id}"

    # Set expiry to 1 year from now
    expiry = (datetime.now() + timedelta(days=365)).isoformat()

    device_data = {
        "is_premium": True,
        "sessions_remaining": host_sessions,
        "premium_expires": expiry,
        "activated_at": datetime.now().isoformat()
    }

    redis_client.set(device_data_key, json.dumps(device_data))

    return {
        "success": True,
        "device_id": device_id,
        "sessions_remaining": host_sessions,
        "expires": expiry
    }


def add_participant(
    redis_client,
    session_id: str,
    name: str,
    phone: str
) -> Dict[str, Any]:
    session_data = get_session(redis_client, session_id)

    if not session_data:
        return {"error": "Sesion no encontrada", "code": 404}

    if session_data["status"] == SessionStatus.FINALIZED.value:
        return {"error": "La sesion ya fue finalizada", "code": 403}

    # Only check for existing participant if phone is a real phone number
    # Skip this check if phone is empty, "N/A", or placeholder values
    if phone and phone not in ["N/A", "", "n/a"]:
        for p in session_data["participants"]:
            if p.get("phone") == phone:
                return {
                    "participant": p,
                    "is_existing": True,
                    "is_owner": p["role"] == ParticipantRole.OWNER.value
                }

    new_participant = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "phone": phone,
        "role": ParticipantRole.EDITOR.value,
        "joined_at": datetime.now().isoformat()
    }

    session_data["participants"].append(new_participant)
    session_data["last_updated"] = datetime.now().isoformat()
    session_data["last_updated_by"] = name

    ttl = redis_client.ttl(f"session:{session_id}")
    if ttl > 0:
        redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

    return {
        "participant": new_participant,
        "is_existing": False,
        "is_owner": False
    }


def update_assignment(
    redis_client,
    session_id: str,
    participant_id: str,
    item_id: str,
    quantity: float,  # Float to support fractional assignments (e.g., 0.33 for 3-way split)
    is_assigned: bool,
    updated_by: str
) -> Dict[str, Any]:
    session_data = get_session(redis_client, session_id)

    if not session_data:
        return {"error": "Sesion no encontrada", "code": 404}

    if session_data["status"] == SessionStatus.FINALIZED.value:
        return {"error": "La sesion ya fue finalizada", "code": 403}

    if item_id not in session_data["assignments"]:
        session_data["assignments"][item_id] = []

    existing_idx = None
    for idx, assignment in enumerate(session_data["assignments"][item_id]):
        if assignment["participant_id"] == participant_id:
            existing_idx = idx
            break

    if is_assigned:
        if existing_idx is not None:
            session_data["assignments"][item_id][existing_idx]["quantity"] = quantity
        else:
            session_data["assignments"][item_id].append({
                "participant_id": participant_id,
                "quantity": quantity
            })
    else:
        if existing_idx is not None:
            session_data["assignments"][item_id].pop(existing_idx)

    session_data["last_updated"] = datetime.now().isoformat()
    session_data["last_updated_by"] = updated_by

    ttl = redis_client.ttl(f"session:{session_id}")
    if ttl > 0:
        redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

    return {"success": True, "assignments": session_data["assignments"]}


def finalize_session(
    redis_client,
    session_id: str,
    owner_token: str,
    owner_email: str = None
) -> Dict[str, Any]:
    session_data = get_session(redis_client, session_id)

    if not session_data:
        return {"error": "Sesion no encontrada", "code": 404}

    if not verify_owner(session_data, owner_token):
        return {"error": "No autorizado", "code": 403}

    if session_data["status"] == SessionStatus.FINALIZED.value:
        return {"error": "La sesion ya fue finalizada", "code": 400}

    # Check host session limit before finalizing
    # Priority: email (Google auth) > phone > device_id
    owner_phone = session_data.get("owner_phone", "")
    owner_device_id = session_data.get("owner_device_id", "")

    # First check email-based premium (new simplified system)
    if owner_email:
        email_premium = check_premium_by_email(redis_client, owner_email)
        if email_premium.get("is_premium"):
            # User has email-based premium - allow unlimited sessions
            limit_check = {"allowed": True, "is_premium": True, "email": owner_email}
        else:
            limit_check = None  # Fall through to phone/device_id check
    else:
        limit_check = None

    # Fallback to phone/device_id based limit check
    if limit_check is None:
        if owner_phone:
            limit_check = check_host_session_limit(redis_client, owner_phone, session_id)
        elif owner_device_id:
            limit_check = check_host_device_limit(redis_client, owner_device_id, session_id)

    if limit_check and not limit_check.get("allowed"):
        return {
            "error": "limit_reached",
            "code": 402,  # Payment Required
            "sessions_used": limit_check.get("sessions_used", 0),
            "free_limit": limit_check.get("free_limit", HOST_FREE_SESSIONS),
            "requires_payment": True
        }

    totals = calculate_totals(session_data)

    session_data["status"] = SessionStatus.FINALIZED.value
    session_data["finalized_at"] = datetime.now().isoformat()
    session_data["totals"] = totals
    session_data["last_updated"] = datetime.now().isoformat()
    session_data["last_updated_by"] = "owner"

    ttl = redis_client.ttl(f"session:{session_id}")
    if ttl > 0:
        redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

    # Register this session for the host (count it)
    host_status = {}
    if owner_phone:
        host_status = register_host_session(redis_client, owner_phone, session_id)
    elif owner_device_id:
        host_status = register_host_device_session(redis_client, owner_device_id, session_id)

    return {
        "success": True,
        "totals": totals,
        "session": session_data,
        "host_sessions_used": host_status.get("sessions_used", 0),
        "host_sessions_remaining": host_status.get("remaining", 0)
    }


def calculate_totals(session_data: Dict) -> List[Dict]:
    items = session_data["items"]
    assignments = session_data["assignments"]
    participants = session_data["participants"]

    items_by_id = {}
    for item in items:
        item_id = item.get("id") or item.get("name")
        items_by_id[item_id] = item

    # Pre-scan: detect which items have unit assignments (to avoid double-counting)
    items_with_unit_assignments = set()
    for key, assigns in assignments.items():
        unit_match = re.match(r'^(.+)_unit_(\d+)$', key)
        if unit_match and assigns and len(assigns) > 0:
            items_with_unit_assignments.add(unit_match.group(1))

    participant_subtotals = {p["id"]: 0 for p in participants}
    participant_items = {p["id"]: [] for p in participants}

    for assignment_key, item_assignments in assignments.items():
        # Check if this is a unit assignment (format: itemId_unit_N)
        unit_match = re.match(r'^(.+)_unit_(\d+)$', assignment_key)

        if unit_match:
            # Unit assignment - find parent item
            base_item_id = unit_match.group(1)
            item = items_by_id.get(base_item_id)
            if not item:
                continue
            # Unit price is the item's price (already per unit in frontend)
            unit_price = item.get("price", 0)
        else:
            # Regular item assignment - skip if item has unit assignments (avoid double-counting)
            if assignment_key in items_with_unit_assignments:
                continue
            item = items_by_id.get(assignment_key)
            if not item:
                continue
            item_price = item.get("price", 0)
            item_quantity = item.get("quantity", 1)
            unit_price = item_price / item_quantity if item_quantity > 0 else item_price

        item_quantity = item.get("quantity", 1)

        for assignment in item_assignments:
            p_id = assignment["participant_id"]
            qty = assignment.get("quantity", 1)

            if p_id in participant_subtotals:
                amount = unit_price * qty
                participant_subtotals[p_id] += amount
                participant_items[p_id].append({
                    "name": item.get("name", "Item"),
                    "quantity": qty,
                    "total_quantity": item_quantity,
                    "amount": amount,
                    "shared": len(item_assignments) > 1,
                    "is_unit": unit_match is not None
                })

    total_subtotal = sum(participant_subtotals.values())
    total_tip = session_data.get("tip") or 0
    charges = session_data.get("charges") or []
    num_participants = len(participants)

    results = []
    for participant in participants:
        p_id = participant["id"]
        subtotal = participant_subtotals.get(p_id, 0)

        # Calculate ratio for proportional distribution
        if total_subtotal > 0:
            ratio = subtotal / total_subtotal
        else:
            ratio = 1 / num_participants if num_participants > 0 else 0

        # Calculate charges for this participant
        participant_charges = []
        charges_total = 0
        for charge in charges:
            charge_id = charge.get("id") or ""
            charge_name = charge.get("name") or ""
            value = charge.get("value") or 0
            value_type = charge.get("valueType") or "fixed"
            is_discount = charge.get("isDiscount") or False
            distribution = charge.get("distribution") or "proportional"

            # Calculate charge amount
            if value_type == "percent":
                charge_amount = total_subtotal * (value / 100)
            else:
                charge_amount = value

            # Apply distribution
            if distribution == "per_person":
                participant_charge = charge_amount / num_participants if num_participants > 0 else 0
            else:
                participant_charge = charge_amount * ratio

            # Apply sign (discount = negative)
            if is_discount:
                participant_charge = -participant_charge

            participant_charges.append({
                "id": charge_id,
                "name": charge_name,
                "amount": round(participant_charge)
            })
            charges_total += participant_charge

        # Calculate tip
        tip = total_tip * ratio

        # Total = subtotal + charges + tip
        total = subtotal + charges_total + tip

        results.append({
            "participant_id": p_id,
            "name": participant["name"],
            "phone": participant["phone"],
            "role": participant["role"],
            "subtotal": round(subtotal),
            "charges": participant_charges,
            "charges_total": round(charges_total),
            "tip": round(tip),
            "total": round(total),
            "items": participant_items.get(p_id, [])
        })

    return results


def get_participant_summary(session_data: Dict, participant_id: str) -> Dict:
    items = session_data["items"]
    assignments = session_data["assignments"]

    items_by_id = {}
    for item in items:
        item_id = item.get("id") or item.get("name")
        items_by_id[item_id] = item

    consumed_items = []

    for item_id, item_assignments in assignments.items():
        for assignment in item_assignments:
            if assignment["participant_id"] == participant_id:
                item = items_by_id.get(item_id, {})
                qty = assignment.get("quantity", 1)
                item_qty = item.get("quantity", 1)

                display = item.get("name", "Item")
                if item_qty > 1:
                    display += f" ({qty} de {item_qty})"
                elif len(item_assignments) > 1:
                    display += " (compartido)"

                consumed_items.append({
                    "name": item.get("name", "Item"),
                    "quantity": qty,
                    "is_shared": len(item_assignments) > 1,
                    "display": display
                })

    return {
        "participant_id": participant_id,
        "items": consumed_items,
        "item_count": len(consumed_items)
    }


# --- Premium by Email (Google Auth) ---
# Simplified premium system: premium is tied to Google email, not device_id

def set_premium_by_email(
    redis_client,
    email: str,
    user_type: str = "host"
) -> Dict[str, Any]:
    """
    Set premium for a Google email (after payment with Google auth).
    Premium lasts 1 year with unlimited sessions.
    """
    email_normalized = email.lower().strip()
    premium_key = f"premium_email:{email_normalized}"

    # Set expiry to 1 year from now
    expiry = (datetime.now() + timedelta(days=365)).isoformat()

    premium_data = {
        "email": email_normalized,
        "is_premium": True,
        "user_type": user_type,
        "premium_since": datetime.now().isoformat(),
        "premium_expires": expiry,
        "unlimited": True
    }

    # Store with no TTL (permanent until manually deleted)
    # TTL will be managed by premium_expires field
    redis_client.set(premium_key, json.dumps(premium_data))

    return {
        "success": True,
        "email": email_normalized,
        "is_premium": True,
        "unlimited": True,
        "expires": expiry
    }


def check_premium_by_email(
    redis_client,
    email: str
) -> Dict[str, Any]:
    """
    Check if an email has active premium.
    Returns premium status and expiry info.
    """
    if not email:
        return {"is_premium": False, "error": "No email provided"}

    email_normalized = email.lower().strip()
    premium_key = f"premium_email:{email_normalized}"

    premium_json = redis_client.get(premium_key)
    if not premium_json:
        return {"is_premium": False, "email": email_normalized}

    premium_data = json.loads(premium_json)

    # Check if premium has expired
    expires_str = premium_data.get("premium_expires")
    if expires_str:
        try:
            expires = datetime.fromisoformat(expires_str)
            if expires < datetime.now():
                return {
                    "is_premium": False,
                    "email": email_normalized,
                    "expired": True,
                    "expired_at": expires_str
                }
        except:
            pass

    return {
        "is_premium": True,
        "email": email_normalized,
        "unlimited": premium_data.get("unlimited", True),
        "user_type": premium_data.get("user_type", "host"),
        "premium_expires": expires_str,
        "premium_since": premium_data.get("premium_since")
    }


def get_premium_by_email(
    redis_client,
    email: str
) -> Optional[Dict[str, Any]]:
    """
    Get full premium data for an email.
    Returns None if no premium found.
    """
    if not email:
        return None

    email_normalized = email.lower().strip()
    premium_key = f"premium_email:{email_normalized}"

    premium_json = redis_client.get(premium_key)
    if not premium_json:
        return None

    return json.loads(premium_json)
