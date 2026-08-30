from __future__ import annotations

import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import catalog_providers

_LOCAL_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "source_catalog.json"
_REFRESH_LOCK = threading.Lock()


@lru_cache(maxsize=16)
def _cached_kind(kind: str, refresh_token: int) -> tuple[dict[str, Any], ...]:
    del refresh_token
    items = catalog_providers.fetch_kind(kind, refresh=False)
    return tuple(items)


def invalidate_catalog_cache() -> None:
    _cached_kind.cache_clear()


def load_kind(kind: str) -> list[dict[str, Any]]:
    return list(_cached_kind(kind, 0))


def load_catalog(*, refresh: bool = False) -> dict[str, list[dict[str, Any]]]:
    if refresh:
        with _REFRESH_LOCK:
            invalidate_catalog_cache()
            return {
                key: catalog_providers.fetch_kind(key, refresh=True)
                for key in catalog_providers.PROVIDERS
            }
    return {key: load_kind(key) for key in catalog_providers.PROVIDERS}


def warm_catalog_cache() -> None:
    catalog_providers.warm_cache()
    invalidate_catalog_cache()
    for key in catalog_providers.PROVIDERS:
        load_kind(key)


def catalog_sources() -> dict[str, Any]:
    sources = {
        kind: {
            **catalog_providers.provider_info(kind),
            **catalog_providers.cache_status().get(kind, {}),
        }
        for kind in catalog_providers.PROVIDERS
    }
    sources["feed_catalogs"] = list(catalog_providers.FEED_CATALOGS)
    return sources


def catalog_categories(kind: str) -> list[str]:
    items = load_kind(kind)
    return sorted({str(item.get("category") or "Other") for item in items})


def search_catalog(
    kind: str,
    query: str = "",
    category: str | None = None,
    *,
    offset: int = 0,
    limit: int | None = None,
) -> tuple[list[dict[str, Any]], int]:
    items = list(load_kind(kind))
    q = (query or "").strip().lower()
    if category and category != "all":
        items = [item for item in items if str(item.get("category") or "") == category]
    if q:
        items = [
            item
            for item in items
            if q in str(item.get("title") or item.get("name") or "").lower()
            or q in str(item.get("description") or "").lower()
            or q in str(item.get("url") or "").lower()
            or q in str(item.get("category") or "").lower()
            or q in str(item.get("catalog_source") or "").lower()
        ]
    total = len(items)
    start = max(offset, 0)
    if limit is not None:
        end = start + max(limit, 0)
        items = items[start:end]
    elif start:
        items = items[start:]
    return items, total


def _existing_urls(database, table: str, column: str = "url") -> set[str]:
    try:
        rows = database.connection.execute(f"SELECT {column} FROM {table}").fetchall()
    except Exception:
        return set()
    return {str(row[0]).strip().rstrip("/").lower() for row in rows if row[0]}


def _ensure_folder(database, name: str) -> int:
    folders = database.folders()
    for folder in folders:
        if str(folder["name"]).strip().lower() == name.strip().lower():
            return int(folder["id"])
    return int(database.add_folder(name))


def annotate_installed(database, kind: str, items: list[dict]) -> list[dict]:
    if kind == "feeds":
        existing = _existing_urls(database, "feeds")
    elif kind == "apis":
        existing = _existing_urls(database, "api_sources")
    else:
        existing = _existing_urls(database, "websites")
    out = []
    for item in items:
        row = dict(item)
        url = str(row.get("url") or "").strip().rstrip("/").lower()
        row["installed"] = url in existing
        out.append(row)
    return out


def install_catalog_items(
    database,
    kind: str,
    ids: list[str],
    *,
    folder_name: str = "Discover",
    category: str | None = None,
) -> dict[str, Any]:
    key = {"feed": "feeds", "feeds": "feeds", "api": "apis", "apis": "apis", "website": "websites", "websites": "websites"}.get(
        kind, kind
    )
    pool = list(load_kind(key))
    if category and category != "all":
        pool = [item for item in pool if str(item.get("category") or "") == category]
    if ids:
        wanted = set(ids)
        pool = [item for item in pool if item.get("id") in wanted]
    if not pool:
        return {"added": 0, "skipped": 0, "errors": [], "items": []}

    added: list[dict] = []
    skipped: list[str] = []
    errors: list[dict] = []

    if key == "feeds":
        folder_id = _ensure_folder(database, folder_name)
        existing = _existing_urls(database, "feeds")
        for item in pool:
            url = str(item.get("url") or "").strip()
            norm = url.rstrip("/").lower()
            if norm in existing:
                skipped.append(str(item.get("id")))
                continue
            try:
                feed_id = database.add_feed(
                    folder_id,
                    item.get("title") or url,
                    url,
                    item.get("site_url") or "",
                )
                existing.add(norm)
                added.append({"catalog_id": item.get("id"), "id": feed_id, "title": item.get("title")})
            except Exception as exc:  # noqa: BLE001
                errors.append({"id": item.get("id"), "error": str(exc)})

    elif key == "apis":
        existing = _existing_urls(database, "api_sources")
        for item in pool:
            url = str(item.get("url") or "").strip()
            norm = url.rstrip("/").lower()
            if norm in existing:
                skipped.append(str(item.get("id")))
                continue
            payload = {
                "name": item.get("name") or url,
                "url": url,
                "frequency": item.get("frequency") or "1h",
                "enabled": True,
            }
            config = {}
            if item.get("item_pointer"):
                config["item_pointer"] = item["item_pointer"]
            if item.get("fields"):
                config["fields"] = item["fields"]
            try:
                source_id = database.save_api_source(payload)
                database.update_api_extraction_config(source_id, config)
                existing.add(norm)
                added.append({"catalog_id": item.get("id"), "id": source_id, "name": payload["name"]})
            except Exception as exc:  # noqa: BLE001
                errors.append({"id": item.get("id"), "error": str(exc)})

    else:
        existing = _existing_urls(database, "websites")
        for item in pool:
            url = str(item.get("url") or "").strip()
            norm = url.rstrip("/").lower()
            if norm in existing:
                skipped.append(str(item.get("id")))
                continue
            payload = {
                "name": item.get("name") or url,
                "url": url,
                "fetch_method": item.get("fetch_method") or "http",
                "frequency": item.get("frequency") or "1h",
                "enabled": True,
                "fetch_options": item.get("fetch_options") or {},
            }
            if item.get("content_selector"):
                payload["fetch_options"] = {
                    **payload["fetch_options"],
                    "content_selector": item["content_selector"],
                }
            try:
                website_id = database.save_website(payload)
                existing.add(norm)
                added.append({"catalog_id": item.get("id"), "id": website_id, "name": payload["name"]})
            except Exception as exc:  # noqa: BLE001
                errors.append({"id": item.get("id"), "error": str(exc)})

    return {
        "added": len(added),
        "skipped": len(skipped),
        "errors": errors,
        "items": added,
        "skipped_ids": skipped,
    }
