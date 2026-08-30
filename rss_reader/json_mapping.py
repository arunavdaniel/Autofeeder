from __future__ import annotations

import json
import re
from typing import Any


def get_path(value: Any, path: str) -> Any:
    current = value
    path = (path or "").strip().removeprefix("$.").removeprefix("$")
    if not path:
        return current
    tokens = [
        match.group(1) or match.group(2)
        for match in re.finditer(r"([^.\[\]]+)|\[([^\]]+)\]", path)
    ]
    for token in tokens:
        if isinstance(current, dict):
            current = current.get(token)
        elif isinstance(current, list) and str(token).isdigit():
            current = current[int(token)] if int(token) < len(current) else None
        else:
            return None
        if current is None:
            return None
    return current


def candidate_arrays(value: Any, prefix: str = "") -> list[dict]:
    found = []
    if not prefix and isinstance(value, dict):
        found.append({"path": "$", "length": 1, "sample": [value]})
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(child, list):
                found.append({"path": path, "length": len(child), "sample": child[:3]})
            found.extend(candidate_arrays(child, path))
    return found


def map_records(payload: Any, config: dict) -> list[dict]:
    values = get_path(payload, config.get("item_pointer", ""))
    items = (
        values
        if isinstance(values, list)
        else ([values] if isinstance(values, dict) else [])
    )
    records = []
    for item in items:
        record = {}
        for field in config.get("fields", []):
            name = str(field.get("schema_field") or field.get("target") or "").strip()
            if not name:
                continue
            value = get_path(item, str(field.get("json_path") or ""))
            record[name] = (
                json.dumps(value, ensure_ascii=False)
                if isinstance(value, (dict, list))
                else value
            )
        if record:
            records.append(record)
    return records
