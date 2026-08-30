from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import datetime
from typing import Any

from bs4 import BeautifulSoup

from .fetchers import FetchResult, fetch_page, normalize_backend
from .session_store import load_cookie_state, session_path

DEFAULT_IGNORE_SELECTORS = [
    "script",
    "style",
    "noscript",
    "template",
    "nav",
    "footer",
    "aside",
    "header",
    "[role=banner]",
    "[role=navigation]",
    "[role=contentinfo]",
    ".ads",
    ".ad",
    ".advert",
    ".advertisement",
    ".cookie-banner",
    ".cookie-consent",
    "#cookie-banner",
]

FREQ_MINUTES = {
    "5m": 5,
    "10m": 10,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "6h": 360,
    "daily": 1440,
}

_CHECK_LOCKS: dict[int, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _site_lock(website_id: int) -> threading.Lock:
    with _LOCKS_GUARD:
        lock = _CHECK_LOCKS.get(website_id)
        if lock is None:
            lock = threading.Lock()
            _CHECK_LOCKS[website_id] = lock
        return lock


def parse_fetch_options(value: object) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def website_options(website: Any) -> dict:
    if website is None:
        return {}
    if isinstance(website, dict):
        return parse_fetch_options(website.get("fetch_options"))
    options = parse_fetch_options(
        website["fetch_options"] if "fetch_options" in website.keys() else "{}"
    )
    if "id" in website.keys():
        options["session_file"] = str(session_path(int(website["id"])))
    return options


def normalize_html(
    html: str,
    content_selector: str = "",
    ignore_selectors: list[str] | None = None,
) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    selectors = list(DEFAULT_IGNORE_SELECTORS)
    for extra in ignore_selectors or []:
        if extra and extra not in selectors:
            selectors.append(extra)
    for selector in selectors:
        for element in soup.select(selector):
            element.decompose()
    root = soup
    if content_selector:
        match = soup.select_one(content_selector)
        if match is not None:
            root = match
    text = root.get_text("\n", strip=True)
    return normalize_text(text)


def normalize_text(text: str) -> str:
    text = re.sub(r"https?://\S+", lambda m: m.group(0).split("?")[0], text or "")
    text = re.sub(r"utm_[a-z]+=[^&\s]+", "", text, flags=re.I)
    text = re.sub(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", "", text)
    text = re.sub(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def fetch_website(url: str, method: str = "http", options: dict | None = None) -> dict:
    result = fetch_page(url, method, options)
    if result.error:
        raise RuntimeError(result.error)
    text = _clean_from_result(result, options or {})
    return {
        "html": result.html,
        "text": text,
        "hash": content_hash(text),
        "title": result.title,
        "status_code": result.status_code,
        "backend": result.backend,
        "duration_ms": result.duration_ms,
        "content_type": result.content_type,
    }


def _extract_readable(html: str, url: str = "") -> str:
    try:
        import trafilatura

        extracted = trafilatura.extract(
            html,
            url=url or None,
            include_links=False,
            output_format="txt",
        )
        if extracted:
            return normalize_text(extracted)
    except Exception:
        pass
    return ""


def _clean_from_result(result: FetchResult, options: dict) -> str:
    selector = str(options.get("content_selector") or "")
    ignore = options.get("ignore_selectors")
    if isinstance(ignore, str):
        ignore = [item.strip() for item in ignore.split(",") if item.strip()]
    ignore = ignore or []
    url = str(options.get("url") or "")
    if result.html:
        text = normalize_html(result.html, selector, ignore)
        if selector:
            return text
        alt = _extract_readable(result.html, url)
        if alt and len(alt) > len(text) + 40:
            return alt
        if not text.strip():
            return alt or text
        return text
    return normalize_text(result.text)


def preview_html(html: str) -> str:
    """Return inert HTML suitable for the selector viewer iframe."""
    soup = BeautifulSoup(html or "", "html.parser")
    for element in soup.find_all(["script", "iframe", "object", "embed", "form"]):
        element.decompose()
    for element in soup.find_all(True):
        for attribute in list(element.attrs):
            if attribute.lower().startswith("on"):
                del element.attrs[attribute]
    return str(soup)


def selector_preview(html: str, selector: str = "", mode: str = "content") -> dict:
    soup = BeautifulSoup(html or "", "html.parser")
    nodes = soup.select(selector) if selector else [soup.body or soup]
    if not nodes:
        return {"text": "", "tables": [], "match_count": 0}
    tables = []
    for node in nodes:
        candidates = [node] if node.name == "table" else node.select("table")
        for table in candidates:
            rows = []
            for tr in table.select("tr"):
                values = [
                    normalize_text(cell.get_text(" ", strip=True))
                    for cell in tr.select("th, td")
                ]
                if values:
                    rows.append(values)
            if rows:
                headers = (
                    rows[0]
                    if table.select_one("tr th")
                    else [f"column_{i + 1}" for i in range(len(rows[0]))]
                )
                tables.append(
                    {
                        "selector": _css_selector(table),
                        "headers": headers,
                        "rows": rows[1:] if table.select_one("tr th") else rows,
                    }
                )
    text = normalize_text("\n".join(node.get_text("\n", strip=True) for node in nodes))
    return {"text": text, "tables": tables, "match_count": len(nodes), "mode": mode}


def _css_selector(element) -> str:
    parts = []
    current = element
    while current and current.name not in {"[document]", "html"} and len(parts) < 8:
        part = current.name
        if current.get("id"):
            part += "#" + current["id"]
        elif current.get("class"):
            part += "".join("." + value for value in current.get("class", [])[:2])
        parent = current.parent
        if parent and getattr(parent, "find_all", None):
            siblings = [
                child for child in parent.find_all(current.name, recursive=False)
            ]
            if len(siblings) > 1 and current in siblings:
                part += f":nth-of-type({siblings.index(current) + 1})"
        parts.insert(0, part)
        current = parent
    return " > ".join(parts)


def diff_text(previous: str, current: str) -> str:
    import difflib

    lines = difflib.unified_diff(
        (previous or "").splitlines(),
        (current or "").splitlines(),
        fromfile="previous",
        tofile="current",
        lineterm="",
    )
    return "\n".join(lines)


def changed_excerpt(diff: str, fallback: str, limit: int = 12_000) -> str:
    added = [
        line[1:]
        for line in (diff or "").splitlines()
        if line.startswith("+") and not line.startswith("+++")
    ]
    excerpt = "\n".join(added).strip()
    if len(excerpt) < 40:
        return (fallback or "")[:limit]
    return excerpt[:limit]


def website_is_due(website: Any, now: datetime | None = None) -> bool:
    enabled = (
        website["enabled"]
        if not isinstance(website, dict)
        else website.get("enabled", 1)
    )
    if not enabled:
        return False
    last = (
        website["last_checked"]
        if not isinstance(website, dict)
        else website.get("last_checked")
    )
    frequency = (
        website["frequency"]
        if not isinstance(website, dict)
        else website.get("frequency")
    ) or "1h"
    minutes = FREQ_MINUTES.get(str(frequency), 60)
    if not last:
        return True
    now = now or datetime.now()
    try:
        last_dt = datetime.fromisoformat(str(last))
    except Exception:
        return True
    return (now - last_dt).total_seconds() >= minutes * 60


def check_website_monitor(database, website_id: int, *, blocking: bool = True) -> dict:
    lock = _site_lock(website_id)
    if not lock.acquire(blocking=blocking):
        return {"skipped": True, "error": "A check is already running for this website"}
    try:
        return _run_check(database, website_id)
    finally:
        lock.release()


def _run_check(database, website_id: int) -> dict:
    website = database.website(website_id)
    if not website:
        return {"error": "Website not found"}
    options = {**website_options(website), "url": website["url"]}
    backend = normalize_backend(website["fetch_method"])
    started_at = datetime.now().isoformat(timespec="seconds")
    started = datetime.now()
    result = fetch_page(website["url"], backend, options)
    duration_ms = result.duration_ms or int(
        (datetime.now() - started).total_seconds() * 1000
    )
    if result.error:
        check_id = database.add_website_check(
            website_id,
            started_at=started_at,
            finished_at=datetime.now().isoformat(timespec="seconds"),
            backend=backend,
            status_code=result.status_code,
            snapshot_id=None,
            changed=False,
            change_id=None,
            error=result.error,
            duration_ms=duration_ms,
        )
        database.touch_website_check(
            website_id,
            error=result.error,
            backend=backend,
            status_code=result.status_code,
            duration_ms=duration_ms,
        )
        return {
            "error": result.error,
            "backend": backend,
            "check_id": check_id,
            "changed": False,
            "duration_ms": duration_ms,
        }

    text = _clean_from_result(result, options)
    digest = content_hash(text)
    previous = database.latest_website_snapshot(website_id)
    changed = not previous or previous["content_hash"] != digest
    snapshot_id = database.add_website_snapshot(
        website_id,
        digest,
        result.html,
        text,
        previous["id"] if previous else None,
        changed,
        backend=backend,
        status_code=result.status_code,
        title=result.title,
        duration_ms=duration_ms,
    )
    change_id = None
    diff = ""
    rows_json = "[]"
    if changed:
        diff = (
            diff_text(previous["clean_text"], text)
            if previous
            else (text or "")[:10000]
        )
        if options.get("mode") == "table" and options.get("table_selector"):
            selected = selector_preview(
                result.html, str(options.get("table_selector")), "table"
            )
            rows_data: list[dict] = []
            column_map = options.get("column_map") or {}
            for table_meta in selected.get("tables", []):
                headers = table_meta.get("headers") or []
                for row in table_meta.get("rows", []):
                    record_row: dict[str, Any] = {}
                    for i, cell in enumerate(row):
                        header = headers[i] if i < len(headers) else f"column_{i + 1}"
                        key = column_map.get(header, header)
                        record_row[str(key)] = cell
                    if record_row:
                        rows_data.append(record_row)
            rows_json = json.dumps(rows_data, ensure_ascii=False)
        change_id = database.add_website_change(
            website_id,
            snapshot_id,
            previous["id"] if previous else None,
            diff,
            rows_json,
        )
    check_id = database.add_website_check(
        website_id,
        started_at=started_at,
        finished_at=datetime.now().isoformat(timespec="seconds"),
        backend=backend,
        status_code=result.status_code,
        snapshot_id=snapshot_id,
        changed=changed,
        change_id=change_id,
        error="",
        duration_ms=duration_ms,
    )
    database.touch_website_check(
        website_id,
        error="",
        backend=backend,
        status_code=result.status_code,
        duration_ms=duration_ms,
        changed=changed,
    )
    return {
        "snapshot_id": snapshot_id,
        "change_id": change_id,
        "changed": changed,
        "text": text,
        "diff": diff,
        "title": result.title,
        "backend": backend,
        "status_code": result.status_code,
        "duration_ms": duration_ms,
        "content_hash": digest,
        "check_id": check_id,
        "kind": "external" if backend in {"firecrawl", "browserless"} else "local",
    }
