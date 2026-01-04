"""
SimpleAPI Integration for Electronic Invoices (Boletas Electrónicas)
Emits boletas to Chilean SII after successful payment
"""

import requests
from datetime import datetime
from typing import Optional, Dict, Any
import os
import json

# Configuration from environment
SIMPLEAPI_API_KEY = os.getenv("SIMPLEAPI_API_KEY", "")
SIMPLEAPI_URL = os.getenv("SIMPLEAPI_URL", "https://api.simpleapi.cl/api/v1")
SIMPLEAPI_RUT_EMISOR = os.getenv("SIMPLEAPI_RUT_EMISOR", "78308501-1")
SIMPLEAPI_RAZON_SOCIAL = os.getenv("SIMPLEAPI_RAZON_SOCIAL", "OLIMPO SPA")

# IVA rate in Chile
IVA_RATE = 0.19


def calculate_neto_iva(total_con_iva: int) -> Dict[str, int]:
    """
    Calculate neto and IVA from total price (IVA included).
    Chilean IVA is 19%.
    """
    neto = round(total_con_iva / 1.19)
    iva = total_con_iva - neto
    return {
        "neto": neto,
        "iva": iva,
        "total": total_con_iva
    }


def emit_boleta(
    monto_total: int,
    descripcion: str,
    commerce_order: str,
    email_receptor: Optional[str] = None
) -> Dict[str, Any]:
    """
    Emit a boleta electrónica to the SII via SimpleAPI.

    Args:
        monto_total: Total amount in CLP (IVA included)
        descripcion: Description of the product/service
        commerce_order: Our commerce order ID for reference
        email_receptor: Optional email to send boleta

    Returns:
        {
            "success": True/False,
            "folio": "12345",  # Boleta number
            "trackId": "xxx",  # SimpleAPI tracking ID
            "pdf_url": "...",  # URL to download PDF
            "error": None or error message
        }
    """
    if not SIMPLEAPI_API_KEY:
        return {
            "success": False,
            "error": "SIMPLEAPI_API_KEY not configured",
            "folio": None,
            "trackId": None
        }

    # Calculate neto and IVA
    valores = calculate_neto_iva(monto_total)

    # Build boleta request
    # Note: This structure may need adjustment based on actual SimpleAPI docs
    boleta_data = {
        "Documento": {
            "Encabezado": {
                "IdDoc": {
                    "TipoDTE": 39,  # 39 = Boleta Electrónica
                    "FchEmis": datetime.now().strftime("%Y-%m-%d"),
                },
                "Emisor": {
                    "RUTEmisor": SIMPLEAPI_RUT_EMISOR,
                    "RznSoc": SIMPLEAPI_RAZON_SOCIAL,
                },
                "Totales": {
                    "MntNeto": valores["neto"],
                    "IVA": valores["iva"],
                    "MntTotal": valores["total"],
                }
            },
            "Detalle": [
                {
                    "NmbItem": descripcion,
                    "QtyItem": 1,
                    "PrcItem": valores["neto"],
                    "MontoItem": valores["neto"],
                }
            ],
            "Referencia": {
                "NroLinRef": 1,
                "TpoDocRef": "SET",
                "FolioRef": commerce_order,
                "RazonRef": f"Pago Bill-e Premium - {commerce_order}"
            }
        }
    }

    if email_receptor:
        boleta_data["Documento"]["Encabezado"]["Receptor"] = {
            "CorreoRecep": email_receptor
        }

    try:
        headers = {
            "Authorization": f"Bearer {SIMPLEAPI_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        response = requests.post(
            f"{SIMPLEAPI_URL}/dte/boleta",
            headers=headers,
            json=boleta_data,
            timeout=60
        )

        if response.status_code in [200, 201]:
            result = response.json()
            return {
                "success": True,
                "folio": result.get("folio"),
                "trackId": result.get("trackId"),
                "pdf_url": result.get("pdfUrl"),
                "error": None,
                "raw_response": result
            }
        else:
            error_msg = f"SimpleAPI error: {response.status_code} - {response.text}"
            print(error_msg)
            return {
                "success": False,
                "folio": None,
                "trackId": None,
                "error": error_msg
            }

    except requests.exceptions.Timeout:
        return {
            "success": False,
            "folio": None,
            "trackId": None,
            "error": "SimpleAPI timeout"
        }
    except Exception as e:
        error_msg = f"SimpleAPI exception: {str(e)}"
        print(error_msg)
        return {
            "success": False,
            "folio": None,
            "trackId": None,
            "error": error_msg
        }


def get_boleta_status(track_id: str) -> Dict[str, Any]:
    """
    Check the status of a boleta emission.

    Args:
        track_id: SimpleAPI tracking ID

    Returns:
        {
            "status": "accepted" | "rejected" | "pending",
            "folio": "12345",
            "sii_response": {...}
        }
    """
    if not SIMPLEAPI_API_KEY:
        return {"status": "error", "error": "API key not configured"}

    try:
        headers = {
            "Authorization": f"Bearer {SIMPLEAPI_API_KEY}",
            "Accept": "application/json"
        }

        response = requests.get(
            f"{SIMPLEAPI_URL}/dte/status/{track_id}",
            headers=headers,
            timeout=30
        )

        if response.status_code == 200:
            return response.json()
        else:
            return {
                "status": "error",
                "error": f"SimpleAPI error: {response.status_code}"
            }

    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


def emit_boleta_async(
    redis_client,
    payment_id: str,
    monto_total: int,
    descripcion: str,
    commerce_order: str,
    email_receptor: Optional[str] = None
) -> Dict[str, Any]:
    """
    Emit boleta and store result in Redis.
    This is the main function to call after payment confirmation.

    Premium is activated regardless of boleta success (don't block user).
    Failed boletas are stored for manual retry.
    """
    result = emit_boleta(
        monto_total=monto_total,
        descripcion=descripcion,
        commerce_order=commerce_order,
        email_receptor=email_receptor
    )

    # Store boleta result in Redis
    boleta_record = {
        "payment_id": payment_id,
        "commerce_order": commerce_order,
        "amount": monto_total,
        "success": result["success"],
        "folio": result.get("folio"),
        "track_id": result.get("trackId"),
        "error": result.get("error"),
        "created_at": datetime.now().isoformat(),
        "email": email_receptor
    }

    # Store with 30-day TTL
    redis_client.setex(
        f"boleta:{commerce_order}",
        30 * 24 * 60 * 60,  # 30 days
        json.dumps(boleta_record)
    )

    # If failed, add to retry queue
    if not result["success"]:
        redis_client.lpush("boleta:failed_queue", commerce_order)
        print(f"Boleta emission failed for {commerce_order}: {result.get('error')}")

    return result
