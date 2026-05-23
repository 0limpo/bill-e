"""
test_image_utils.py

Standalone tests para detect_image_mime. Run:
    python backend/test_image_utils.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import image_utils  # noqa: E402


def test_jpeg():
    # JPEG magic: FF D8 FF
    assert image_utils.detect_image_mime(b"\xff\xd8\xff\xe0\x00\x10JFIF") == "image/jpeg"


def test_png():
    # PNG magic: 89 50 4E 47 0D 0A 1A 0A
    assert image_utils.detect_image_mime(b"\x89PNG\r\n\x1a\n\x00\x00") == "image/png"


def test_webp():
    # WebP: RIFF....WEBP
    assert image_utils.detect_image_mime(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"


def test_unknown_defaults_to_octet_stream():
    assert image_utils.detect_image_mime(b"not a real image") == "application/octet-stream"


def test_empty_bytes():
    assert image_utils.detect_image_mime(b"") == "application/octet-stream"


if __name__ == "__main__":
    test_jpeg()
    test_png()
    test_webp()
    test_unknown_defaults_to_octet_stream()
    test_empty_bytes()
    print("All image_utils tests passed.")
