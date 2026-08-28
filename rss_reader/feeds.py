from __future__ import annotations

import feedparser
import requests


def fetch_feed(url: str) -> dict:
    response = requests.get(
        url, timeout=20, headers={"User-Agent": "RSS Text Reader/0.1"}
    )
    response.raise_for_status()
    parsed = feedparser.parse(response.content)
    if parsed.bozo and not parsed.entries:
        raise ValueError("The URL did not contain a readable RSS or Atom feed.")
    feed = parsed.feed
    items = []
    for entry in parsed.entries:
        items.append(
            {
                "title": entry.get("title", "Untitled").strip(),
                "url": entry.get("link", "").strip(),
                "published": entry.get("published", entry.get("updated", "")),
                "summary": entry.get("summary", ""),
                "content": entry.get("content", [{}])[0].get("value", "")
                if entry.get("content")
                else "",
            }
        )
    return {
        "title": feed.get("title", url),
        "site_url": feed.get("link", ""),
        "items": items,
    }
