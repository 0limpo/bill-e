"""Image utilities — pure functions, no I/O."""


def detect_image_mime(image_bytes: bytes) -> str:
    """
    Inspect magic bytes and return the MIME type. Falls back to
    'application/octet-stream' if the format is unrecognized.
    """
    if len(image_bytes) < 4:
        return "application/octet-stream"

    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:4] == b"RIFF" and len(image_bytes) >= 12 and image_bytes[8:12] == b"WEBP":
        return "image/webp"

    return "application/octet-stream"
