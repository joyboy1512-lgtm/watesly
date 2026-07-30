from pathlib import Path
import re

DANGEROUS_EXTENSIONS = {
    ".exe", ".dll", ".bat", ".cmd", ".com", ".js", ".jar",
    ".msi", ".ps1", ".sh", ".php", ".html", ".svg",
}
MAGIC_TYPES = {
    bytes.fromhex("255044462d"): "application/pdf",
    bytes.fromhex("ffd8ff"): "image/jpeg",
    bytes.fromhex("89504e470d0a1a0a"): "image/png",
    b"OggS": "audio/ogg",
}


def sanitize_filename(filename: str) -> str:
    base = Path(filename).name
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")
    return (base or "unnamed")[:180]


def validate_file_content(filename: str, claimed_type: str | None, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in DANGEROUS_EXTENSIONS:
        raise ValueError("DANGEROUS_FILE_EXTENSION")

    detected = None
    for signature, content_type in MAGIC_TYPES.items():
        if content.startswith(signature):
            detected = content_type
            break

    if claimed_type == "image/webp" and content.startswith(b"RIFF") and b"WEBP" in content[:16]:
        detected = "image/webp"
    if claimed_type == "video/mp4" and b"ftyp" in content[:32]:
        detected = "video/mp4"
    if claimed_type == "audio/mpeg" and (content.startswith(b"ID3") or content[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}):
        detected = "audio/mpeg"

    if detected is None or detected != claimed_type:
        raise ValueError("FILE_SIGNATURE_MISMATCH")
    return detected
