from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from typing import Any

import requests

from .database import data_directory

_LOCAL_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "source_catalog.json"
_SNAPSHOT_DIR = Path(__file__).resolve().parent / "data" / "catalog_snapshots"

CACHE_TTL_SECONDS = 6 * 60 * 60
_FETCH_TIMEOUT_SECONDS = 12

PROVIDERS: dict[str, dict[str, Any]] = {
    "feeds": {
        "id": "tidings-plenary",
        "name": "Tidings + Plenary",
        "repo": "https://github.com/plenaryapp/awesome-rss-feeds",
        "description": "Tidings RSS plus Plenary awesome-rss-feeds (recommended topics and country news OPMLs).",
        "url": "https://raw.githubusercontent.com/fuxiaoai/tidings-rss/main/data/feeds.json",
    },
    "apis": {
        "id": "agent-public-apis",
        "name": "Agent Public APIs",
        "repo": "https://github.com/hfcorriez/agent-public-apis",
        "description": "374 live-verified public APIs — no API key, HTTPS only.",
        "url": "https://raw.githubusercontent.com/hfcorriez/agent-public-apis/main/data/apis.json",
    },
    "websites": {
        "id": "feedseek",
        "name": "Feedseek",
        "repo": "https://github.com/trvny/feedseek",
        "description": "Sites tracked by the Feedseek open-source feed generator.",
        "url": "https://raw.githubusercontent.com/trvny/feedseek/main/feeds.yaml",
    },
}

FEED_CATALOGS = [
    {
        "id": "tidings",
        "name": "Tidings RSS",
        "repo": "https://github.com/fuxiaoai/tidings-rss",
        "description": "Validated RSS/Atom feeds with categories.",
    },
    {
        "id": "plenary",
        "name": "Plenary awesome-rss-feeds",
        "repo": "https://github.com/plenaryapp/awesome-rss-feeds",
        "description": "Curated recommended topics and local news OPMLs (~500+ feeds).",
    },
]

PLENARY_ZIP_URL = "https://github.com/plenaryapp/awesome-rss-feeds/archive/refs/heads/master.zip"

_FETCH_LOCK = threading.Lock()
_REFRESHING: set[str] = set()


def provider_info(kind: str) -> dict[str, Any]:
    return dict(PROVIDERS[kind])


def _cache_dir(*, ensure: bool = False) -> Path:
    directory = data_directory() / "catalog_cache"
    if ensure:
        directory.mkdir(parents=True, exist_ok=True)
    return directory


def _cache_path(kind: str, *, ensure: bool = False) -> Path:
    provider = PROVIDERS[kind]
    return _cache_dir(ensure=ensure) / f"{provider['id']}.json"


def _cache_meta_path(kind: str) -> Path:
    return _cache_path(kind).with_suffix(".meta.json")


def _read_stale_cache(kind: str) -> list[dict[str, Any]] | None:
    path = _cache_path(kind)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _cache_is_stale(kind: str) -> bool:
    meta_path = _cache_meta_path(kind)
    if not meta_path.exists():
        return True
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return time.time() - float(meta.get("fetched_at", 0)) > CACHE_TTL_SECONDS
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return True


def _write_cache(kind: str, items: list[dict[str, Any]], *, source_url: str) -> None:
    _cache_path(kind, ensure=True).write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    _cache_meta_path(kind).write_text(
        json.dumps(
            {
                "fetched_at": time.time(),
                "source_url": source_url,
                "provider": PROVIDERS[kind]["id"],
                "count": len(items),
            }
        ),
        encoding="utf-8",
    )


def _fetch_text(url: str, timeout: int = _FETCH_TIMEOUT_SECONDS) -> str:
    response = requests.get(url, timeout=timeout, headers={"User-Agent": "RSS-Text-Reader/1.0"})
    response.raise_for_status()
    return response.text


def _clean_description(text: Any, category: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    if "订阅源" in value or value.startswith("公众号"):
        return f"{category} source" if category else ""
    return value


def _polish_item(item: dict[str, Any]) -> dict[str, Any]:
    row = dict(item)
    row["description"] = _clean_description(row.get("description"), str(row.get("category") or ""))
    return row


def _normalize_tidings_feeds(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    seen: set[str] = set()
    for row in payload.get("feeds") or []:
        feed_url = str(row.get("feed_url") or "").strip()
        if not feed_url:
            continue
        key = feed_url.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        feed_id = str(row.get("id") or feed_url)
        category = str(row.get("category") or "Other")
        items.append(
            {
                "id": f"tidings:{feed_id}",
                "title": row.get("title") or feed_url,
                "url": feed_url,
                "site_url": row.get("site_url") or "",
                "category": category,
                "description": _clean_description(row.get("description"), category),
                "language": row.get("language"),
                "catalog_source": "tidings",
            }
        )
    return items


def _normalize_agent_apis(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for row in payload.get("apis") or []:
        if row.get("spec_only"):
            continue
        url = str(row.get("url") or "").strip()
        if not url:
            continue
        fields = [
            {"schema_field": field, "json_path": field}
            for field in (row.get("fields") or [])
            if field
        ]
        items.append(
            {
                "id": f"agent-api:{row.get('id') or url}",
                "name": row.get("name") or url,
                "url": url,
                "category": row.get("category") or "Other",
                "description": row.get("description") or "",
                "item_pointer": "",
                "fields": fields,
                "frequency": "6h",
                "catalog_source": "agent-public-apis",
            }
        )
    return items


def _parse_opml_outlines(xml_text: str, category: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items
    for outline in root.iter("outline"):
        url = (outline.attrib.get("xmlUrl") or outline.attrib.get("xmlurl") or "").strip()
        if not url:
            continue
        title = (outline.attrib.get("title") or outline.attrib.get("text") or url).strip()
        description = (outline.attrib.get("description") or "").strip()
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "feed"
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
        items.append(
            {
                "id": f"plenary:{slug}:{digest}",
                "title": title,
                "url": url,
                "site_url": "",
                "category": category,
                "description": description,
                "catalog_source": "plenary",
            }
        )
    return items


def _plenary_category_from_path(path: str) -> str:
    name = Path(path).stem
    if "/countries/" in path.replace("\\", "/"):
        return f"News — {name}"
    return name


def _fetch_plenary_feeds() -> list[dict[str, Any]]:
    response = requests.get(
        PLENARY_ZIP_URL,
        timeout=45,
        headers={"User-Agent": "RSS-Text-Reader/1.0"},
        allow_redirects=True,
    )
    response.raise_for_status()
    archive = zipfile.ZipFile(BytesIO(response.content))
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in archive.namelist():
        path = name.replace("\\", "/")
        if not path.endswith(".opml") or "/with_category/" not in path:
            continue
        category = _plenary_category_from_path(path)
        try:
            text = archive.read(name).decode("utf-8", errors="replace")
        except KeyError:
            continue
        for item in _parse_opml_outlines(text, category):
            key = item["url"].rstrip("/").lower()
            if key in seen:
                continue
            seen.add(key)
            items.append(item)
    return items


def _merge_feed_catalogs(tidings: list[dict[str, Any]], plenary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in tidings + plenary:
        key = str(item.get("url") or "").rstrip("/").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def _parse_feedseek_yaml(text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    current_slug: str | None = None
    current_url: str | None = None
    for line in text.splitlines():
        if line.startswith("feeds:"):
            continue
        top = re.match(r"^  ([a-z0-9_]+):\s*$", line)
        if top:
            if current_slug and current_url:
                items.append(_feedseek_entry(current_slug, current_url))
            current_slug = top.group(1)
            current_url = None
            continue
        blog = re.match(r"^\s+blog_url:\s*(.+)\s*$", line)
        if blog and current_slug:
            current_url = blog.group(1).strip()
    if current_slug and current_url:
        items.append(_feedseek_entry(current_slug, current_url))
    return items


def _feedseek_entry(slug: str, url: str) -> dict[str, Any]:
    label = slug.replace("_", " ").strip().title()
    category = "News & Media"
    lowered = slug.lower()
    if any(token in lowered for token in ("github", "openai", "anthropic", "claude", "microsoft", "meta")):
        category = "Technology"
    elif any(token in lowered for token in ("weather", "openweather")):
        category = "Weather"
    elif any(token in lowered for token in ("beatport", "music")):
        category = "Music"
    return {
        "id": f"feedseek:{slug}",
        "name": label,
        "url": url,
        "category": category,
        "description": f"Track changes on {url} (Feedseek registry).",
        "fetch_method": "http",
        "frequency": "6h",
        "catalog_source": "feedseek",
    }


def _normalize_local_fallback(kind: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for row in data.get(kind, []):
        item = dict(row)
        item.setdefault("catalog_source", "local")
        items.append(item)
    return items


def _bundled_snapshot(kind: str) -> list[dict[str, Any]] | None:
    path = _SNAPSHOT_DIR / f"{kind}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _local_fallback(kind: str) -> list[dict[str, Any]]:
    bundled = _bundled_snapshot(kind)
    if bundled:
        return bundled
    with _LOCAL_CATALOG_PATH.open(encoding="utf-8") as handle:
        return _normalize_local_fallback(kind, json.load(handle))


def _download_kind(kind: str) -> list[dict[str, Any]]:
    provider = PROVIDERS[kind]
    source_url = provider["url"]
    if kind == "feeds":
        tidings: list[dict[str, Any]] = []
        plenary: list[dict[str, Any]] = []
        errors: list[Exception] = []
        try:
            payload = json.loads(_fetch_text(provider["url"]))
            tidings = _normalize_tidings_feeds(payload)
        except (requests.RequestException, OSError, json.JSONDecodeError, ValueError) as exc:
            errors.append(exc)
        try:
            plenary = _fetch_plenary_feeds()
        except (requests.RequestException, OSError, zipfile.BadZipFile, ValueError) as exc:
            errors.append(exc)
        items = _merge_feed_catalogs(tidings, plenary)
        source_url = f"{provider['url']}|{PLENARY_ZIP_URL}"
        if not items and errors:
            raise errors[0]
    elif kind == "apis":
        payload = json.loads(_fetch_text(provider["url"]))
        items = _normalize_agent_apis(payload)
    else:
        items = _parse_feedseek_yaml(_fetch_text(provider["url"]))
    if not items:
        raise ValueError(f"Catalog provider returned no {kind}")
    _write_cache(kind, items, source_url=source_url)
    return items


def _refresh_kind_async(kind: str) -> None:
    if kind in _REFRESHING or not _cache_is_stale(kind):
        return

    def worker() -> None:
        _REFRESHING.add(kind)
        try:
            with _FETCH_LOCK:
                _download_kind(kind)
        except Exception:
            pass
        finally:
            _REFRESHING.discard(kind)

    threading.Thread(target=worker, daemon=True).start()


def fetch_kind(kind: str, *, refresh: bool = False) -> list[dict[str, Any]]:
    if kind not in PROVIDERS:
        raise ValueError(f"Unknown catalog kind: {kind}")

    if not refresh:
        cached = _read_stale_cache(kind)
        if cached:
            if _cache_is_stale(kind):
                _refresh_kind_async(kind)
            return [_polish_item(item) for item in cached]

    with _FETCH_LOCK:
        if not refresh:
            cached = _read_stale_cache(kind)
            if cached:
                return [_polish_item(item) for item in cached]
        try:
            return [_polish_item(item) for item in _download_kind(kind)]
        except (requests.RequestException, OSError, json.JSONDecodeError, ValueError):
            stale = _read_stale_cache(kind)
            if stale:
                return [_polish_item(item) for item in stale]
            return [_polish_item(item) for item in _local_fallback(kind)]


def fetch_all(*, refresh: bool = False) -> dict[str, list[dict[str, Any]]]:
    return {kind: fetch_kind(kind, refresh=refresh) for kind in PROVIDERS}


def warm_cache() -> None:
    for kind in PROVIDERS:
        try:
            fetch_kind(kind, refresh=False)
        except Exception:
            continue


def cache_status() -> dict[str, Any]:
    status: dict[str, Any] = {}
    for kind, provider in PROVIDERS.items():
        meta_path = _cache_meta_path(kind)
        entry = {
            "provider": provider,
            "cached": False,
            "fetched_at": None,
            "count": 0,
            "stale": _cache_is_stale(kind),
        }
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                entry["cached"] = True
                entry["fetched_at"] = meta.get("fetched_at")
                entry["count"] = meta.get("count", 0)
            except (OSError, json.JSONDecodeError):
                pass
        stale = _read_stale_cache(kind)
        if stale and not entry["count"]:
            entry["count"] = len(stale)
            entry["cached"] = True
        status[kind] = entry
    return status
