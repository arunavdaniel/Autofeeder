from __future__ import annotations

import re
from html import unescape
from urllib.parse import urljoin

import requests
import trafilatura
from bs4 import BeautifulSoup


def html_to_text(value: str) -> str:
    soup = BeautifulSoup(unescape(value or ""), "html.parser")
    for element in soup(["script", "style", "noscript", "template"]):
        element.decompose()
    return re.sub(r"\n{3,}", "\n\n", soup.get_text("\n", strip=True)).strip()


def extract_links(value: str, base_url: str = "") -> list[dict[str, str]]:
    soup = BeautifulSoup(unescape(value or ""), "html.parser")
    links = []
    for anchor in soup.select("a[href]"):
        href = urljoin(base_url, anchor["href"].strip())
        if href.startswith(("http://", "https://")):
            links.append(
                {"text": anchor.get_text(" ", strip=True) or href, "url": href}
            )
    return links


def download_page(url: str, use_browser: bool = True) -> str:
    """Fetch a page. Uses Playwright when requested, then falls back to HTTP."""
    from .fetchers import fetch_page

    options = {"respect_robots": False, "timeout_ms": 30_000, "extra_wait_ms": 500}
    if use_browser:
        result = fetch_page(url, "playwright-chromium", options)
        if result.html:
            return result.html
    result = fetch_page(url, "http", options)
    if result.error and not result.html:
        raise requests.RequestException(result.error)
    return result.html


def extract_firecrawl(
    url: str,
    api_key: str,
    scrape_format: str = "markdown",
    base_url: str = "https://api.firecrawl.dev",
) -> dict:
    """Fetch an article using the Firecrawl API.

    Works with Firecrawl Cloud (https://api.firecrawl.dev) or any self-hosted
    Firecrawl instance by passing its base URL. Returns the same shape as
    extract_article so callers can treat both uniformly.
    """
    if not api_key:
        raise ValueError("A Firecrawl API key is required")
    base = (base_url or "https://api.firecrawl.dev").rstrip("/")
    endpoint = f"{base}/v1/scrape"
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }
    payload = {"url": url, "formats": [scrape_format]}
    response = requests.post(endpoint, headers=headers, json=payload, timeout=(10, 60))
    response.raise_for_status()
    payload_resp = response.json()
    if not payload_resp.get("success"):
        raise ValueError(payload_resp.get("error", "Firecrawl request failed"))
    data = payload_resp.get("data", {})
    content = data.get("markdown") or data.get("html") or data.get("content") or ""
    text = html_to_text(content) if scrape_format != "markdown" else (content or "")
    links = extract_links(data.get("html", ""), url) if data.get("html") else []
    clean_text = text
    return {
        "url": url,
        "title": data.get("metadata", {}).get("title", "")
        if isinstance(data.get("metadata"), dict)
        else "",
        "html": data.get("html") or "",
        "text": text,
        "clean_text": clean_text,
        "links": links,
        "author": "",
        "published": "",
        "source": "",
    }


def extract_article(
    item: dict,
    source: str = "",
    fetch_source: str = "builtin",
    firecrawl_api_key: str | None = None,
    firecrawl_base_url: str = "https://api.firecrawl.dev",
    use_browser: bool = True,
) -> dict:
    item = {
        k: v
        for k, v in (item or {}).items()
        if k not in ("fetch_source", "firecrawl_api_key")
    }
    text = ""
    clean_text = ""
    links: list[dict[str, str]] = []
    url = item.get("url", "")
    if url and fetch_source == "firecrawl":
        try:
            fc = extract_firecrawl(
                url, firecrawl_api_key or "", base_url=firecrawl_base_url
            )
            fc["source"] = source
            return fc
        except (
            requests.RequestException,
            ValueError,
            TypeError,
            AttributeError,
        ) as exc:
            return {
                **item,
                "source": source,
                "text": f"Firecrawl extraction failed: {exc}\n\nOriginal link: {url or 'Not available'}",
                "clean_text": "",
                "links": [],
            }
    if url:
        try:
            page_html = download_page(url, use_browser=use_browser)
            links = extract_links(page_html, url)
            text = html_to_text(page_html)
            clean_text = (
                trafilatura.extract(
                    page_html,
                    url=url,
                    include_links=True,
                    include_formatting=True,
                    output_format="txt",
                )
                or ""
            )
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            text = ""
    if not text:
        feed_html = item.get("content") or item.get("summary", "")
        text = html_to_text(feed_html)
        links = links or extract_links(feed_html, url)
    if not text:
        text = (
            f"{item.get('title', 'Untitled')}\n\n"
            "This feed did not provide article text, and the linked page could not be read.\n\n"
            f"Original link: {url or 'Not available'}"
        )
    if links:
        text += "\n\nLINKS FOUND ON PAGE\n" + "\n".join(
            f"- {link['text']}: {link['url']}" for link in links
        )
    return {
        **item,
        "source": source,
        "text": text,
        "clean_text": clean_text,
        "links": links,
    }
