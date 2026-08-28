from __future__ import annotations

import re
from html import unescape
from urllib.parse import urljoin

import requests
import trafilatura
from bs4 import BeautifulSoup
from playwright.sync_api import Error as PlaywrightError, sync_playwright


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


def download_page(url: str) -> str:
    """Render JavaScript pages first, then fall back to a normal HTTP request."""
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(
                user_agent="RSS Text Reader/0.1", java_script_enabled=True
            )
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_timeout(500)
            html = page.content()
            browser.close()
            return html
    except (PlaywrightError, TimeoutError):
        response = requests.get(
            url, timeout=(5, 30), headers={"User-Agent": "RSS Text Reader/0.1"}
        )
        response.raise_for_status()
        return response.text


def extract_article(item: dict, source: str = "") -> dict:
    text = ""
    clean_text = ""
    links: list[dict[str, str]] = []
    url = item.get("url", "")
    if url:
        try:
            page_html = download_page(url)
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
