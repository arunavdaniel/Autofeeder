from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
import xml.etree.ElementTree as ET
import sqlite3
from datetime import datetime
from pathlib import Path

import requests
from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    send_from_directory,
    stream_with_context,
)

from .database import Database
from . import duckstore
from .extractor import extract_article, extract_firecrawl
from .feeds import fetch_feed
from .llm import extract_json, generate_schema
from .pipeline import (
    _flatten,
    request_cancel,
    resolve_definition,
    run_pipeline_safe,
    schema_from_fields,
)
from .backup import create_backup, restore_backup
from .fetchers import backend_catalog, backend_kind, fetch_page, normalize_backend
from .website import (
    check_website_monitor,
    fetch_website,
    parse_fetch_options,
    website_is_due,
    website_options,
    preview_html,
    selector_preview,
)
from .vectorstore import index_document, search as vector_search
from .session_store import clear_cookie_state, open_interactive_session, session_path
from .json_mapping import candidate_arrays, map_records
from . import catalog
from . import publish
from . import embeddings


def _serialize_website(row: sqlite3.Row, pending: int = 0, snapshots: int = 0) -> dict:
    value = dict(row)
    value["fetch_options"] = parse_fetch_options(value.get("fetch_options"))
    value["destination"] = json.loads(value.get("destination") or "{}")
    value["enabled"] = bool(value.get("enabled", 1))
    value["pending_changes"] = pending
    value["snapshot_count"] = snapshots
    return value


def _linked_pipeline_ids(database: Database, website_id: int) -> list[int]:
    ids: list[int] = []
    website = database.website(website_id)
    if website and website["pipeline_id"]:
        ids.append(int(website["pipeline_id"]))
    for row in database.pipelines():
        definition = json.loads(row["definition"])
        source = definition.get("source") or {}
        if source.get("type") == "websites" and website_id in [
            int(x) for x in source.get("website_ids", [])
        ]:
            if int(row["id"]) not in ids:
                ids.append(int(row["id"]))
    return ids


def _feed_scope_from_definition(definition: dict) -> tuple[list[int], list[int]]:
    feed_ids: set[int] = set(int(x) for x in definition.get("feed_ids", []) or [])
    folder_ids: set[int] = set(int(x) for x in definition.get("folder_ids", []) or [])
    sources = definition.get("sources")
    if not sources:
        source = definition.get("source") or {}
        if source.get("type") == "feeds":
            feed_ids.update(int(x) for x in source.get("feed_ids", []) or [])
    else:
        for source in sources:
            if source.get("type") == "feeds":
                feed_ids.update(int(x) for x in source.get("feed_ids", []) or [])
    return sorted(feed_ids), sorted(folder_ids)


def _error_title(entry: object) -> str:
    if isinstance(entry, dict):
        return str(entry.get("title") or "")
    if isinstance(entry, (list, tuple)) and entry:
        return str(entry[0])
    return ""


def _start_linked_pipelines(
    database: Database, website_id: int, change_id: int
) -> list[int]:
    run_ids: list[int] = []
    for pipeline_id in _linked_pipeline_ids(database, website_id):
        row = database.pipeline(pipeline_id)
        if not row or not row["enabled"]:
            continue
        definition = json.loads(row["definition"])
        source = dict(definition.get("source") or {})
        source["type"] = "websites"
        source["website_ids"] = [website_id]
        source["change_ids"] = [change_id]
        definition["source"] = source
        run_id = database.create_run(pipeline_id, preview=False)
        threading.Thread(
            target=run_pipeline_safe, args=(database, definition, False, run_id), daemon=True
        ).start()
        run_ids.append(run_id)
    return run_ids


def _start_run(
    database: Database, pipeline_id: int, definition: dict, preview: bool
) -> int:
    run_id = database.create_run(pipeline_id, preview)
    threading.Thread(
        target=run_pipeline_safe,
        args=(database, definition, preview, run_id),
        daemon=True,
    ).start()
    return run_id


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _run_summary(row: sqlite3.Row, database: Database | None = None) -> dict:
    pipeline_name = None
    if database is not None:
        pipeline = database.pipeline(int(row["pipeline_id"]))
        pipeline_name = pipeline["name"] if pipeline else f"Pipeline {row['pipeline_id']}"
    return {
        "id": row["id"],
        "pipeline_id": row["pipeline_id"],
        "pipeline_name": pipeline_name,
        "preview": bool(row["preview"]),
        "status": row["status"],
        "phase": row["phase"],
        "last_message": row["last_message"],
        "progress_current": row["progress_current"],
        "progress_total": row["progress_total"],
        "articles_seen": row["articles_seen"],
        "records_count": row["records_count"],
        "error_count": row["error_count"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


def _frontend_dist_dir() -> Path:
    """Prefer the packaged SPA (uv/pip install), then a local Vite build."""
    packaged = Path(__file__).resolve().parent / "frontend_dist"
    if (packaged / "index.html").is_file():
        return packaged
    return Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app(database_path: Path | None = None) -> Flask:
    app = Flask(__name__)
    from .fetchers import sanitize_playwright_env

    sanitize_playwright_env()
    database = Database(database_path)
    database.migrate_snapshot_schedules_to_pipelines()
    app.config["DATABASE"] = database

    dist_dir = _frontend_dist_dir()

    def serve_spa():
        if dist_dir.is_dir():
            return send_from_directory(str(dist_dir), "index.html")
        return Response(
            "Frontend not built. Run `npm run build` in the frontend/ directory.",
            mimetype="text/plain",
        )

    @app.get("/")
    def index():
        return serve_spa()

    @app.get("/reader")
    def reader():
        return serve_spa()

    @app.get("/api/health")
    def health():
        return jsonify(ok=True, service="rss-text-reader")

    @app.get("/api/dashboard")
    def dashboard_data():
        folders = database.folders()
        feeds = [feed for folder in folders for feed in database.feeds(folder["id"])]
        pipelines = database.pipelines()
        totals = database.run_totals()
        last_runs = database.pipeline_runs(limit=1)
        last_run = last_runs[0] if last_runs else None
        return jsonify(
            {
                "folders": len(folders),
                "feeds": len(feeds),
                "websites": len(database.websites()),
                "api_sources": len(database.api_sources()),
                "pipelines": len(pipelines),
                "active_pipelines": sum(bool(row["enabled"]) for row in pipelines),
                "saved_articles": sum(
                    len(database.saved_articles(folder["id"])) for folder in folders
                ),
                "total_runs": totals["total_runs"],
                "active_runs": totals["active_runs"],
                "total_records": totals["total_records"],
                "total_errors": totals["total_errors"],
                "last_run": _run_summary(last_run, database) if last_run else None,
            }
        )

    @app.get("/pipelines")
    def pipelines_page():
        return serve_spa()

    @app.get("/runs")
    def runs_page():
        return serve_spa()

    @app.get("/api/folders")
    def list_folders():
        folders = []
        for folder in database.folders():
            folders.append(
                {
                    "id": folder["id"],
                    "name": folder["name"],
                    "feeds": [dict(feed) for feed in database.feeds(folder["id"])],
                    "saved_count": len(database.saved_articles(folder["id"])),
                }
            )
        return jsonify(folders)

    @app.post("/api/folders")
    def add_folder():
        name = (request.json or {}).get("name", "").strip()
        if not name:
            return jsonify(error="Folder name is required"), 400
        try:
            folder_id = database.add_folder(name)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(id=folder_id, name=name), 201

    @app.delete("/api/folders/<int:folder_id>")
    def delete_folder(folder_id: int):
        database.delete_folder(folder_id)
        return ("", 204)

    @app.patch("/api/folders/<int:folder_id>")
    def rename_folder(folder_id: int):
        name = (request.json or {}).get("name", "").strip()
        if not name:
            return jsonify(error="Folder name is required"), 400
        database.rename_folder(folder_id, name)
        return jsonify(ok=True)

    @app.post("/api/feeds")
    def add_feed():
        data = request.json or {}
        url = data.get("url", "").strip()
        folder_id = data.get("folder_id")
        if not url or not folder_id:
            return jsonify(error="Feed URL and folder are required"), 400
        try:
            info = fetch_feed(url)
            feed_id = database.add_feed(folder_id, info["title"], url, info["site_url"])
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(id=feed_id, title=info["title"]), 201

    @app.delete("/api/feeds/<int:feed_id>")
    def delete_feed(feed_id: int):
        database.delete_feed(feed_id)
        return ("", 204)

    @app.patch("/api/feeds/<int:feed_id>")
    def rename_feed(feed_id: int):
        name = (request.json or {}).get("title", "").strip()
        if not name:
            return jsonify(error="Feed name is required"), 400
        database.rename_feed(feed_id, name)
        return jsonify(ok=True)

    @app.get("/api/feeds/<int:feed_id>/items")
    def feed_items(feed_id: int):
        feed = next(
            (
                row
                for folder in database.folders()
                for row in database.feeds(folder["id"])
                if row["id"] == feed_id
            ),
            None,
        )
        if not feed:
            return jsonify(error="Feed not found"), 404
        try:
            result = fetch_feed(feed["url"])
        except Exception as exc:
            return jsonify(error=str(exc)), 502
        return jsonify(source=feed["title"], items=result["items"])

    @app.post("/api/article")
    def article():
        data = request.json or {}
        return jsonify(
            extract_article(
                data,
                data.get("source", ""),
                fetch_source=data.get("fetch_source", "builtin"),
                firecrawl_api_key=data.get("firecrawl_api_key"),
                firecrawl_base_url=data.get(
                    "firecrawl_base_url", "https://api.firecrawl.dev"
                ),
                use_browser=bool(data.get("use_browser", True)),
            )
        )

    @app.post("/api/article/firecrawl")
    def article_firecrawl():
        data = request.json or {}
        url = (data.get("url") or "").strip()
        if not url:
            return jsonify(error="url is required"), 400
        try:
            result = extract_firecrawl(
                url,
                data.get("api_key", "").strip(),
                base_url=data.get("base_url", "https://api.firecrawl.dev"),
            )
        except requests.RequestException as exc:
            return jsonify(error=f"Firecrawl request failed: {exc}"), 502
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(result)

    @app.post("/api/articles/bulk")
    def bulk_articles():
        data = request.json or {}
        articles = data.get("articles", [])
        if not isinstance(articles, list) or len(articles) > 100:
            return jsonify(error="Select between 1 and 100 articles"), 400
        fetch_source = data.get("fetch_source", "builtin")
        firecrawl_key = data.get("firecrawl_api_key")
        firecrawl_base = data.get("firecrawl_base_url", "https://api.firecrawl.dev")
        records = [
            extract_article(
                item,
                item.get("source", ""),
                fetch_source=fetch_source,
                firecrawl_api_key=firecrawl_key,
                firecrawl_base_url=firecrawl_base,
            )
            for item in articles
        ]
        dest = data.get("dest")
        if dest and dest.get("database"):
            try:
                duckstore.write_records(
                    dest["database"],
                    dest.get("table", "extractions"),
                    [
                        {
                            **r,
                            "_meta": {
                                "url": r.get("url"),
                                "feed_url": r.get("source"),
                                "author": r.get("author"),
                                "published": r.get("published"),
                                "categories": r.get("categories"),
                            },
                        }
                        for r in records
                    ],
                    mappings=dest.get("mappings"),
                    mode=dest.get("mode", "append"),
                    dedupe_key=dest.get("dedupe_key"),
                )
            except Exception as exc:  # noqa: BLE001
                return jsonify(error=f"DuckDB write failed: {exc}"), 400
        return jsonify(records)

    @app.get("/api/folders/<int:folder_id>/saved")
    def saved_articles(folder_id: int):
        return jsonify([dict(row) for row in database.saved_articles(folder_id)])

    @app.post("/api/folders/<int:folder_id>/saved")
    def save_article(folder_id: int):
        data = request.json or {}
        if not data.get("title") or not data.get("text"):
            return jsonify(error="Article title and text are required"), 400
        database.save_article(folder_id, data)
        return jsonify(ok=True), 201

    @app.post("/api/export")
    def export_article():
        text = (request.json or {}).get("text", "")
        response = app.response_class(text, mimetype="text/plain")
        response.headers["Content-Disposition"] = "attachment; filename=article.txt"
        return response

    @app.post("/api/llm/extract")
    def llm_extract():
        data = request.json or {}
        try:
            result = extract_json(
                data.get("endpoint", "").strip(),
                data.get("model", "").strip(),
                data.get("api_key", "").strip(),
                data.get("prompt", "").strip(),
                data.get("snapshot", ""),
            )
        except requests.RequestException as exc:
            return jsonify(error=f"LLM request failed: {exc}"), 502
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(result=result)

    @app.post("/api/llm/schema")
    def llm_schema():
        data = request.json or {}
        try:
            result = generate_schema(
                data.get("endpoint", "").strip(),
                data.get("model", "").strip(),
                data.get("api_key", "").strip(),
                data.get("prompt", "").strip(),
            )
        except requests.RequestException as exc:
            return jsonify(error=f"LLM request failed: {exc}"), 502
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(schema=result)

    @app.post("/api/llm/test")
    def llm_test():
        data = request.json or {}
        try:
            result = extract_json(
                data.get("endpoint", "").strip(),
                data.get("model", "").strip(),
                data.get("api_key", "").strip(),
                'Reply with only the JSON object {"ok": true}.',
                "test",
                timeout=float(data.get("timeout", 30) or 30),
            )
        except requests.RequestException as exc:
            return jsonify(error=f"LLM request failed: {exc}"), 502
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True, sample=result)

    # ----- API sources -----
    @app.get("/api/api-sources")
    def list_api_sources():
        return jsonify([dict(row) for row in database.api_sources()])

    @app.post("/api/api-sources")
    def create_api_source():
        data = request.json or {}
        if not str(data.get("url") or "").strip():
            return jsonify(error="API URL is required"), 400
        try:
            source_id = database.save_api_source(data)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(id=source_id), 201

    @app.patch("/api/api-sources/<int:source_id>")
    def update_api_source(source_id: int):
        try:
            current = database.api_source(source_id)
            if not current:
                return jsonify(error="API Source not found"), 404
            payload = dict(current)
            payload.update(request.json or {})
            database.save_api_source(payload, source_id)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True)

    @app.delete("/api/api-sources/<int:source_id>")
    def remove_api_source(source_id: int):
        database.delete_api_source(source_id)
        return ("", 204)

    @app.post("/api/api-sources/<int:source_id>/check")
    def check_api_source(source_id: int):
        source = database.api_source(source_id)
        if not source:
            return jsonify(error="API Source not found"), 404
        try:
            result = fetch_feed(source["url"])
            payload = json.dumps(result, sort_keys=True, default=str)
            previous = database.latest_api_snapshot(source_id)
            content_hash = hashlib.sha256(payload.encode()).hexdigest()
            changed = not previous or previous["content_hash"] != content_hash
            snapshot_id = database.add_api_snapshot(
                source_id,
                content_hash,
                payload,
                previous["id"] if previous else None,
                changed,
            )
            database.update_api_source_checked_time(source_id)
            return jsonify(
                {
                    "title": result.get("title", "JSON API"),
                    "items": result.get("items", []),
                    "snapshot_id": snapshot_id,
                    "changed": changed,
                }
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 500

    @app.get("/api/api-sources/<int:source_id>/snapshots")
    def api_source_snapshots(source_id: int):
        return jsonify([dict(row) for row in database.api_snapshots(source_id)])

    @app.get("/api/api-sources/snapshots/<int:snapshot_id>")
    def api_snapshot_detail(snapshot_id: int):
        row = database.api_snapshot(snapshot_id)
        if not row:
            return jsonify(error="API Snapshot not found"), 404
        return jsonify(dict(row))

    @app.get("/api/api-sources/<int:source_id>/json")
    def api_source_json(source_id: int):
        source = database.api_source(source_id)
        if not source:
            return jsonify(error="API Source not found"), 404
        try:
            response = requests.get(
                source["url"], timeout=30, headers={"User-Agent": "Autofeeder/0.1"}
            )
            response.raise_for_status()
            payload = response.json()
            return jsonify(
                payload=payload,
                arrays=candidate_arrays(payload),
                config=json.loads(source["extraction_config"] or "{}"),
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    @app.post("/api/api-sources/<int:source_id>/json-preview")
    def api_source_json_preview(source_id: int):
        data = request.json or {}
        records = map_records(data.get("payload"), data.get("config") or {})
        return jsonify(records=records[:50], count=len(records))

    @app.patch("/api/api-sources/<int:source_id>/extraction-config")
    def save_api_extraction_config(source_id: int):
        if not database.api_source(source_id):
            return jsonify(error="API Source not found"), 404
        config = request.json or {}
        database.update_api_extraction_config(source_id, config)
        return jsonify(ok=True, config=config)

    # ----- Source catalog (Feedly-style discover) -----
    @app.get("/api/catalog")
    def get_source_catalog():
        kind = str(request.args.get("kind") or "feeds")
        if kind not in {"feeds", "apis", "websites"}:
            return jsonify(error="kind must be feeds, apis, or websites"), 400
        try:
            query = str(request.args.get("q") or "")
            category = request.args.get("category")
            offset = max(int(request.args.get("offset") or 0), 0)
            limit = min(max(int(request.args.get("limit") or 60), 1), 200)
            items, total = catalog.search_catalog(kind, query, category, offset=offset, limit=limit)
            items = catalog.annotate_installed(database, kind, items)
            return jsonify(
                {
                    "kind": kind,
                    "categories": catalog.catalog_categories(kind),
                    "items": items,
                    "count": len(items),
                    "total": total,
                    "offset": offset,
                    "limit": limit,
                }
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 500

    @app.get("/api/catalog/sources")
    def catalog_sources():
        return jsonify(catalog.catalog_sources())

    @app.post("/api/catalog/refresh")
    def refresh_catalog():
        data = catalog.load_catalog(refresh=True)
        return jsonify(
            {
                "feeds": len(data.get("feeds", [])),
                "apis": len(data.get("apis", [])),
                "websites": len(data.get("websites", [])),
                "sources": catalog.catalog_sources(),
            }
        )

    @app.get("/api/catalog/summary")
    def catalog_summary():
        try:
            return jsonify(
                {
                    "feeds": len(catalog.load_kind("feeds")),
                    "apis": len(catalog.load_kind("apis")),
                    "websites": len(catalog.load_kind("websites")),
                    "categories": {
                        "feeds": catalog.catalog_categories("feeds"),
                        "apis": catalog.catalog_categories("apis"),
                        "websites": catalog.catalog_categories("websites"),
                    },
                    "sources": catalog.catalog_sources(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 500

    @app.post("/api/catalog/install")
    def install_catalog():
        data = request.json or {}
        kind = str(data.get("kind") or "feeds")
        ids = data.get("ids") or []
        if ids is not None and not isinstance(ids, list):
            return jsonify(error="ids must be a list"), 400
        try:
            result = catalog.install_catalog_items(
                database,
                kind,
                [str(item) for item in ids],
                folder_name=str(data.get("folder") or "Discover"),
                category=data.get("category"),
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(result), 201

    # ----- Website monitoring and local semantic search -----
    @app.get("/api/fetch-backends")
    def list_fetch_backends():
        return jsonify(backend_catalog())

    @app.post("/api/websites/test-fetch")
    def test_website_fetch():
        data = request.json or {}
        url = str(data.get("url") or "").strip()
        if not url:
            return jsonify(error="URL is required"), 400
        backend = normalize_backend(
            data.get("fetch_method") or data.get("backend") or "http"
        )
        options = parse_fetch_options(data.get("fetch_options"))
        if backend_kind(backend) == "external" and not data.get("confirm_external"):
            return jsonify(
                error="This backend sends the URL off this machine. Confirm to continue.",
                kind="external",
                backend=backend,
            ), 400
        result = fetch_page(url, backend, options)
        payload = result.to_dict()
        payload["kind"] = backend_kind(backend)
        payload.pop("headers", None)
        if result.html:
            from .website import _clean_from_result

            options["url"] = url
            payload["text"] = _clean_from_result(result, options)
            payload["text_length"] = len(payload["text"])
        payload["html"] = (result.html or "")[:4000]
        return jsonify(payload), 200 if not result.error else 502

    @app.post("/api/websites/preview")
    def website_preview():
        data = request.json or {}
        url = str(data.get("url") or "").strip()
        if not url:
            return jsonify(error="URL is required"), 400
        backend = normalize_backend(
            data.get("fetch_method") or data.get("backend") or "http"
        )
        options = parse_fetch_options(data.get("fetch_options"))
        options.update(data.get("options") or {})
        if backend_kind(backend) == "external" and not data.get("confirm_external"):
            return jsonify(
                error="This backend sends the URL off this machine. Confirm to continue.",
                kind="external",
            ), 400
        result = fetch_page(url, backend, options)
        if result.error:
            return jsonify(error=result.error, backend=backend), 502
        selected = selector_preview(
            result.html,
            str(data.get("selector") or ""),
            str(data.get("mode") or "content"),
        )
        return jsonify(
            {
                **result.to_dict(),
                "headers": {},
                "html": preview_html(result.html),
                **selected,
                "kind": backend_kind(backend),
            }
        )

    @app.get("/api/websites")
    def list_websites():
        pending = database.pending_change_counts()
        snaps = database.snapshot_counts()
        return jsonify(
            [
                _serialize_website(
                    row, pending.get(int(row["id"]), 0), snaps.get(int(row["id"]), 0)
                )
                for row in database.websites()
            ]
        )

    @app.post("/api/websites")
    def create_website():
        data = request.json or {}
        if not str(data.get("url") or "").strip():
            return jsonify(error="Website URL is required"), 400
        try:
            website_id = database.save_website(data)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(id=website_id), 201

    @app.patch("/api/websites/<int:website_id>")
    def update_website(website_id: int):
        try:
            current = database.website(website_id)
            if not current:
                return jsonify(error="Website not found"), 404
            payload = dict(current)
            incoming = request.json or {}
            if "fetch_options" in incoming:
                payload["fetch_options"] = incoming["fetch_options"]
            else:
                payload["fetch_options"] = parse_fetch_options(
                    current["fetch_options"]
                    if "fetch_options" in current.keys()
                    else "{}"
                )
            payload.update(incoming)
            database.save_website(payload, website_id)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True)

    @app.delete("/api/websites/<int:website_id>")
    def remove_website(website_id: int):
        database.delete_website(website_id)
        return ("", 204)

    @app.post("/api/websites/<int:website_id>/check")
    def check_website(website_id: int):
        source = database.website(website_id)
        if not source:
            return jsonify(error="Website not found"), 404
        result = check_website_monitor(database, website_id, blocking=False)
        if result.get("skipped"):
            return jsonify(result), 409
        if result.get("error") and not result.get("snapshot_id"):
            return jsonify(result), 502
        extract = bool((request.json or {}).get("extract"))
        run_ids = []
        if extract and result.get("changed") and result.get("change_id"):
            run_ids = _start_linked_pipelines(database, website_id, result["change_id"])
        result["run_ids"] = run_ids
        return jsonify(result)

    @app.post("/api/websites/<int:website_id>/session/open")
    def open_website_session(website_id: int):
        source = database.website(website_id)
        if not source:
            return jsonify(error="Website not found"), 404
        try:
            options = website_options(source)
            backend = normalize_backend(source["fetch_method"])
            threading.Thread(
                target=open_interactive_session,
                args=(website_id, source["url"], backend, options),
                daemon=True,
            ).start()
            return jsonify(
                ok=True,
                started=True,
                message="Browser session started. Close the browser window when finished.",
            ), 202
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    @app.delete("/api/websites/<int:website_id>/session")
    def clear_website_session(website_id: int):
        clear_cookie_state(website_id)
        return ("", 204)

    @app.get("/api/websites/<int:website_id>/snapshots")
    def website_snapshots(website_id: int):
        return jsonify([dict(row) for row in database.website_snapshots(website_id)])

    @app.get("/api/websites/snapshots/<int:snapshot_id>")
    def website_snapshot_detail(snapshot_id: int):
        row = database.website_snapshot(snapshot_id)
        if not row:
            return jsonify(error="Snapshot not found"), 404
        return jsonify(dict(row))

    @app.get("/api/websites/changes")
    def all_website_changes():
        status = request.args.get("status")
        rows = database.website_changes(None, status)
        sites = {int(row["id"]): row for row in database.websites()}
        payload = []
        for row in rows:
            item = dict(row)
            site = sites.get(int(row["source_id"]))
            if site:
                item["website_name"] = site["name"]
                item["website_url"] = site["url"]
            payload.append(item)
        return jsonify(payload)

    @app.get("/api/websites/<int:website_id>/changes")
    def website_changes(website_id: int):
        status = request.args.get("status")
        return jsonify(
            [dict(row) for row in database.website_changes(website_id, status)]
        )

    @app.get("/api/websites/<int:website_id>/checks")
    def website_checks(website_id: int):
        return jsonify([dict(row) for row in database.website_checks(website_id)])

    @app.patch("/api/websites/changes/<int:change_id>")
    def update_website_change(change_id: int):
        status = (request.json or {}).get("status", "processed")
        if status not in {"pending", "processed", "ignored"}:
            return jsonify(error="Invalid change status"), 400
        database.update_website_change(change_id, status)
        return jsonify(ok=True)

    @app.post("/api/websites/changes/<int:change_id>/extract")
    def extract_website_change(change_id: int):
        change = database.website_change(change_id)
        if not change:
            return jsonify(error="Change not found"), 404
        run_ids = _start_linked_pipelines(database, int(change["source_id"]), change_id)
        if not run_ids:
            return jsonify(error="No pipeline is linked to this website"), 400
        return jsonify(run_ids=run_ids), 202

    @app.get("/api/embeddings/config")
    def embedding_config():
        saved = database.get_setting("embedding_config") or {}
        config = {**embeddings.DEFAULT_CONFIG, **(saved if isinstance(saved, dict) else {})}
        return jsonify({**config, "catalog": embeddings.catalog()["providers"]})

    @app.post("/api/embeddings/config")
    def save_embedding_config():
        data = request.json or {}
        current = database.get_setting("embedding_config") or {}
        if not isinstance(current, dict):
            current = {}
        merged = {**embeddings.DEFAULT_CONFIG, **current, **data}
        database.set_setting("embedding_config", merged)
        return jsonify(merged)

    @app.get("/api/embeddings/models")
    def embedding_models():
        return jsonify(embeddings.catalog())

    @app.post("/api/embeddings/search")
    def embedding_search():
        data = request.json or {}
        saved = database.get_setting("embedding_config") or {}
        config = {**embeddings.DEFAULT_CONFIG, **(saved if isinstance(saved, dict) else {}), **(data.get("config") or {})}
        try:
            results = vector_search(
                database,
                str(data.get("query") or ""),
                config,
                data.get("api_key") or config.get("api_key") or "",
                data.get("top_k"),
                data.get("keywords") or "",
                data.get("source") or "",
                data.get("date_from") or "",
                data.get("date_to") or "",
            )
            slim = []
            for row in results:
                item = dict(row)
                item.pop("embedding", None)
                slim.append(item)
            return jsonify(results=slim)
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    @app.post("/api/embeddings/index")
    def embedding_index():
        data = request.json or {}
        text = str(data.get("text") or "")
        if not text or not data.get("document_id"):
            return jsonify(error="document_id and text are required"), 400
        try:
            count = index_document(
                database,
                str(data["document_id"]),
                text,
                data.get("metadata") or {},
                data.get("config") or {},
                data.get("api_key", ""),
            )
            return jsonify(chunks=count)
        except requests.RequestException as exc:
            return jsonify(error=f"Embedding request failed: {exc}"), 502
        except Exception as exc:
            return jsonify(error=str(exc)), 400



    @app.get("/api/exports")
    @app.post("/api/exports/csv")
    @app.post("/api/exports/parquet")
    @app.post("/api/exports/sqlite")
    def export_table():
        data = request.args if request.method == "GET" else (request.json or {})
        db, table, fmt = (
            data.get("db", ""),
            data.get("table", ""),
            data.get("format", "parquet"),
        )
        if request.path.startswith("/api/exports/"):
            fmt = request.path.rsplit("/", 1)[-1]
        if not db or not table:
            return jsonify(error="db and table are required"), 400
        destination = data.get("path") or str(
            Path.home() / "Downloads" / f"{table}.{fmt}"
        )
        try:
            return jsonify(
                duckstore.export_table(db, table, destination, fmt, data.get("sql"))
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    def _channel_dict(row) -> dict:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "slug": row["slug"],
            "name": row["name"],
            "database": row["database"],
            "table": row["table_name"],
            "sql": row["sql"],
            "mapping": json.loads(row["mapping"] or "{}"),
            "api_key": row["api_key"],
            "enabled": bool(row["enabled"]),
            "created_at": row["created_at"],
            "urls": {
                "rss": f"/p/{row['slug']}.xml",
                "json": f"/p/{row['slug']}.json",
            },
        }

    def _sync_dict(row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "kind": row["kind"],
            "database": row["database"],
            "table": row["table_name"],
            "sql": row["sql"],
            "dest": json.loads(row["dest"] or "{}"),
            "key_column": row["key_column"],
            "schedule": json.loads(row["schedule"] or "{}"),
            "enabled": bool(row["enabled"]),
            "last_run": row["last_run"],
            "created_at": row["created_at"],
        }

    @app.get("/api/publish")
    def list_publish():
        return jsonify([_channel_dict(row) for row in database.publish_channels()])

    @app.post("/api/publish")
    def save_publish():
        data = request.json or {}
        try:
            channel_id = database.save_publish_channel(data, data.get("id"))
            row = database.connection.execute(
                "SELECT * FROM publish_channels WHERE id=?", (channel_id,)
            ).fetchone()
            return jsonify(_channel_dict(row)), 201
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    @app.delete("/api/publish/<int:channel_id>")
    def delete_publish(channel_id: int):
        database.delete_publish_channel(channel_id)
        return ("", 204)

    @app.get("/api/sync-kinds")
    def list_sync_kinds():
        return jsonify(list(publish.SYNC_KINDS.values()))

    @app.get("/api/sync-targets")
    def list_sync_targets():
        return jsonify([_sync_dict(row) for row in database.sync_targets()])

    @app.post("/api/sync-targets")
    def save_sync_target():
        data = request.json or {}
        try:
            target_id = database.save_sync_target(data, data.get("id"))
            row = database.sync_target(target_id)
            return jsonify(_sync_dict(row)), 201
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    @app.post("/api/sync-targets/<int:target_id>/run")
    def run_sync_target(target_id: int):
        row = database.sync_target(target_id)
        if not row:
            return jsonify(error="Not found"), 404
        try:
            result = publish.run_sync_target(_sync_dict(row))
            database.set_sync_target_last_run(target_id, _iso_now())
            return jsonify(result)
        except Exception as exc:
            return jsonify(error=str(exc)), 400

    @app.delete("/api/sync-targets/<int:target_id>")
    def delete_sync_target(target_id: int):
        database.delete_sync_target(target_id)
        return ("", 204)

    @app.get("/p/<slug>.xml")
    @app.get("/p/<slug>.json")
    def public_publish(slug: str):
        row = database.publish_channel_by_slug(slug)
        if not row or not row["enabled"]:
            return jsonify(error="Not found"), 404
        kind = "rss" if request.path.endswith(".xml") else "json"
        if kind == "rss" and row["kind"] != "rss":
            return jsonify(error="Not found"), 404
        provided = request.headers.get("X-Publish-Key") or request.args.get("key")
        if not publish.check_publish_key(dict(row), provided):
            return jsonify(error="Invalid or missing publish key"), 401
        try:
            body, mime = publish.render_channel(
                _channel_dict(row), kind, request.host_url.rstrip("/")
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        return Response(body, mimetype=mime)



    @app.get("/api/pipelines")
    def list_pipelines():
        return jsonify(
            [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "definition": json.loads(row["definition"]),
                    "enabled": bool(row["enabled"]),
                }
                for row in database.pipelines()
            ]
        )

    @app.post("/api/pipelines")
    def create_pipeline():
        data = request.json or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify(error="Pipeline name is required"), 400
        definition = data.get("definition", {})
        definition = resolve_definition(database, definition)
        definition["schema"] = schema_from_fields(definition.get("fields", []))
        try:
            requested_id = data.get("id")
            existing_id = None
            if requested_id is not None:
                row = database.pipeline(int(requested_id))
                if row:
                    existing_id = int(row["id"])
            if existing_id is None:
                existing = database.pipeline_by_name(name)
                existing_id = existing["id"] if existing else None
            pipeline_id = database.save_pipeline(name, definition, existing_id)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        if definition.get("run_on_change"):
            _start_run(database, pipeline_id, definition, preview=False)
        return jsonify(id=pipeline_id), 201

    @app.delete("/api/pipelines/<int:pipeline_id>")
    def delete_pipeline(pipeline_id: int):
        database.delete_pipeline(pipeline_id)
        return ("", 204)

    @app.post("/api/pipelines/<int:pipeline_id>/run")
    def execute_pipeline(pipeline_id: int):
        row = database.pipeline(pipeline_id)
        if not row:
            return jsonify(error="Pipeline not found"), 404
        definition = json.loads(row["definition"])
        definition = resolve_definition(database, definition)
        preview = bool((request.json or {}).get("preview"))
        run_id = _start_run(database, pipeline_id, definition, preview)
        return jsonify(run_id=run_id, preview=preview), 202

    @app.get("/api/runs")
    def list_runs():
        pipeline_id = request.args.get("pipeline_id", type=int)
        status = request.args.get("status")
        limit = request.args.get("limit", 50, type=int)
        offset = request.args.get("offset", 0, type=int)
        rows = database.runs_filtered(pipeline_id, status, limit, offset)
        total = database.runs_count(pipeline_id, status)
        return jsonify(
            total=total,
            runs=[_run_summary(row, database) for row in rows],
        )

    @app.get("/api/runs/<int:run_id>")
    def run_detail(run_id: int):
        run = database.get_run(run_id)
        if not run:
            return jsonify(error="Run not found"), 404
        payload = dict(run)
        pipeline = database.pipeline(int(run["pipeline_id"]))
        payload["pipeline_name"] = pipeline["name"] if pipeline else f"Pipeline {run['pipeline_id']}"
        return jsonify(payload)

    @app.get("/api/runs/<int:run_id>/logs")
    def run_logs(run_id: int):
        run = database.get_run(run_id)
        if not run:
            return jsonify(error="Run not found"), 404
        return jsonify(
            {
                "run": dict(run),
                "logs": [dict(row) for row in database.run_logs(run_id)],
            }
        )

    @app.delete("/api/runs/<int:run_id>")
    def delete_run(run_id: int):
        database.delete_run(run_id)
        return ("", 204)

    @app.post("/api/runs/<int:run_id>/cancel")
    def cancel_run(run_id: int):
        run = database.get_run(run_id)
        if not run:
            return jsonify(error="Run not found"), 404
        request_cancel(run_id)
        database.update_run(
            run_id,
            last_message="Cancellation requested",
            phase="cancel",
        )
        return jsonify(ok=True)

    @app.post("/api/runs/<int:run_id>/retry-failed")
    def retry_failed(run_id: int):
        run = database.get_run(run_id)
        if not run:
            return jsonify(error="Run not found"), 404
        try:
            payload = json.loads(run["result"] or "{}")
        except Exception:
            payload = {}
        failed_titles = {
            _error_title(e) for e in payload.get("errors", []) if _error_title(e)
        }
        pipeline_id = run["pipeline_id"]
        row = database.pipeline(pipeline_id)
        if not row:
            return jsonify(error="Pipeline not found"), 404
        definition = json.loads(row["definition"])
        new_run_id = database.create_run(pipeline_id, preview=False)
        threading.Thread(
            target=run_pipeline_safe,
            args=(database, definition, False, new_run_id),
            kwargs={"only_titles": failed_titles},
            daemon=True,
        ).start()
        return jsonify(run_id=new_run_id), 202

    @app.get("/api/runs/<int:run_id>/download")
    def download_run(run_id: int):
        run = database.get_run(run_id)
        if not run:
            return jsonify(error="Run not found"), 404
        try:
            payload = json.loads(run["result"] or "{}")
        except Exception:
            payload = {}
        records = payload.get("records", [])
        fmt = (request.args.get("format") or "csv").lower()
        if fmt == "json":
            body = json.dumps(records, ensure_ascii=False, indent=2)
            resp = app.response_class(body, mimetype="application/json")
            resp.headers["Content-Disposition"] = (
                f"attachment; filename=run-{run_id}.json"
            )
            return resp
        if fmt == "jsonl":
            body = "\n".join(json.dumps(r, ensure_ascii=False) for r in records)
            resp = app.response_class(body, mimetype="application/x-ndjson")
            resp.headers["Content-Disposition"] = (
                f"attachment; filename=run-{run_id}.jsonl"
            )
            return resp
        import csv as _csv
        from io import StringIO

        buf = StringIO()
        fields = sorted({key for row in records for key in row})
        writer = _csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in records:
            writer.writerow({k: _flatten(row.get(k, "")) for k in fields})
        resp = app.response_class(buf.getvalue(), mimetype="text/csv")
        resp.headers["Content-Disposition"] = f"attachment; filename=run-{run_id}.csv"
        return resp

    @app.post("/api/pipelines/<int:pipeline_id>/retry")
    def retry_pipeline(pipeline_id: int):
        row = database.pipeline(pipeline_id)
        if not row:
            return jsonify(error="Pipeline not found"), 404
        definition = json.loads(row["definition"])
        run_id = _start_run(database, pipeline_id, definition, preview=False)
        return jsonify(run_id=run_id), 202

    @app.get("/api/snapshots")
    def list_snapshots():
        return jsonify(database.unified_snapshots())

    @app.get("/api/settings")
    def get_settings():
        return jsonify({
            "snapshot_retention": database.get_setting("snapshot_retention", 10),
            "default_llm_endpoint": database.get_setting("default_llm_endpoint", ""),
            "default_llm_model": database.get_setting("default_llm_model", ""),
        })

    @app.post("/api/settings")
    def save_settings():
        data = request.json or {}
        if "snapshot_retention" in data:
            try:
                val = int(data["snapshot_retention"])
                database.set_setting("snapshot_retention", max(1, val))
            except ValueError:
                pass
        if "default_llm_endpoint" in data:
            database.set_setting("default_llm_endpoint", str(data["default_llm_endpoint"]).strip())
        if "default_llm_model" in data:
            database.set_setting("default_llm_model", str(data["default_llm_model"]).strip())
        
        # Apply pruning immediately
        database.prune_snapshots("snapshot")
        database.prune_snapshots("website")
        database.prune_snapshots("api")
        return jsonify(ok=True)

    @app.post("/api/backup")
    def backup_data():
        try:
            path = create_backup(database)
        except Exception as exc:
            return jsonify(error=str(exc)), 500
        return send_from_directory(
            str(path.parent),
            path.name,
            as_attachment=True,
            download_name=path.name,
        )

    @app.post("/api/restore")
    def restore_data():
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return jsonify(error="Upload a .zip backup file"), 400
        data_dir = database.path.parent
        temp_path = data_dir / f"restore-upload-{int(time.time())}.zip"
        upload.save(temp_path)
        try:
            result = restore_backup(database, temp_path)
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        finally:
            if temp_path.exists():
                temp_path.unlink()
        return jsonify(result)

    @app.get("/api/snapshots/<int:snapshot_id>")
    def snapshot_detail(snapshot_id: int):
        snap = database.snapshot(snapshot_id)
        if not snap:
            return jsonify(error="Snapshot not found"), 404
        articles = database.snapshot_articles(snapshot_id)
        return jsonify(
            {
                "snapshot": dict(snap),
                "articles": [
                    {
                        "id": a["id"],
                        "title": a["title"],
                        "url": a["url"],
                        "source": a["source"],
                        "published": a["published"],
                        "text": a["text"],
                        "links": json.loads(a["links"]) if a["links"] else [],
                    }
                    for a in articles
                ],
            }
        )

    @app.post("/api/snapshots")
    def create_feed_snapshot():
        data = request.json or {}
        feed_ids = [int(x) for x in data.get("feed_ids", [])]
        folder_ids = [int(x) for x in data.get("folder_ids", [])]
        selected = []
        for folder in database.folders():
            if folder["id"] in folder_ids:
                selected.extend(database.feeds(folder["id"]))
            else:
                for feed in database.feeds(folder["id"]):
                    if feed["id"] in feed_ids:
                        selected.append(feed)
        if not selected:
            return jsonify(error="Select at least one feed or folder"), 400
        name = (data.get("name") or "").strip() or "Feed snapshot"
        snap_id = database.create_snapshot(
            name, "feed", ", ".join(f["title"] for f in selected)
        )
        saved = 0
        for feed in selected:
            try:
                result = fetch_feed(feed["url"])
            except Exception:
                continue
            for item in result["items"][: int(data.get("max_articles", 50))]:
                try:
                    article = extract_article(
                        {**item, "source": feed["title"]}, feed["title"]
                    )
                    database.add_snapshot_article(snap_id, article)
                    saved += 1
                except Exception:
                    pass
        return jsonify(id=snap_id, articles=saved), 201

    @app.post("/api/snapshots/article")
    def create_article_snapshot():
        data = request.json or {}
        if not data.get("text"):
            return jsonify(error="Article text is required"), 400
        name = (data.get("name") or data.get("title") or "Article snapshot").strip()
        snap_id = database.create_snapshot(name, "article", data.get("source", ""))
        database.add_snapshot_article(snap_id, data)
        return jsonify(id=snap_id), 201

    @app.patch("/api/snapshots/<int:snapshot_id>")
    def rename_snapshot(snapshot_id: int):
        name = (request.json or {}).get("name", "").strip()
        if not name:
            return jsonify(error="Snapshot name is required"), 400
        database.update_snapshot(snapshot_id, name)
        return jsonify(ok=True)

    @app.delete("/api/snapshots/<int:snapshot_id>")
    def delete_snapshot(snapshot_id: int):
        database.delete_snapshot(snapshot_id)
        return ("", 204)

    @app.get("/api/snapshot-schedules")
    def list_snapshot_schedules():
        return jsonify(
            [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "feed_ids": json.loads(r["feed_ids"]),
                    "folder_ids": json.loads(r["folder_ids"]),
                    "max_articles": r["max_articles"],
                    "dest": json.loads(r["dest"]) if r["dest"] else None,
                    "schedule": json.loads(r["schedule"]),
                    "enabled": bool(r["enabled"]),
                    "last_run": r["last_run"],
                    "created_at": r["created_at"],
                }
                for r in database.snapshot_schedules()
            ]
        )

    @app.post("/api/snapshot-schedules")
    def create_snapshot_schedule():
        data = request.json or {}
        name = (data.get("name") or "").strip() or "Scheduled capture"
        feed_ids = [int(x) for x in data.get("feed_ids", [])]
        folder_ids = [int(x) for x in data.get("folder_ids", [])]
        if not feed_ids and not folder_ids:
            return jsonify(error="Select at least one feed or folder"), 400
        sched = data.get("schedule") or {}
        definition = {
            "sources": [{"type": "feeds", "feed_ids": feed_ids}],
            "folder_ids": folder_ids,
            "feed_ids": feed_ids,
            "max_articles": int(data.get("max_articles", 50) or 50),
            "llm": {"enabled": False},
            "extraction_mode": "raw",
            "schedule": {"enabled": False, "kind": "interval", "minutes": 60},
            "snapshot": {
                "enabled": True,
                "kind": sched.get("kind") or "interval",
                "minutes": sched.get("minutes") or 60,
                "time": sched.get("time") or "09:00",
                "dest": data.get("dest"),
            },
            "output": {"type": "duckdb"},
        }
        pipeline_id = database.save_pipeline(name, definition)
        return jsonify(id=pipeline_id, migrated=True), 201

    @app.delete("/api/snapshot-schedules/<int:schedule_id>")
    def delete_snapshot_schedule(schedule_id: int):
        database.delete_snapshot_schedule(schedule_id)
        return ("", 204)

    @app.patch("/api/snapshots/article/<int:article_id>")
    def patch_snapshot_article(article_id: int):
        data = request.json or {}
        database.update_snapshot_article(
            article_id,
            starred=1 if data.get("starred") else 0,
            read=1 if data.get("read") else 0,
            tags=data.get("tags", ""),
        )
        return jsonify(ok=True)

    @app.get("/api/search")
    def search():
        q = (request.args.get("q") or "").strip()
        if not q:
            return jsonify(results=[])
        rows = database.search_snapshot_articles(
            q, limit=request.args.get("limit", 50, type=int)
        )
        return jsonify(results=[dict(row) for row in rows])

    @app.get("/api/opml")
    def export_opml():
        folders = database.folders()
        body = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<opml version="2.0">',
            "<head><title>Autofeeder</title></head>",
            "<body>",
        ]
        for folder in folders:
            body.append(
                f'  <outline text="{_xml(folder["name"])}" title="{_xml(folder["name"])}">'
            )
            for feed in database.feeds(folder["id"]):
                body.append(
                    f'    <outline type="rss" text="{_xml(feed["title"])}" title="{_xml(feed["title"])}" xmlUrl="{_xml(feed["url"])}" htmlUrl="{_xml(feed["site_url"])}"/>'
                )
            body.append("  </outline>")
        body.append("</body></opml>")
        resp = app.response_class("\n".join(body), mimetype="text/x-opml")
        resp.headers["Content-Disposition"] = "attachment; filename=autofeedly.opml"
        return resp

    @app.post("/api/opml")
    def import_opml():
        data = request.json or {}
        content = data.get("opml") or ""
        if not content:
            return jsonify(error="OPML content is required"), 400
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            return jsonify(error=f"Invalid OPML: {exc}"), 400
        folder_name = (data.get("folder") or "Imported OPML").strip() or "Imported OPML"
        folder_id = database.add_folder(folder_name)
        added = 0
        for outline in root.iter("outline"):
            xml_url = outline.get("xmlUrl")
            if not xml_url:
                continue
            title = outline.get("title") or outline.get("text") or xml_url
            try:
                info = fetch_feed(xml_url)
                database.add_feed(
                    folder_id, info["title"] or title, xml_url, info.get("site_url", "")
                )
                added += 1
            except Exception:
                database.add_feed(folder_id, title, xml_url, "")
                added += 1
        return jsonify(folder_id=folder_id, added=added), 201

    # ----- Reusable API configurations -----
    @app.get("/api/api-configs")
    def list_api_configs():
        return jsonify([dict(row) for row in database.api_configs()])

    @app.post("/api/api-configs")
    def add_api_config():
        data = request.json or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify(error="Name is required"), 400
        config_id = database.save_api_config(
            name,
            data.get("provider", "custom"),
            data.get("endpoint", ""),
            data.get("model", ""),
            data.get("temperature"),
            int(data.get("timeout", 60) or 60),
            data.get("extra"),
        )
        return jsonify(id=config_id), 201

    @app.delete("/api/api-configs/<int:config_id>")
    def remove_api_config(config_id: int):
        database.delete_api_config(config_id)
        return ("", 204)

    # ----- Prompt templates -----
    @app.get("/api/prompts")
    def list_prompts():
        return jsonify([dict(row) for row in database.prompt_templates()])

    @app.post("/api/prompts")
    def add_prompt():
        data = request.json or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify(error="Name is required"), 400
        prompt_id = database.save_prompt_template(
            name,
            data.get("system_prompt", ""),
            data.get("extraction_prompt", ""),
            data.get("variables"),
            data.get("schema_id"),
        )
        return jsonify(id=prompt_id), 201

    @app.delete("/api/prompts/<int:prompt_id>")
    def remove_prompt(prompt_id: int):
        database.delete_prompt_template(prompt_id)
        return ("", 204)

    # ----- Schemas -----
    @app.get("/api/schemas")
    def list_schemas():
        return jsonify([dict(row) for row in database.schemas()])

    @app.post("/api/schemas")
    def add_schema():
        data = request.json or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify(error="Name is required"), 400
        schema_id = database.save_schema(
            name,
            data.get("json_schema"),
            data.get("fields"),
        )
        return jsonify(id=schema_id), 201

    @app.delete("/api/schemas/<int:schema_id>")
    def remove_schema(schema_id: int):
        database.delete_schema(schema_id)
        return ("", 204)

    # ----- Keywords API -----
    @app.get("/api/keywords")
    def list_keywords():
        return jsonify([dict(row) for row in database.keywords()])

    @app.post("/api/keywords")
    def add_keyword():
        data = request.json or {}
        word = (data.get("word") or "").strip()
        if not word:
            return jsonify(error="Word is required"), 400
        try:
            kw_id = database.add_keyword(word, data.get("category", "general"))
            return jsonify(id=kw_id), 201
        except Exception as exc:  # noqa: BLE001
            return jsonify(
                error="Keyword already exists or error occurred: " + str(exc)
            ), 400

    @app.delete("/api/keywords/<int:keyword_id>")
    def remove_keyword(keyword_id: int):
        database.delete_keyword(keyword_id)
        return ("", 204)



    # ----- DuckDB databases -----
    @app.get("/api/duckdb/databases")
    def list_duckdb_databases():
        duckstore.discover_and_register(database)
        payload = []
        for row in database.duckdb_databases():
            item = dict(row)
            try:
                item["stats"] = duckstore.database_info(row["path"])
            except Exception:  # noqa: BLE001
                item["stats"] = None
            payload.append(item)
        return jsonify(payload)

    @app.get("/api/duckdb/databases/<int:db_id>")
    def duckdb_database_detail(db_id: int):
        row = next(
            (item for item in database.duckdb_databases() if int(item["id"]) == db_id),
            None,
        )
        if not row:
            return jsonify(error="Database not found"), 404
        item = dict(row)
        try:
            item["stats"] = duckstore.database_info(row["path"])
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        database.touch_duckdb_database(db_id)
        return jsonify(item)

    @app.post("/api/duckdb/databases")
    def add_duckdb_database():
        data = request.json or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify(error="Name is required"), 400
        path = (data.get("path") or "").strip() or f"{name}.duckdb"
        db_id = database.save_duckdb_database(name, path, data.get("description", ""))
        return jsonify(id=db_id), 201

    @app.delete("/api/duckdb/databases/<int:db_id>")
    def remove_duckdb_database(db_id: int):
        database.delete_duckdb_database(db_id)
        return ("", 204)

    @app.patch("/api/duckdb/databases/<int:db_id>")
    def rename_duckdb_database(db_id: int):
        data = request.json or {}
        name = (data.get("name") or "").strip()
        path = (data.get("path") or "").strip()
        description = data.get("description")
        try:
            database.update_duckdb_database(
                db_id, name or None, path or None, description
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(ok=True)

    @app.get("/api/duckdb/tables")
    def duckdb_tables():
        db = request.args.get("db") or ""
        try:
            tables = duckstore.list_tables(db)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        database.touch_duckdb_database_by_path(db)
        return jsonify(tables=tables)

    @app.get("/api/duckdb/schema")
    def duckdb_table_schema():
        db = request.args.get("db") or ""
        table = request.args.get("table") or ""
        try:
            schema = duckstore.table_schema(db, table)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(schema=schema)

    @app.get("/api/duckdb/preview")
    def duckdb_table_preview():
        db = request.args.get("db") or ""
        table = request.args.get("table") or ""
        limit = request.args.get("limit", 100, type=int)
        offset = request.args.get("offset", 0, type=int)
        try:
            result = duckstore.table_preview(db, table, limit, offset)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        database.touch_duckdb_database_by_path(db)
        return jsonify(result)

    @app.get("/api/duckdb/info")
    def duckdb_database_info():
        db = request.args.get("db") or ""
        if not db:
            return jsonify(error="db is required"), 400
        try:
            info = duckstore.database_info(db)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        database.touch_duckdb_database_by_path(db)
        return jsonify(info)

    @app.post("/api/duckdb/search")
    def duckdb_search():
        data = request.json or {}
        db = data.get("db") or ""
        databases = data.get("databases") or ([db] if db else [])
        databases = [str(item).strip() for item in databases if str(item).strip()]
        if not databases:
            return jsonify(error="At least one database is required"), 400
        try:
            results = duckstore.search_duckdb_records(
                databases,
                str(data.get("query") or ""),
                str(data.get("keywords") or ""),
                data.get("table") or data.get("table_name"),
                data.get("column_filters"),
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(results=results, count=len(results))

    @app.post("/api/duckdb/query")
    def duckdb_query():
        data = request.json or {}
        db = data.get("db") or ""
        sql = (data.get("sql") or "").strip()
        if not sql:
            return jsonify(error="SQL is required"), 400
        readonly = bool(data.get("readonly", True))
        if readonly and not _is_readonly_sql(sql):
            return jsonify(error="Only read-only queries are allowed in read mode"), 400
        try:
            result = duckstore.query(
                db, sql, readonly=readonly, timeout=int(data.get("timeout", 30) or 30)
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        database.touch_duckdb_database_by_path(db)
        return jsonify(result)

    @app.post("/api/duckdb/import")
    def duckdb_import_file():
        data = request.json or {}
        db = data.get("db") or ""
        table = (data.get("table") or "").strip()
        file_path = (data.get("path") or "").strip()
        if not db or not table or not file_path:
            return jsonify(error="db, table and path are required"), 400
        try:
            result = duckstore.import_file(db, table, file_path)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(result), 201

    @app.post("/api/duckdb/create-table")
    def duckdb_create_table():
        data = request.json or {}
        db = (data.get("database") or "").strip()
        table = (data.get("table") or "").strip()
        columns = data.get("columns") or []
        if not db or not table:
            return jsonify(error="database and table are required"), 400
        if not isinstance(columns, list) or not columns:
            return jsonify(error="at least one column is required"), 400
        try:
            result = duckstore.create_table(
                db,
                table,
                columns,
                include_meta=bool(data.get("include_meta")),
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(result), 201

    @app.delete("/api/duckdb/tables")
    def drop_duckdb_table():
        data = request.json or {}
        db = (data.get("db") or "").strip()
        table = (data.get("table") or "").strip()
        if not db or not table:
            return jsonify(error="db and table are required"), 400
        try:
            result = duckstore.drop_table(db, table)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(result), 200

    @app.post("/api/duckdb/rename-table")
    def rename_duckdb_table():
        data = request.json or {}
        db = (data.get("db") or "").strip()
        table = (data.get("table") or "").strip()
        new_name = (data.get("new_name") or "").strip()
        if not db or not table or not new_name:
            return jsonify(error="db, table and new_name are required"), 400
        try:
            result = duckstore.rename_table(db, table, new_name)
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(result), 200

    # ----- Extractions persisted in DuckDB -----
    @app.get("/api/extractions")
    def list_extractions():
        db = request.args.get("db") or ""
        table = request.args.get("table") or "extractions"
        try:
            result = duckstore.table_preview(
                db, table, request.args.get("limit", 100, type=int)
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(result)

    @app.post("/api/extractions")
    def persist_extractions():
        data = request.json or {}
        db = data.get("db") or ""
        table = (data.get("table") or "extractions").strip()
        records = data.get("records") or []
        if not db or not records:
            return jsonify(error="db and records are required"), 400
        try:
            out = duckstore.write_records(
                db,
                table,
                records,
                mappings=data.get("mappings"),
                mode=data.get("mode", "append"),
                dedupe_key=data.get("dedupe_key"),
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify(error=str(exc)), 400
        return jsonify(out), 201

    # ----- Snapshot capture with optional DuckDB storage -----
    @app.post("/api/snapshots/capture")
    def capture_snapshot():
        data = request.json or {}
        feed_ids = [int(x) for x in data.get("feed_ids", [])]
        folder_ids = [int(x) for x in data.get("folder_ids", [])]
        website_ids = [int(x) for x in data.get("website_ids", [])]
        if not feed_ids and not folder_ids and not website_ids:
            return jsonify(error="Select at least one feed, folder, or website"), 400
        name = (data.get("name") or "").strip() or "Snapshot"
        dest = data.get("dest")

        feed_result = None
        if feed_ids or folder_ids:
            feed_result = _capture_feed_snapshot(
                database,
                name if not website_ids else f"{name} (feeds)",
                feed_ids,
                folder_ids,
                int(data.get("max_articles", 50) or 50),
                dest,
            )

        web_result = None
        if website_ids:
            web_result = _capture_website_snapshot(
                database,
                name if not feed_ids and not folder_ids else f"{name} (websites)",
                website_ids,
                dest,
            )

        # Merge results
        combined = {
            "id": (feed_result or web_result or {}).get("id"),
            "articles": (feed_result or {}).get("articles", 0)
            + (web_result or {}).get("articles", 0),
            "duckdb": (feed_result or web_result or {}).get("duckdb"),
            "feed_snapshot_id": (feed_result or {}).get("id"),
            "website_snapshot_id": (web_result or {}).get("id"),
        }
        return jsonify(combined), 201

    @app.get("/<path:path>")
    def spa_catchall(path: str):
        if path.startswith("api/"):
            return ("", 404)
        if dist_dir.is_dir():
            candidate = dist_dir / path
            if candidate.is_file():
                return send_from_directory(str(dist_dir), path)
            return send_from_directory(str(dist_dir), "index.html")
        return ("", 404)

    _start_scheduler(database)
    threading.Thread(target=catalog.warm_catalog_cache, daemon=True).start()
    return app


def _xml(value: object) -> str:
    text = "" if value is None else str(value)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _is_readonly_sql(sql: str) -> bool:
    stripped = sql.strip().rstrip(";").strip()
    lowered = stripped.lower()
    if lowered.startswith(
        ("select", "with", "explain", "describe", "show", "summarize", "pragma")
    ):
        return True
    return False


def _scheduler_due(sched: dict, last: object) -> bool:
    if not sched.get("enabled"):
        return False
    kind = sched.get("kind", "interval")
    now = datetime.now()
    if last:
        try:
            last_dt = datetime.fromisoformat(str(last))
        except Exception:
            last_dt = None
    else:
        last_dt = None
    if kind == "interval":
        minutes = int(sched.get("minutes", 0) or 0)
        if minutes <= 0:
            return False
        if last_dt is None:
            return True
        return (now - last_dt).total_seconds() >= minutes * 60
    if kind == "daily":
        time_str = sched.get("time", "09:00")
        try:
            hh, mm = (int(x) for x in time_str.split(":"))
        except Exception:
            hh, mm = 9, 0
        today = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if last_dt is None:
            return now >= today
        return now >= today and last_dt.date() < now.date()
    return False


def _start_scheduler(database: Database) -> None:
    def loop() -> None:
        while True:
            time.sleep(30)
            try:
                # Website monitors own polling; linked pipelines consume pending changes.
                for website in database.websites():
                    if not website_is_due(website):
                        continue
                    result = check_website_monitor(
                        database, int(website["id"]), blocking=False
                    )
                    if result.get("changed") and result.get("change_id"):
                        _start_linked_pipelines(
                            database, int(website["id"]), int(result["change_id"])
                        )
                for row in database.pipelines():
                    if not row["enabled"]:
                        continue
                    definition = json.loads(row["definition"])
                    sched = definition.get("schedule") or {}
                    if _scheduler_due(sched, row["last_scheduled_run"]):
                        run_id = database.create_run(row["id"], preview=False)
                        threading.Thread(
                            target=run_pipeline_safe,
                            args=(database, definition, False, run_id),
                            daemon=True,
                        ).start()
                        database.set_pipeline_last_scheduled(row["id"], _iso_now())
                    snap = definition.get("snapshot") or {}
                    if _scheduler_due(snap, row["last_snapshot_run"]):
                        try:
                            feed_ids, folder_ids = _feed_scope_from_definition(definition)
                            _capture_feed_snapshot(
                                database,
                                f"Scheduled {row['name']}",
                                feed_ids,
                                folder_ids,
                                int(definition.get("max_articles", 50) or 50),
                                snap.get("dest"),
                            )
                            database.set_pipeline_last_snapshot(row["id"], _iso_now())
                        except Exception:
                            pass
                for trow in database.sync_targets():
                    sched = json.loads(trow["schedule"] or "{}")
                    if not trow["enabled"] or not _scheduler_due(sched, trow["last_run"]):
                        continue
                    try:
                        publish.run_sync_target(
                            {
                                "kind": trow["kind"],
                                "database": trow["database"],
                                "table": trow["table_name"],
                                "sql": trow["sql"],
                                "dest": json.loads(trow["dest"] or "{}"),
                                "key_column": trow["key_column"],
                            }
                        )
                        database.set_sync_target_last_run(trow["id"], _iso_now())
                    except Exception:
                        pass
            except Exception:
                continue

    threading.Thread(target=loop, daemon=True).start()


def _capture_feed_snapshot(
    database: Database,
    name: str,
    feed_ids: list[int],
    folder_ids: list[int],
    max_articles: int = 50,
    dest: dict | None = None,
) -> dict:
    selected = []
    for folder in database.folders():
        if int(folder["id"]) in [int(x) for x in folder_ids]:
            selected.extend(database.feeds(folder["id"]))
        else:
            for feed in database.feeds(folder["id"]):
                if int(feed["id"]) in [int(x) for x in feed_ids]:
                    selected.append(feed)
    snap_id = database.create_snapshot(
        name, "feed", ", ".join(f["title"] for f in selected)
    )
    saved = 0
    records = []
    for feed in selected:
        try:
            result = fetch_feed(feed["url"])
        except Exception:
            continue
        for item in result["items"][:max_articles]:
            try:
                article = extract_article(
                    {**item, "source": feed["title"]}, feed["title"]
                )
                database.add_snapshot_article(snap_id, article)
                records.append(
                    {
                        **item,
                        "source": feed["title"],
                        "feed_url": feed["url"],
                        "text": article.get("text", ""),
                        "_meta": {
                            "url": item.get("url"),
                            "feed_url": feed["url"],
                            "author": item.get("author"),
                            "published": item.get("published"),
                            "categories": item.get("categories"),
                            "snapshot_id": str(snap_id),
                        },
                    }
                )
                saved += 1
            except Exception:
                pass
    out = None
    if dest and dest.get("database"):
        db_path = dest["database"]
        try:
            from .duckstore import _resolve_path

            # Normalize paths to resolve matching DBs correctly
            abs_path = str(_resolve_path(db_path))
            existing_abs = [
                str(_resolve_path(row["path"])) for row in database.duckdb_databases()
            ]
            if abs_path not in existing_abs:
                db_name = Path(db_path).stem.replace("_", " ").title() or "Snapshots"
                database.save_duckdb_database(
                    db_name,
                    db_path,
                    "Automatically registered snapshot database",
                )

            out = duckstore.write_records(
                db_path,
                dest.get("table", "snapshot_articles"),
                records,
                mappings=dest.get("mappings"),
                mode=dest.get("mode", "append"),
                dedupe_key=dest.get("dedupe_key", "url"),
            )
        except Exception as exc:  # noqa: BLE001
            out = {"error": str(exc)}
    return {"id": snap_id, "articles": saved, "duckdb": out}


def _capture_website_snapshot(
    database: Database,
    name: str,
    website_ids: list[int],
    dest: dict | None = None,
) -> dict:
    """Capture a snapshot of one or more website pages into the unified snapshot system."""
    selected = []
    for wid in website_ids:
        site = database.website(wid)
        if site:
            selected.append(site)
    if not selected:
        return {"id": None, "articles": 0, "duckdb": None}

    snap_id = database.create_snapshot(
        name, "website", ", ".join(s["name"] for s in selected)
    )
    saved = 0
    records = []
    for site in selected:
        try:
            current = fetch_website(site["url"], site["fetch_method"])
            text = current["text"]
            # Also store in the website_snapshots table for change tracking
            previous = database.latest_website_snapshot(site["id"])
            changed = not previous or previous["content_hash"] != current["hash"]
            database.add_website_snapshot(
                site["id"],
                current["hash"],
                current["html"],
                text,
                previous["id"] if previous else None,
                changed,
            )
            # Store as a snapshot article in the unified system
            article = {
                "title": site["name"],
                "url": site["url"],
                "source": site["name"],
                "published": "",
                "author": "",
                "text": text,
                "links": "[]",
            }
            database.add_snapshot_article(snap_id, article)
            records.append(
                {
                    "title": site["name"],
                    "url": site["url"],
                    "source": site["name"],
                    "text": text,
                    "content_hash": current["hash"],
                    "changed": changed,
                    "_meta": {
                        "url": site["url"],
                        "snapshot_id": str(snap_id),
                        "website_id": str(site["id"]),
                    },
                }
            )
            saved += 1
        except Exception:
            pass

    out = None
    if dest and dest.get("database"):
        db_path = dest["database"]
        try:
            from .duckstore import _resolve_path

            abs_path = str(_resolve_path(db_path))
            existing_abs = [
                str(_resolve_path(row["path"])) for row in database.duckdb_databases()
            ]
            if abs_path not in existing_abs:
                db_name = Path(db_path).stem.replace("_", " ").title() or "Snapshots"
                database.save_duckdb_database(
                    db_name,
                    db_path,
                    "Automatically registered snapshot database",
                )

            out = duckstore.write_records(
                db_path,
                dest.get("table", "website_snapshots"),
                records,
                mappings=dest.get("mappings"),
                mode=dest.get("mode", "append"),
                dedupe_key=dest.get("dedupe_key", "url"),
            )
        except Exception as exc:  # noqa: BLE001
            out = {"error": str(exc)}
    return {"id": snap_id, "articles": saved, "duckdb": out}


def _pid_file() -> Path:
    from .database import data_directory

    return data_directory() / "web.pid"


def _spawn_daemon(host: str, port: int) -> None:
    from .fetchers import sanitize_playwright_env

    log = open("/tmp/rss-server.log", "a", buffering=1)
    env = sanitize_playwright_env(os.environ.copy())
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "rss_reader.web",
            "--host",
            host,
            "--port",
            str(port),
            "--no-browser",
        ],
        stdout=log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
        env=env,
    )
    print(f"Started Autofeeder in the background (pid {proc.pid})")
    print(f"Open http://{host}:{port}/discover")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Autofeeder web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--no-browser", action="store_true", help="Do not open a browser window"
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Start in the background and keep serving after the terminal closes",
    )
    args = parser.parse_args()
    if args.daemon:
        _spawn_daemon(args.host, args.port)
        return
    app = create_app()
    pid_path = _pid_file()
    pid_path.write_text(str(os.getpid()), encoding="utf-8")
    if not args.no_browser:
        threading.Timer(
            0.8, webbrowser.open, args=(f"http://{args.host}:{args.port}",)
        ).start()
    try:
        app.run(host=args.host, port=args.port, debug=False, threaded=True, use_reloader=False)
    finally:
        try:
            if pid_path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                pid_path.unlink(missing_ok=True)
        except OSError:
            pass


if __name__ == "__main__":
    main()
