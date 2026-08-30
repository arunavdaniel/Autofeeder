from __future__ import annotations

import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests

DEFAULT_USER_AGENT = "Autofeeder/0.1 (+local website monitor)"
LOCAL_BACKENDS = {
    "http",
    "playwright-chromium",
    "playwright-firefox",
    "playwright-webkit",
    "browser",
    "selenium-chrome",
    "selenium-firefox",
}
EXTERNAL_BACKENDS = {"firecrawl", "browserless"}
BACKEND_ALIASES = {
    "browser": "playwright-chromium",
    "playwright": "playwright-chromium",
    "selenium": "selenium-chrome",
}


@dataclass
class FetchResult:
    url: str
    html: str = ""
    text: str = ""
    title: str = ""
    fetched_at: str = ""
    backend: str = "http"
    status_code: int | None = None
    content_type: str = ""
    duration_ms: int = 0
    error: str = ""
    headers: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def normalize_backend(name: str | None) -> str:
    raw = (name or "http").strip().lower()
    return BACKEND_ALIASES.get(raw, raw)


def sanitize_playwright_env(env: dict[str, str] | None = None) -> dict[str, str]:
    """Drop Cursor/CI Playwright cache dirs that do not actually contain browsers."""
    target = env if env is not None else os.environ
    raw = (target.get("PLAYWRIGHT_BROWSERS_PATH") or "").strip()
    if not raw:
        return dict(target)
    root = Path(raw)
    if not root.is_dir() or not any(root.glob("chromium*")):
        target.pop("PLAYWRIGHT_BROWSERS_PATH", None)
    return dict(target)


def _launch_playwright_browser(playwright: Any, engine: str, *, headless: bool, **launch_kwargs: Any):
    sanitize_playwright_env()
    engine = engine if engine in {"chromium", "firefox", "webkit"} else "chromium"
    launcher = getattr(playwright, engine)
    errors: list[str] = []
    previous_shell = os.environ.get("PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL")
    try:
        try:
            return launcher.launch(headless=headless, **launch_kwargs)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
        os.environ["PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL"] = "0"
        try:
            return launcher.launch(headless=headless, **launch_kwargs)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
        if engine == "chromium":
            try:
                return launcher.launch(headless=headless, channel="chrome", **launch_kwargs)
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
    finally:
        if previous_shell is None:
            os.environ.pop("PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL", None)
        else:
            os.environ["PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL"] = previous_shell
    hint = f" Run: python -m playwright install {engine}"
    raise RuntimeError(f"{engine} is not available.{hint} ({'; '.join(errors[-2:])})")


def backend_kind(name: str) -> str:
    backend = normalize_backend(name)
    return "external" if backend in EXTERNAL_BACKENDS else "local"


def backend_catalog() -> list[dict[str, Any]]:
    playwright_engines = _playwright_engines()
    return [
        {
            "id": "http",
            "label": "HTTP",
            "kind": "local",
            "available": True,
            "hint": "Fastest. Use for static HTML.",
        },
        {
            "id": "playwright-chromium",
            "label": "Playwright · Chromium",
            "kind": "local",
            "available": playwright_engines.get("chromium", False),
            "hint": "python -m playwright install chromium",
        },
        {
            "id": "playwright-firefox",
            "label": "Playwright · Firefox",
            "kind": "local",
            "available": playwright_engines.get("firefox", False),
            "hint": "python -m playwright install firefox",
        },
        {
            "id": "playwright-webkit",
            "label": "Playwright · WebKit",
            "kind": "local",
            "available": playwright_engines.get("webkit", False),
            "hint": "python -m playwright install webkit",
        },
        {
            "id": "selenium-chrome",
            "label": "Selenium · Chrome",
            "kind": "local",
            "available": _selenium_available(),
            "hint": "Install with: python -m pip install selenium",
        },
        {
            "id": "selenium-firefox",
            "label": "Selenium · Firefox",
            "kind": "local",
            "available": _selenium_available(),
            "hint": "Install with: python -m pip install selenium",
        },
        {
            "id": "firecrawl",
            "label": "Firecrawl",
            "kind": "external",
            "available": True,
            "hint": "Sends the URL to Firecrawl. API key required.",
        },
        {
            "id": "browserless",
            "label": "Browserless / CDP",
            "kind": "external",
            "available": True,
            "hint": "Connects to a remote Chromium/CDP endpoint.",
        },
    ]


def fetch_page(
    url: str, backend: str = "http", options: dict | None = None
) -> FetchResult:
    sanitize_playwright_env()
    options = dict(options or {})
    backend = normalize_backend(backend)
    started = time.perf_counter()
    fetched_at = (
        datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    )
    user_agent = options.get("user_agent") or DEFAULT_USER_AGENT
    if options.get("respect_robots", True) and not _robots_allowed(url, user_agent):
        return FetchResult(
            url=url,
            backend=backend,
            fetched_at=fetched_at,
            error="Blocked by robots.txt",
        )
    try:
        if backend == "http":
            result = _fetch_http(url, options)
        elif backend.startswith("playwright-"):
            result = _fetch_playwright(
                url, backend.removeprefix("playwright-"), options
            )
        elif backend.startswith("selenium-"):
            result = _fetch_selenium(url, backend.removeprefix("selenium-"), options)
        elif backend == "firecrawl":
            result = _fetch_firecrawl(url, options)
        elif backend == "browserless":
            result = _fetch_browserless(url, options)
        else:
            raise ValueError(f"Unknown fetch backend: {backend}")
    except Exception as exc:  # noqa: BLE001
        result = FetchResult(url=url, backend=backend, error=str(exc))
    result.fetched_at = fetched_at
    result.backend = backend
    result.duration_ms = int((time.perf_counter() - started) * 1000)
    return result


def _fetch_http(url: str, options: dict) -> FetchResult:
    timeout_s = max(1.0, float(options.get("timeout_ms", 30_000) or 30_000) / 1000)
    user_agent = options.get("user_agent") or DEFAULT_USER_AGENT
    response = requests.get(
        url,
        timeout=(5, timeout_s),
        headers={"User-Agent": user_agent},
    )
    response.raise_for_status()
    html = response.text or ""
    return FetchResult(
        url=url,
        html=html,
        title=_title_from_html(html),
        status_code=response.status_code,
        content_type=response.headers.get("Content-Type", ""),
        headers={k: v for k, v in response.headers.items()},
    )


def _fetch_playwright(url: str, engine: str, options: dict) -> FetchResult:
    from playwright.sync_api import Error as PlaywrightError, sync_playwright

    engine = engine if engine in {"chromium", "firefox", "webkit"} else "chromium"
    timeout_ms = int(options.get("timeout_ms", 30_000) or 30_000)
    wait_until = options.get("wait_until") or "domcontentloaded"
    extra_wait = int(options.get("extra_wait_ms", 500) or 0)
    user_agent = options.get("user_agent") or DEFAULT_USER_AGENT
    headless = bool(options.get("headless", True))
    try:
        with sync_playwright() as playwright:
            browser = _launch_playwright_browser(playwright, engine, headless=headless)
            context_options = {"user_agent": user_agent, "java_script_enabled": True}
            session_file = options.get("session_file")
            if session_file and __import__("pathlib").Path(session_file).exists():
                context_options["storage_state"] = session_file
            context = browser.new_context(**context_options)
            page = context.new_page()
            response = page.goto(url, wait_until=wait_until, timeout=timeout_ms)
            if extra_wait > 0:
                page.wait_for_timeout(extra_wait)
            html = page.content()
            title = page.title()
            if session_file:
                context.storage_state(path=session_file)
            status = response.status if response else None
            browser.close()
            return FetchResult(
                url=url,
                html=html,
                title=title,
                status_code=status,
                content_type="text/html",
            )
    except PlaywrightError as exc:
        hint = ""
        message = str(exc)
        if "Executable doesn't exist" in message or "browserType.launch" in message:
            hint = f" Run: python -m playwright install {engine}"
        raise RuntimeError(f"{engine} is not available.{hint} ({exc})") from exc


def _fetch_selenium(url: str, browser_name: str, options: dict) -> FetchResult:
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options as ChromeOptions
        from selenium.webdriver.firefox.options import Options as FirefoxOptions
    except ImportError as exc:
        raise RuntimeError(
            "Selenium is not installed. Run: python -m pip install selenium"
        ) from exc

    headless = bool(options.get("headless", True))
    timeout_ms = int(options.get("timeout_ms", 30_000) or 30_000)
    user_agent = options.get("user_agent") or DEFAULT_USER_AGENT
    if browser_name == "firefox":
        browser_options = FirefoxOptions()
        if headless:
            browser_options.add_argument("-headless")
        browser_options.set_preference("general.useragent.override", user_agent)
        driver = webdriver.Firefox(options=browser_options)
    else:
        browser_options = ChromeOptions()
        if headless:
            browser_options.add_argument("--headless=new")
        browser_options.add_argument("--no-sandbox")
        browser_options.add_argument("--disable-dev-shm-usage")
        browser_options.add_argument(f"--user-agent={user_agent}")
        if options.get("session_file"):
            from pathlib import Path

            browser_options.add_argument(
                f"--user-data-dir={Path(options['session_file']).with_suffix('')}"
            )
        driver = webdriver.Chrome(options=browser_options)
    try:
        driver.set_page_load_timeout(max(1, timeout_ms // 1000))
        driver.get(url)
        session_file = options.get("session_file")
        if session_file:
            try:
                import json
                from pathlib import Path

                state = json.loads(Path(session_file).read_text(encoding="utf-8"))
                for cookie in state.get("cookies", []):
                    value = {
                        key: cookie[key]
                        for key in (
                            "name",
                            "value",
                            "path",
                            "domain",
                            "secure",
                            "httpOnly",
                        )
                        if key in cookie
                    }
                    try:
                        driver.add_cookie(value)
                    except Exception:
                        pass
                if state.get("cookies"):
                    driver.refresh()
            except (OSError, ValueError):
                pass
        extra_wait = int(options.get("extra_wait_ms", 500) or 0)
        if extra_wait:
            time.sleep(extra_wait / 1000)
        html = driver.page_source or ""
        title = driver.title or ""
        return FetchResult(
            url=url, html=html, title=title, status_code=200, content_type="text/html"
        )
    finally:
        driver.quit()


def _fetch_firecrawl(url: str, options: dict) -> FetchResult:
    from .extractor import extract_firecrawl

    api_key = options.get("firecrawl_api_key") or ""
    base_url = options.get("firecrawl_base_url") or "https://api.firecrawl.dev"
    fmt = options.get("firecrawl_format") or "markdown"
    data = extract_firecrawl(url, api_key, scrape_format=fmt, base_url=base_url)
    html = data.get("html") or ""
    text = data.get("text") or data.get("clean_text") or ""
    if not html and text:
        html = f"<html><body><pre>{text}</pre></body></html>"
    return FetchResult(
        url=url,
        html=html,
        text=text,
        title=data.get("title") or "",
        status_code=200,
        content_type="text/markdown" if fmt == "markdown" else "text/html",
    )


def _fetch_browserless(url: str, options: dict) -> FetchResult:
    from playwright.sync_api import sync_playwright

    endpoint = (options.get("browserless_endpoint") or "").strip()
    if not endpoint:
        raise ValueError("A Browserless / CDP endpoint is required")
    timeout_ms = int(options.get("timeout_ms", 30_000) or 30_000)
    wait_until = options.get("wait_until") or "domcontentloaded"
    extra_wait = int(options.get("extra_wait_ms", 500) or 0)
    user_agent = options.get("user_agent") or DEFAULT_USER_AGENT
    with sync_playwright() as playwright:
        if endpoint.startswith("ws"):
            browser = playwright.chromium.connect(endpoint, timeout=timeout_ms)
        else:
            browser = playwright.chromium.connect_over_cdp(endpoint, timeout=timeout_ms)
        page = browser.new_page(user_agent=user_agent)
        response = page.goto(url, wait_until=wait_until, timeout=timeout_ms)
        if extra_wait > 0:
            page.wait_for_timeout(extra_wait)
        html = page.content()
        title = page.title()
        status = response.status if response else None
        browser.close()
        return FetchResult(
            url=url,
            html=html,
            title=title,
            status_code=status,
            content_type="text/html",
        )


def _title_from_html(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    if soup.title and soup.title.string:
        return soup.title.get_text(" ", strip=True)
    heading = soup.find(["h1", "h2"])
    return heading.get_text(" ", strip=True) if heading else ""


def _robots_allowed(url: str, user_agent: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return True
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = RobotFileParser()
    try:
        parser.set_url(robots_url)
        parser.read()
        return parser.can_fetch(user_agent, url)
    except Exception:
        return True


def _playwright_engines() -> dict[str, bool]:
    available = {"chromium": False, "firefox": False, "webkit": False}
    sanitize_playwright_env()
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            for name in available:
                launcher = getattr(playwright, name)
                try:
                    path = launcher.executable_path
                    available[name] = bool(path) and Path(path).exists()
                except Exception:
                    available[name] = False
    except Exception:
        pass
    return available


def _selenium_available() -> bool:
    try:
        import selenium  # noqa: F401

        return True
    except ImportError:
        return False
