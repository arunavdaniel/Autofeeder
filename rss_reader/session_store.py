from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .database import data_directory


def session_path(website_id: int) -> Path:
    directory = data_directory() / "sessions"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"website-{int(website_id)}.json"
    if path.exists():
        path.chmod(0o600)
    return path


def save_cookie_state(website_id: int, state: dict) -> Path:
    path = session_path(website_id)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    path.chmod(0o600)
    return path


def load_cookie_state(website_id: int) -> dict | None:
    path = session_path(website_id)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def clear_cookie_state(website_id: int) -> None:
    session_path(website_id).unlink(missing_ok=True)


def open_interactive_session(
    website_id: int,
    url: str,
    backend: str = "playwright-chromium",
    options: dict | None = None,
) -> Path:
    """Open a visible browser for manual, user-authorized interaction."""
    from playwright.sync_api import sync_playwright

    from .fetchers import sanitize_playwright_env, _launch_playwright_browser

    options = dict(options or {})
    engine = backend.removeprefix("playwright-")
    if engine not in {"chromium", "firefox", "webkit"}:
        engine = "chromium"
    path = session_path(website_id)
    sanitize_playwright_env()
    with sync_playwright() as playwright:
        browser = _launch_playwright_browser(playwright, engine, headless=False)
        context_options = {}
        if path.exists():
            context_options["storage_state"] = str(path)
        context = browser.new_context(
            viewport={
                "width": int(options.get("viewport_width", 1440)),
                "height": int(options.get("viewport_height", 900)),
            },
            locale=options.get("locale") or "en-US",
            timezone_id=options.get("timezone") or "UTC",
            **context_options,
        )
        page = context.new_page()
        page.goto(
            url,
            wait_until=options.get("wait_until") or "domcontentloaded",
            timeout=int(options.get("timeout_ms", 30000)),
        )
        while browser.is_connected() and not page.is_closed():
            time.sleep(1)
        try:
            context.storage_state(path=str(path))
        except Exception:
            pass
        if browser.is_connected():
            browser.close()
        return path
