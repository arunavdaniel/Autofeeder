from __future__ import annotations

import feedparser
import requests
import json
from typing import Any


def parse_json_feed(data: Any, url: str) -> dict:
    items_list = []
    if isinstance(data, list):
        items_list = data
    elif isinstance(data, dict):
        for key in ["items", "articles", "data", "results", "posts", "rows", "news", "entries"]:
            val = data.get(key)
            if isinstance(val, list):
                items_list = val
                break
        if not items_list:
            for key, val in data.items():
                if isinstance(val, list):
                    items_list = val
                    break

    items = []
    for idx, entry in enumerate(items_list):
        if not isinstance(entry, dict):
            continue
        
        title = ""
        for key in ["title", "name", "headline", "subject", "text"]:
            if entry.get(key):
                title = str(entry[key]).strip()
                break
        
        url_val = ""
        for key in ["url", "link", "source_url", "href", "article_url"]:
            if entry.get(key):
                url_val = str(entry[key]).strip()
                break
        
        pub = ""
        for key in ["published", "published_at", "created_at", "date", "time", "updated", "published_date", "created"]:
            if entry.get(key):
                pub = str(entry[key]).strip()
                break
                
        content = ""
        for key in ["content", "text", "body", "summary", "description", "content_text", "article_body"]:
            if entry.get(key):
                content = str(entry[key]).strip()
                break
                
        if not url_val and title:
            url_val = f"{url}#item-{idx}"
            
        items.append({
            "title": title or "Untitled",
            "url": url_val,
            "published": pub,
            "summary": content[:200] if content else "",
            "content": content
        })
        
    title = "JSON API"
    if isinstance(data, dict):
        title = data.get("title") or data.get("name") or "JSON API"
        
    return {
        "title": title,
        "site_url": url,
        "items": items
    }


def fetch_feed(url: str) -> dict:
    response = requests.get(
        url, timeout=20, headers={"User-Agent": "RSS Text Reader/0.1"}
    )
    response.raise_for_status()
    
    is_json = False
    headers = getattr(response, "headers", {}) or {}
    content_type = headers.get("content-type", "")
    if "application/json" in content_type or url.endswith(".json"):
        is_json = True
        
    if is_json:
        try:
            data = response.json()
            return parse_json_feed(data, url)
        except Exception:
            pass
            
    try:
        parsed = feedparser.parse(response.content)
        if parsed.bozo and not parsed.entries:
            raise ValueError("Bozo exception")
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
    except Exception:
        try:
            data = response.json()
            return parse_json_feed(data, url)
        except Exception:
            raise ValueError("The URL did not contain a readable RSS feed or JSON API.")
