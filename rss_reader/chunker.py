from __future__ import annotations

import re


def chunk_text(
    text: str, size: int = 800, overlap: int = 120, strategy: str = "paragraph"
) -> list[str]:
    """Split text into bounded overlapping chunks without external dependencies."""
    size = max(1, int(size or 800))
    overlap = min(max(0, int(overlap or 0)), size - 1)
    if strategy == "sentence":
        units = re.split(r"(?<=[.!?])\s+", text.strip())
    else:
        units = re.split(r"\n\s*\n", text.strip())
    units = [u.strip() for u in units if u.strip()]
    chunks: list[str] = []
    current = ""
    for unit in units or [text.strip()]:
        if current and len(current) + len(unit) + 1 > size:
            chunks.append(current)
            current = current[-overlap:] if overlap else ""
        current = f"{current}\n\n{unit}".strip() if current else unit
        while len(current) > size:
            chunks.append(current[:size])
            current = current[size - overlap :] if overlap else current[size:]
    if current:
        chunks.append(current)
    return chunks
