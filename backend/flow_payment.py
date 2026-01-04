"""
Flow.cl Payment Integration for Bill-e
Simplified flow: User clicks -> Redirect to Flow -> Webhook confirms -> Premium activated
"""

import hashlib
import hmac
import json
import requests
from datetime import datetime
from typing import Optional, Dict, Any
import os

# Configuration from environment
FLOW_API_KEY = os.getenv("FLOW_API_KEY", "")
FLOW_SECRET_KEY = os.getenv("FLOW_SECRET_KEY", "")
FLOW_API_URL = os.getenv("FLOW_API_URL", "https://www.flow.cl/api")
FLOW_DEFAULT_EMAIL = os.getenv("FLOW_DEFAULT_EMAIL", "")  # Email registered in Flow merchant account

# Price configuration
PREMIUM_PRICE_CLP = int(os.getenv("PREMIUM_PRICE_CLP", "1990"))


def generate_signature(params: Dict[str, Any]) -> str:
    """
    Generate HMAC-SHA256 signature for Flow API.

    Flow requires:
    1. Sort parameters alphabetically by key
    2. Concatenate key-value pairs into single string
    3. Sign with HMAC-SHA256 using secretKey
    """
    if not FLOW_SECRET_KEY:
        raise ValueError("FLOW_SECRET_KEY not configured")

    # Sort keys alphabetically
    sorted_keys = sorted(params.keys())

    # Concatenate key-value pairs
    to_sign = ""
    for key in sorted_keys:
        to_sign += f"{key}{params[key]}"

    # Generate HMAC-SHA256 signature
    signature = hmac.new(
        FLOW_SECRET_KEY.encode(),
        to_sign.encode(),
        hashlib.sha256
    ).hexdigest()

    return signature


def create_payment(
    commerce_order: str,
    subject: str,
    amount: int,
    url_confirmation: str,
    url_return: str,
    optional_data: Dict = None,
    email: str = None  # If None, uses FLOW_DEFAULT_EMAIL from env
) -> Dict[str, Any]:
    """
    Create a payment order in Flow.cl.

    Args:
        commerce_order: Unique order ID (our reference)
        subject: Payment description shown to user
        amount: Amount in CLP (minimum 350)
        url_confirmation: Webhook URL for payment confirmation
        url_return: URL to redirect user after payment
        optional_data: Additional data to store (returned in webhook)
        email: Default email (Flow will ask user for real one)

    Returns:
        {
            "url": "https://www.flow.cl/app/web/pay.php",
            "token": "XXXXX",
            "flowOrder": 12345
        }
    """
    if not FLOW_API_KEY:
        raise ValueError("FLOW_API_KEY not configured")

    if amount < 350:
        raise ValueError("Minimum payment amount is 350 CLP")

    # Use provided email or default from environment
    payment_email = email or FLOW_DEFAULT_EMAIL
    if not payment_email:
        raise ValueError("FLOW_DEFAULT_EMAIL not configured")

    params = {
        "apiKey": FLOW_API_KEY,
        "commerceOrder": commerce_order,
        "subject": subject,
        "amount": amount,
        "email": payment_email,
        "urlConfirmation": url_confirmation,
        "urlReturn": url_return,
        "currency": "CLP",
        "paymentMethod": 1,  # 1 = Webpay only (credit/debit cards)
    }

    if optional_data:
        params["optional"] = json.dumps(optional_data)

    # Generate signature
    params["s"] = generate_signature(params)

    # Make API request
    response = requests.post(
        f"{FLOW_API_URL}/payment/create",
        data=params,
        timeout=30
    )

    if response.status_code != 200:
        error_msg = f"Flow API error: {response.status_code} - {response.text}"
        print(error_msg)
        raise Exception(error_msg)

    result = response.json()

    # Check for API error response
    if "code" in result and result.get("code") != 0:
        error_msg = f"Flow API error: {result.get('message', 'Unknown error')}"
        print(error_msg)
        raise Exception(error_msg)

    return result


def get_payment_status(token: str) -> Dict[str, Any]:
    """
    Get payment status from Flow.cl using the token.

    Args:
        token: Flow payment token (received in webhook)

    Returns:
        Payment details including:
        - flowOrder: Flow transaction ID
        - commerceOrder: Our order ID
        - status: 1 = pending, 2 = paid, 3 = rejected, 4 = cancelled
        - amount, currency
        - payer: email of payer
        - paymentData: method, date, fees
        - optional: our custom data
    """
    if not FLOW_API_KEY:
        raise ValueError("FLOW_API_KEY not configured")

    params = {
        "apiKey": FLOW_API_KEY,
        "token": token
    }

    # Generate signature
    params["s"] = generate_signature(params)

    # Make API request
    response = requests.get(
        f"{FLOW_API_URL}/payment/getStatus",
        params=params,
        timeout=30
    )

    if response.status_code != 200:
        error_msg = f"Flow API error: {response.status_code} - {response.text}"
        print(error_msg)
        raise Exception(error_msg)

    return response.json()


def build_payment_url(flow_response: Dict[str, Any]) -> str:
    """
    Build the full payment URL from Flow's response.

    Args:
        flow_response: Response from create_payment()

    Returns:
        Full URL to redirect user to Flow payment page
    """
    url = flow_response.get("url", "")
    token = flow_response.get("token", "")

    if not url or not token:
        raise ValueError("Invalid Flow response: missing url or token")

    return f"{url}?token={token}"


# Payment status constants
class FlowPaymentStatus:
    PENDING = 1
    PAID = 2
    REJECTED = 3
    CANCELLED = 4

    @staticmethod
    def to_string(status: int) -> str:
        mapping = {
            1: "pending",
            2: "paid",
            3: "rejected",
            4: "cancelled"
        }
        return mapping.get(status, "unknown")


def get_premium_price() -> int:
    """Get the configured premium price in CLP."""
    return PREMIUM_PRICE_CLP


def calculate_neto_iva(total_con_iva: int) -> Dict[str, int]:
    """
    Calculate neto and IVA from total price (IVA included).
    Chilean IVA is 19%.

    Args:
        total_con_iva: Total price including IVA

    Returns:
        {"neto": X, "iva": Y, "total": Z}
    """
    neto = round(total_con_iva / 1.19)
    iva = total_con_iva - neto
    return {
        "neto": neto,
        "iva": iva,
        "total": total_con_iva
    }
