"""
Standalone tests para ip_utils. Run:
    python backend/test_ip_utils.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import ip_utils  # noqa: E402


class FakeRequest:
    def __init__(self, headers=None, client_host=None):
        self.headers = headers or {}
        self.client = type("C", (), {"host": client_host})() if client_host else None


def test_extract_cf_connecting_ip_wins():
    req = FakeRequest(
        headers={"CF-Connecting-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8"},
        client_host="9.9.9.9",
    )
    assert ip_utils.extract_client_ip(req) == "1.2.3.4"


def test_x_forwarded_for_fallback():
    req = FakeRequest(
        headers={"X-Forwarded-For": "5.6.7.8, 10.0.0.1"},
        client_host="9.9.9.9",
    )
    assert ip_utils.extract_client_ip(req) == "5.6.7.8"


def test_client_host_fallback():
    req = FakeRequest(headers={}, client_host="9.9.9.9")
    assert ip_utils.extract_client_ip(req) == "9.9.9.9"


def test_extract_returns_unknown_if_nothing():
    req = FakeRequest(headers={}, client_host=None)
    assert ip_utils.extract_client_ip(req) == "unknown"


def test_hash_ip_is_sha256_hex():
    h = ip_utils.hash_ip("1.2.3.4")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)
    # Determinism
    assert ip_utils.hash_ip("1.2.3.4") == h


def test_hash_ip_none_returns_none():
    assert ip_utils.hash_ip(None) is None
    assert ip_utils.hash_ip("") is None


if __name__ == "__main__":
    test_extract_cf_connecting_ip_wins()
    test_x_forwarded_for_fallback()
    test_client_host_fallback()
    test_extract_returns_unknown_if_nothing()
    test_hash_ip_is_sha256_hex()
    test_hash_ip_none_returns_none()
    print("All ip_utils tests passed.")
