# collaborative_session.py
# Sistema de sesiones colaborativas para Bill-e

import os
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
    device_id: str = "",
    merchant_name: str = "",
    user_id: str = "",
    items_include_charges: bool = False,
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
        "user_id": user_id or None,
        "merchant_name": merchant_name,
        "bill_name": merchant_name or "",
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
        "items_include_charges": items_include_charges,
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
        86400,  # 24h — see free_tier.SESSION_TTL_SECONDS
        json.dumps(session_data)
    )

    return {
        "session_id": session_id,
        "owner_token": owner_token,
        "editor_url": f"{os.getenv('FRONTEND_URL', 'https://billeocr.com')}/s/{session_id}",
        "owner_url": f"{os.getenv('FRONTEND_URL', 'https://billeocr.com')}/s/{session_id}?owner={owner_token}",
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


# Legacy per-role paywall trackers (host_phone:*, editor_device:*, etc.)
# were removed when the free-tier counter was unified — see free_tier.py
# for the new model. Premium is now resolved exclusively by email via
# check_premium_by_email below.


def add_participant(
    redis_client,
    session_id: str,
    name: str,
    phone: str,
    user_id: str = None,
    device_id: str = None,
) -> Dict[str, Any]:
    """Add an editor to the session, or return the existing record if the
    phone matches one already registered. We also store the caller's
    device_id on the participant — finalize_session needs it to charge
    the editor's free-tier counter even if the editor closes the tab
    before reaching their own p3."""
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
                changed = False
                # Backfill user_id if joining with auth and previously was anonymous
                if user_id and not p.get("user_id"):
                    p["user_id"] = user_id
                    changed = True
                if device_id and not p.get("device_id"):
                    p["device_id"] = device_id
                    changed = True
                if changed:
                    ttl = redis_client.ttl(f"session:{session_id}")
                    if ttl > 0:
                        redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))
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
    if user_id:
        new_participant["user_id"] = user_id
    if device_id:
        new_participant["device_id"] = device_id

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


def attach_user_id_to_participant(
    redis_client,
    session_id: str,
    participant_id: str,
    user_id: str,
    device_id: str = None,
) -> bool:
    """Backfill user_id (and optionally device_id) on an existing
    participant. Called both when an anonymous editor logs in mid-session
    and when an editor uses "I'm an existing participant" — in both cases
    we want the latest known identity on the participant so finalize can
    charge it."""
    session_data = get_session(redis_client, session_id)
    if not session_data:
        return False

    for p in session_data["participants"]:
        if p.get("id") == participant_id:
            changed = False
            if user_id and p.get("user_id") != user_id:
                p["user_id"] = user_id
                changed = True
            if device_id and p.get("device_id") != device_id:
                p["device_id"] = device_id
                changed = True
            if changed:
                ttl = redis_client.ttl(f"session:{session_id}")
                if ttl > 0:
                    redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))
            return True
    return False


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

    totals = calculate_totals(session_data)

    session_data["status"] = SessionStatus.FINALIZED.value
    session_data["finalized_at"] = datetime.now().isoformat()
    session_data["totals"] = totals
    session_data["last_updated"] = datetime.now().isoformat()
    session_data["last_updated_by"] = "owner"

    ttl = redis_client.ttl(f"session:{session_id}")
    if ttl > 0:
        redis_client.setex(f"session:{session_id}", ttl, json.dumps(session_data))

    # Charge the free-tier counter for every participant who joined.
    # This is the primary increment path — it guarantees the boleta
    # counts for an editor who joined but closed the tab before their
    # own p3 auto-advance (the host is finalizing right now, so we know
    # the session reached p3). enter-share is still called on p3 entry
    # for surfacing the current freeRemaining, but it's idempotent so
    # this double-fires safely.
    try:
        import free_tier
        for p in session_data.get("participants", []):
            # The host's user_id and device_id live on the session, not
            # on the participant record. Editors carry their own
            # (set by add_participant / attach_user_id_to_participant).
            if p.get("role") == ParticipantRole.OWNER.value:
                p_user_id = session_data.get("user_id") or None
                p_device_id = session_data.get("owner_device_id") or None
            else:
                p_user_id = p.get("user_id") or None
                p_device_id = p.get("device_id") or None
            if not p_user_id and not p_device_id:
                # Truly anonymous participant we have no way to charge —
                # rare (would mean an editor joined without a device_id),
                # acceptable miss.
                continue
            free_tier.record_session_use(
                redis_client,
                session_id=session_id,
                user_id=p_user_id,
                device_id=p_device_id,
            )
    except Exception as e:
        print(f"finalize_session: free-tier charge failed: {e}")

    return {
        "success": True,
        "totals": totals,
        "session": session_data,
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
            # Unit assignment: ESTA unidad específica se reparte entre los
            # N participantes que la marcaron. Cada uno paga unit_price/N
            # (la qty del assignment es siempre 1 en este caso).
            base_item_id = unit_match.group(1)
            item = items_by_id.get(base_item_id)
            if not item:
                continue
            unit_price = item.get("price", 0)
            mode = "per_unit"
        else:
            # Skip if item has unit assignments (handled above per-unit, would
            # double-count if we processed the base id too).
            if assignment_key in items_with_unit_assignments:
                continue
            item = items_by_id.get(assignment_key)
            if not item:
                continue
            # item.price is already the unit price (frontend + OCR both
            # store unit price, not line total).
            unit_price = item.get("price", 0)
            # Grupal: el line total se reparte equitativamente entre todos
            # los asignados, sin importar la qty individual de cada uno.
            # Individual: cada uno paga por las unidades que tomó.
            mode = "grupal" if item.get("mode") == "grupal" else "individual"

        item_quantity = item.get("quantity", 1)
        num_sharers = sum(1 for a in item_assignments if a.get("quantity", 0) > 0)

        for assignment in item_assignments:
            p_id = assignment["participant_id"]
            qty = assignment.get("quantity", 1)
            if p_id not in participant_subtotals or qty <= 0:
                continue

            if mode == "per_unit":
                # Una unidad dividida entre N. La qty del assignment es 1
                # (representa "yo me sumo a esta unidad"), no cantidad real.
                amount = unit_price / max(1, num_sharers)
            elif mode == "grupal" and num_sharers > 1:
                line_total = unit_price * item_quantity
                amount = line_total / num_sharers
            else:
                # Individual (default): el usuario paga por sus unidades.
                amount = unit_price * qty

            participant_subtotals[p_id] += amount
            participant_items[p_id].append({
                "name": item.get("name", "Item"),
                "quantity": qty,
                "total_quantity": item_quantity,
                "amount": amount,
                "shared": num_sharers > 1,
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

            # Apply distribution. Three modes, mirroring billEngine.ts:
            #   - fixed_per_person: each participant pays the full charge
            #     (e.g. cubierto fijo por persona).
            #   - per_person:       split the charge equally between everyone.
            #   - proportional (default): split by share of the subtotal.
            # Without the fixed_per_person branch this fell through to
            # proportional and silently undercharged.
            if distribution == "fixed_per_person":
                participant_charge = charge_amount
            elif distribution == "per_person":
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

    Reads Redis first (hot path used by paywall checks). Falls back to
    Postgres (durable store written by webhooks) so that a missing Redis
    record doesn't strand a paid user behind the paywall — Polar's old
    webhook was Postgres-only, and Redis can also be wiped on infra
    rotation. Postgres is the source of truth on disagreement.
    """
    if not email:
        return {"is_premium": False, "error": "No email provided"}

    email_normalized = email.lower().strip()
    premium_key = f"premium_email:{email_normalized}"

    premium_json = None
    try:
        premium_json = redis_client.get(premium_key) if redis_client else None
    except Exception as e:
        print(f"check_premium_by_email: Redis read failed: {e}")

    if premium_json:
        premium_data = json.loads(premium_json)
        expires_str = premium_data.get("premium_expires")
        if expires_str:
            try:
                expires = datetime.fromisoformat(expires_str)
                if expires < datetime.now():
                    return {
                        "is_premium": False,
                        "email": email_normalized,
                        "expired": True,
                        "expired_at": expires_str,
                    }
            except Exception:
                pass

        return {
            "is_premium": True,
            "email": email_normalized,
            "unlimited": premium_data.get("unlimited", True),
            "user_type": premium_data.get("user_type", "host"),
            "premium_expires": expires_str,
            "premium_since": premium_data.get("premium_since"),
            "source": "redis",
        }

    # Postgres fallback — the durable record written by webhooks.
    try:
        import postgres_db  # local import to avoid cycle at module load

        user = postgres_db.get_user_by_email(email_normalized)
        if not user or not user.get("is_premium"):
            return {"is_premium": False, "email": email_normalized}

        expires_value = user.get("premium_expires")
        if expires_value:
            expires_dt = (
                expires_value
                if isinstance(expires_value, datetime)
                else datetime.fromisoformat(str(expires_value))
            )
            if expires_dt < datetime.now():
                return {
                    "is_premium": False,
                    "email": email_normalized,
                    "expired": True,
                    "expired_at": expires_dt.isoformat(),
                }
            expires_iso = expires_dt.isoformat()
        else:
            expires_iso = None

        # Warm Redis so subsequent paywall checks hit the fast path.
        if redis_client:
            try:
                redis_client.set(
                    premium_key,
                    json.dumps(
                        {
                            "email": email_normalized,
                            "is_premium": True,
                            "user_type": "host",
                            "premium_since": (
                                user.get("updated_at").isoformat()
                                if isinstance(user.get("updated_at"), datetime)
                                else None
                            ),
                            "premium_expires": expires_iso,
                            "unlimited": True,
                        }
                    ),
                )
            except Exception as e:
                print(f"check_premium_by_email: Redis write-through failed: {e}")

        return {
            "is_premium": True,
            "email": email_normalized,
            "unlimited": True,
            "user_type": "host",
            "premium_expires": expires_iso,
            "source": "postgres",
        }
    except Exception as e:
        print(f"check_premium_by_email: Postgres fallback failed: {e}")
        return {"is_premium": False, "email": email_normalized, "error": str(e)}


def clear_premium_by_email(redis_client, email: str) -> Dict[str, Any]:
    """Delete the Redis premium record for an email. Used by admin tooling
    to reset a tester's account between end-to-end payment runs."""
    if not email:
        return {"deleted": 0}
    email_normalized = email.lower().strip()
    premium_key = f"premium_email:{email_normalized}"
    deleted = redis_client.delete(premium_key)
    return {"deleted": int(deleted), "email": email_normalized}


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
