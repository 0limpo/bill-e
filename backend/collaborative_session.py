# collaborative_session.py
# Sistema de sesiones colaborativas para Bill-e

import uuid
import json
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
    raw_text: str = ""
) -> Dict[str, Any]:
    session_id = str(uuid.uuid4())[:8]
    owner_token = str(uuid.uuid4())

    # Asegurar que cada item tenga un ID
    for i, item in enumerate(items):
        if 'id' not in item:
            item['id'] = f"item_{i}"

    session_data = {
        "session_id": session_id,
        "owner_token": owner_token,
        "owner_phone": owner_phone,
        "status": SessionStatus.ASSIGNING.value,
        "created_at": datetime.now().isoformat(),
        "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
        "items": items,
        "total": total,
        "subtotal": subtotal,
        "tip": tip,
        "tip_percentage": round((tip / subtotal * 100) if subtotal > 0 else 10),
        "raw_text": raw_text,
        "participants": [
            {
                "id": str(uuid.uuid4())[:8],
                "name": "Anfitrion",
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
        7200,
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
    owner_token: str
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

    return {
        "success": True,
        "totals": totals,
        "session": session_data
    }


def calculate_totals(session_data: Dict) -> List[Dict]:
    items = session_data["items"]
    assignments = session_data["assignments"]
    participants = session_data["participants"]

    items_by_id = {}
    for item in items:
        item_id = item.get("id") or item.get("name")
        items_by_id[item_id] = item

    participant_subtotals = {p["id"]: 0 for p in participants}
    participant_items = {p["id"]: [] for p in participants}

    for item_id, item_assignments in assignments.items():
        item = items_by_id.get(item_id)
        if not item:
            continue

        item_price = item.get("price", 0)
        item_quantity = item.get("quantity", 1)
        price_per_unit = item_price / item_quantity if item_quantity > 0 else item_price

        for assignment in item_assignments:
            p_id = assignment["participant_id"]
            qty = assignment.get("quantity", 1)

            if p_id in participant_subtotals:
                amount = price_per_unit * qty
                participant_subtotals[p_id] += amount
                participant_items[p_id].append({
                    "name": item.get("name", "Item"),
                    "quantity": qty,
                    "total_quantity": item_quantity,
                    "amount": amount,
                    "shared": len(item_assignments) > 1
                })

    total_subtotal = sum(participant_subtotals.values())
    total_tip = session_data.get("tip", 0)

    results = []
    for participant in participants:
        p_id = participant["id"]
        subtotal = participant_subtotals.get(p_id, 0)

        if total_subtotal > 0:
            tip_ratio = subtotal / total_subtotal
        else:
            tip_ratio = 1 / len(participants) if participants else 0

        tip = total_tip * tip_ratio
        total = subtotal + tip

        results.append({
            "participant_id": p_id,
            "name": participant["name"],
            "phone": participant["phone"],
            "role": participant["role"],
            "subtotal": round(subtotal),
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
