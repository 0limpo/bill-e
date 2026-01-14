"""
MercadoPago Payment Integration for Bill-e
Supports both Card Payment Brick (embedded) and Wallet Brick (redirect)
"""

import os
import hmac
import hashlib
import mercadopago
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

# Configuration from environment
MP_ACCESS_TOKEN = os.getenv("MERCADOPAGO_ACCESS_TOKEN", "")
MP_PUBLIC_KEY = os.getenv("MERCADOPAGO_PUBLIC_KEY", "")
MP_WEBHOOK_SECRET = os.getenv("MERCADOPAGO_WEBHOOK_SECRET", "")

# Price configuration (shared with Flow)
PREMIUM_PRICE_CLP = int(os.getenv("PREMIUM_PRICE_CLP", "1990"))


def get_sdk() -> mercadopago.SDK:
    """Get initialized MercadoPago SDK."""
    if not MP_ACCESS_TOKEN:
        raise ValueError("MERCADOPAGO_ACCESS_TOKEN not configured")
    return mercadopago.SDK(MP_ACCESS_TOKEN)


def get_public_key() -> str:
    """Get MercadoPago public key for frontend."""
    if not MP_PUBLIC_KEY:
        raise ValueError("MERCADOPAGO_PUBLIC_KEY not configured")
    return MP_PUBLIC_KEY


def create_preference(
    commerce_order: str,
    title: str,
    amount: int,
    notification_url: str,
    success_url: str,
    failure_url: str,
    pending_url: str,
    external_reference: str,
    metadata: Dict = None,
    payment_method_filter: Optional[str] = None,
    payer_email: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a payment preference for Wallet Brick or Checkout Pro.

    Args:
        commerce_order: Unique order ID
        title: Product title
        amount: Amount in CLP
        notification_url: Webhook URL
        success_url: Redirect URL on success
        failure_url: Redirect URL on failure
        pending_url: Redirect URL on pending
        external_reference: Our reference ID
        metadata: Additional metadata
        payment_method_filter: Optional filter - "credit_card" or "debit_card" to restrict payment types
        payer_email: Optional payer email (if user is logged in with Google)

    Returns:
        Preference response with id, init_point, etc.
    """
    sdk = get_sdk()

    preference_data = {
        "items": [
            {
                "id": commerce_order,
                "title": title,
                "description": "Suscripción Premium Bill-e - 1 año",
                "category_id": "services",
                "quantity": 1,
                "currency_id": "CLP",
                "unit_price": amount
            }
        ],
        "back_urls": {
            "success": success_url,
            "failure": failure_url,
            "pending": pending_url
        },
        "auto_return": "approved",
        "binary_mode": True,
        "notification_url": notification_url,
        "external_reference": external_reference,
        "statement_descriptor": "BILL-E PREMIUM",
        "expires": True,
        "expiration_date_from": datetime.now().isoformat(),
        "expiration_date_to": (datetime.now() + timedelta(hours=24)).isoformat(),
    }

    # Add payer email if available (improves approval rate)
    if payer_email:
        preference_data["payer"] = {"email": payer_email}

    # Filter payment methods if specified
    if payment_method_filter == "credit_card":
        # Exclude debit cards and other methods - only allow credit cards
        preference_data["payment_methods"] = {
            "excluded_payment_types": [
                {"id": "debit_card"},
                {"id": "ticket"},
                {"id": "atm"},
                {"id": "bank_transfer"}
            ],
            "installments": 1
        }
    elif payment_method_filter == "debit_card":
        # Exclude credit cards and other methods - only allow debit cards
        preference_data["payment_methods"] = {
            "excluded_payment_types": [
                {"id": "credit_card"},
                {"id": "ticket"},
                {"id": "atm"},
                {"id": "bank_transfer"}
            ],
            "installments": 1
        }

    if metadata:
        preference_data["metadata"] = metadata

    result = sdk.preference().create(preference_data)

    if result["status"] != 201:
        error_msg = f"MercadoPago API error: {result}"
        print(error_msg)
        raise Exception(error_msg)

    return result["response"]


def process_card_payment(
    token: str,
    transaction_amount: float,
    installments: int,
    payment_method_id: str,
    issuer_id: str,
    payer_email: str,
    external_reference: str,
    description: str,
    notification_url: str,
    metadata: Dict = None
) -> Dict[str, Any]:
    """
    Process a card payment from Card Payment Brick.

    Args:
        token: Card token from Brick
        transaction_amount: Amount in CLP
        installments: Number of installments
        payment_method_id: Payment method (visa, mastercard, etc.)
        issuer_id: Card issuer ID
        payer_email: Payer's email
        external_reference: Our reference ID
        description: Payment description
        notification_url: Webhook URL
        metadata: Additional metadata

    Returns:
        Payment response
    """
    sdk = get_sdk()

    payment_data = {
        "token": token,
        "transaction_amount": float(transaction_amount),
        "installments": installments,
        "payment_method_id": payment_method_id,
        "issuer_id": issuer_id,
        "payer": {
            "email": payer_email
        },
        "external_reference": external_reference,
        "description": description,
        "notification_url": notification_url,
        "statement_descriptor": "BILL-E PREMIUM"
    }

    if metadata:
        payment_data["metadata"] = metadata

    result = sdk.payment().create(payment_data)

    if result["status"] not in [200, 201]:
        error_msg = f"MercadoPago payment error: {result}"
        print(error_msg)
        raise Exception(error_msg)

    return result["response"]


def get_payment(payment_id: str) -> Dict[str, Any]:
    """
    Get payment details by ID.

    Args:
        payment_id: MercadoPago payment ID

    Returns:
        Payment details
    """
    sdk = get_sdk()
    result = sdk.payment().get(payment_id)

    if result["status"] != 200:
        error_msg = f"MercadoPago API error: {result}"
        print(error_msg)
        raise Exception(error_msg)

    return result["response"]


def get_premium_price() -> int:
    """Get the configured premium price in CLP."""
    return PREMIUM_PRICE_CLP


# Payment status mapping
class MPPaymentStatus:
    PENDING = "pending"
    APPROVED = "approved"
    AUTHORIZED = "authorized"
    IN_PROCESS = "in_process"
    IN_MEDIATION = "in_mediation"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    CHARGED_BACK = "charged_back"

    @staticmethod
    def is_approved(status: str) -> bool:
        # TODO: Remove "in_process" after testing - only for sandbox
        return status in ["approved", "authorized", "in_process"]

    @staticmethod
    def is_pending(status: str) -> bool:
        return status in ["pending", "in_mediation"]

    @staticmethod
    def is_failed(status: str) -> bool:
        return status in ["rejected", "cancelled", "refunded", "charged_back"]


def verify_webhook_signature(
    x_signature: str,
    x_request_id: str,
    data_id: str
) -> bool:
    """
    Verify MercadoPago webhook signature.

    MercadoPago sends:
    - x-signature header: "ts=timestamp,v1=hash"
    - x-request-id header: unique request ID
    - data.id in the body: payment ID

    We need to:
    1. Extract ts and v1 from x-signature
    2. Build template string: "id:[data.id];request-id:[x-request-id];ts:[ts];"
    3. HMAC-SHA256 with webhook secret
    4. Compare with v1

    Args:
        x_signature: x-signature header value
        x_request_id: x-request-id header value
        data_id: data.id from webhook body

    Returns:
        True if signature is valid, False otherwise
    """
    if not MP_WEBHOOK_SECRET:
        # If no secret configured, skip validation (log warning)
        print("WARNING: MERCADOPAGO_WEBHOOK_SECRET not configured, skipping signature validation")
        return True

    if not x_signature or not x_request_id:
        print("Missing signature headers")
        return False

    try:
        # Parse x-signature: "ts=1234567890,v1=abc123..."
        parts = {}
        for part in x_signature.split(","):
            if "=" in part:
                key, value = part.split("=", 1)
                parts[key] = value

        ts = parts.get("ts")
        v1 = parts.get("v1")

        if not ts or not v1:
            print(f"Invalid x-signature format: {x_signature}")
            return False

        # Build the manifest string
        # Format: "id:[data.id];request-id:[x-request-id];ts:[ts];"
        manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"

        # Calculate HMAC-SHA256
        calculated_hash = hmac.new(
            MP_WEBHOOK_SECRET.encode(),
            manifest.encode(),
            hashlib.sha256
        ).hexdigest()

        # Compare signatures
        is_valid = hmac.compare_digest(calculated_hash, v1)

        if not is_valid:
            print(f"Signature mismatch. Expected: {v1}, Got: {calculated_hash}")

        return is_valid

    except Exception as e:
        print(f"Error verifying webhook signature: {e}")
        return False
