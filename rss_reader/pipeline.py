from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from jsonschema import validate

from .database import Database, data_directory
from .extractor import extract_article
from .feeds import fetch_feed
from .llm import extract_json
from .vectorstore import index_document
from .website import changed_excerpt, check_website_monitor
from .json_mapping import map_records

# In-memory cancellation flags keyed by run id.
_CANCEL: dict[int, bool] = {}
_CANCEL_LOCK = threading.Lock()


def request_cancel(run_id: int) -> None:
    with _CANCEL_LOCK:
        _CANCEL[run_id] = True


def is_cancelled(run_id: int | None) -> bool:
    if run_id is None:
        return False
    with _CANCEL_LOCK:
        return bool(_CANCEL.get(run_id))


def clear_cancel(run_id: int) -> None:
    with _CANCEL_LOCK:
        _CANCEL.pop(run_id, None)


def _error_item(title: str, error: str) -> dict[str, str]:
    return {"title": title, "error": error}


def resolve_keywords(step_config: dict[str, Any], database: Database | None = None) -> list[str]:
    found: list[str] = []
    for raw in step_config.get("keywords") or []:
        word = str(raw).strip().lower()
        if word:
            found.append(word)
    raw_kws = step_config.get("keywords_str") or ""
    if isinstance(raw_kws, str) and raw_kws.strip():
        found.extend(k.strip().lower() for k in raw_kws.split(",") if k.strip())
    if database is not None and step_config.get("use_saved_keywords"):
        try:
            found.extend(str(row["word"]).strip().lower() for row in database.keywords() if row["word"])
        except Exception:
            pass
    seen: set[str] = set()
    out: list[str] = []
    for word in found:
        if word not in seen:
            seen.add(word)
            out.append(word)
    return out


def item_matches_keywords(item: dict[str, Any], keywords: list[str], match_all: bool = False) -> bool:
    if not keywords:
        return True
    text = (item.get("text") or "").lower()
    title = (item.get("title") or "").lower()
    haystack = f"{title}\n{text}"
    hits = [kw in haystack for kw in keywords]
    return all(hits) if match_all else any(hits)


def parent_key(item: dict[str, Any]) -> str:
    meta = item.get("_meta") or {}
    return str(
        meta.get("parent_url")
        or meta.get("article_url")
        or item.get("url")
        or meta.get("parent_title")
        or "unknown"
    )


def should_refetch_article(item: dict[str, Any], step_config: dict[str, Any]) -> bool:
    if item.get("_mapped_record"):
        return False
    role = str(step_config.get("role") or "")
    if role == "fetch":
        return True
    source_type = item.get("_source_type") or (item.get("_meta") or {}).get("source_type")
    if source_type == "chunk" or role == "chunk":
        return False
    if (item.get("_meta") or {}).get("fetch_backend"):
        return False
    return True


def _first_error_message(errors: list) -> str:
    if not errors:
        return ""
    item = errors[0]
    if isinstance(item, dict):
        return str(item.get("error") or "")
    if isinstance(item, (list, tuple)) and len(item) >= 2:
        return str(item[1])
    return str(item)


def _mark_website_changes_processed(database: Database, records: list, run_id: int | None) -> None:
    seen: set[int] = set()
    for record in records:
        change_id = record.get("_change_id") or record.get("_meta", {}).get("change_id")
        if not change_id:
            continue
        cid = int(change_id)
        if cid in seen:
            continue
        seen.add(cid)
        database.update_website_change(cid, "processed", run_id)


def with_retry(fn, retries: int):
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < retries:
                time.sleep(min(8.0, 1.0 * (2**attempt)))
    assert last is not None
    raise last


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _parse_published(value: object) -> datetime | None:
    if not value:
        return None
    text = str(value)
    try:
        parsed = parsedate_to_datetime(text)
        if parsed:
            return parsed
    except Exception:
        pass
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except Exception:
            pass
    try:
        from dateutil.parser import parse as dateutil_parse

        return dateutil_parse(text)
    except Exception:
        return None


def _in_date_range(published: object, filt: dict | None) -> bool:
    if not filt or not filt.get("enabled"):
        return True
    frm = filt.get("from")
    to = filt.get("to")
    if not frm and not to:
        return True
    dt = _parse_published(published)
    if dt is None:
        return True
    day = dt.date()
    if frm:
        try:
            if day < datetime.strptime(frm, "%Y-%m-%d").date():
                return False
        except Exception:
            pass
    if to:
        try:
            if day > datetime.strptime(to, "%Y-%m-%d").date():
                return False
        except Exception:
            pass
    return True


def schema_from_fields(fields: list[dict[str, Any]]) -> dict:
    properties = {}
    required = []
    for field in fields:
        name = field.get("name", "").strip()
        if not name:
            continue
        properties[name] = {
            "type": field.get("type", "string"),
            "description": field.get("description", ""),
        }
        if field.get("required"):
            required.append(name)
    result = {"type": "object", "properties": properties}
    if required:
        result["required"] = required
    return result


def _flatten(value: object) -> object:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _duck_type(ftype: str) -> str:
    name = (ftype or "string").lower()
    mapping = {
        "number": "DOUBLE",
        "float": "DOUBLE",
        "double": "DOUBLE",
        "decimal": "DOUBLE",
        "integer": "BIGINT",
        "int": "BIGINT",
        "long": "BIGINT",
        "boolean": "BOOLEAN",
        "bool": "BOOLEAN",
        "date": "DATE",
        "timestamp": "TIMESTAMP",
        "datetime": "TIMESTAMP",
        "time": "TIME",
        "array": "JSON",
        "object": "JSON",
        "json": "JSON",
    }
    return mapping.get(name, "VARCHAR")


def _norm_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def resolve_definition(database: Database, definition: dict) -> dict:
    """Make a selected schema authoritative by resolving its fields into the definition."""
    definition = dict(definition or {})
    schema_id = definition.get("schema_id")
    if not schema_id:
        return definition
    row = next((s for s in database.schemas() if s["id"] == int(schema_id)), None)
    if not row:
        return definition
    try:
        fields = json.loads(row["fields"] or "[]")
    except (TypeError, ValueError):
        fields = []
    if fields and not definition.get("fields"):
        definition["fields"] = fields
    if fields and not definition.get("schema"):
        definition["schema"] = schema_from_fields(fields)
    output = definition.get("output") or {}
    if output.get("type") == "duckdb" and not output.get("mappings"):
        output["mappings"] = [
            {
                "source": f.get("name", ""),
                "target": f.get("name", ""),
                "type": _duck_type(f.get("type", "string")),
            }
            for f in fields
            if f.get("name")
        ]
        definition["output"] = output
    return definition


def follow_on_destinations(database: Database, definition: dict, output_info: dict | None) -> dict:
    """After DuckDB write, attach live publish URLs and run selected upsert syncs."""
    info = dict(output_info or {})
    dest = definition.get("output") or {}
    db_path = dest.get("database") or info.get("path") or info.get("database")
    if dest.get("type", "duckdb") == "duckdb" and db_path:
        try:
            from . import duckstore

            duckstore.ensure_registered(database, str(db_path))
        except Exception:
            pass
    from . import publish

    publish_out: list[dict] = []
    for cid in dest.get("publish_channel_ids") or []:
        try:
            row = database.connection.execute(
                "SELECT * FROM publish_channels WHERE id=?", (int(cid),)
            ).fetchone()
        except (TypeError, ValueError):
            continue
        if not row:
            continue
        slug = row["slug"]
        publish_out.append(
            {
                "id": row["id"],
                "kind": row["kind"],
                "name": row["name"],
                "slug": slug,
                "urls": {"rss": f"/p/{slug}.xml", "json": f"/p/{slug}.json"},
            }
        )
    sync_out: list[dict] = []
    for tid in dest.get("sync_target_ids") or []:
        try:
            row = database.sync_target(int(tid))
        except (TypeError, ValueError):
            continue
        if not row:
            continue
        target = {
            "id": row["id"],
            "kind": row["kind"],
            "database": row["database"],
            "table": row["table_name"],
            "sql": row["sql"],
            "dest": json.loads(row["dest"] or "{}"),
            "key_column": row["key_column"],
        }
        try:
            result = publish.run_sync_target(target)
            database.set_sync_target_last_run(int(tid), _now())
            sync_out.append({"id": int(tid), "ok": True, **result})
        except Exception as exc:
            sync_out.append({"id": int(tid), "ok": False, "error": str(exc)})
    if publish_out:
        info["publish"] = publish_out
    if sync_out:
        info["sync"] = sync_out
    return info


def write_outputs(records: list[dict], output: dict, schema: dict) -> dict:
    kind = output.get("type", "csv")
    if kind == "duckdb":
        from . import duckstore

        mappings = output.get("mappings")
        if not mappings:
            all_keys = set()
            for r in records:
                all_keys.update(k for k in r.keys() if not k.startswith("_"))
            mappings = [
                {"source": k, "target": k, "type": "VARCHAR"}
                for k in sorted(all_keys)
            ]
            output = dict(output)
            output["mappings"] = mappings

        db_path = output.get("database") or str(
            data_directory() / "pipeline-output.duckdb"
        )
        return duckstore.write_records(
            database=db_path,
            table=output.get("table", "extracted_records"),
            records=records,
            mappings=mappings,
            mode=output.get("mode", "append"),
            dedupe_key=output.get("dedupe_key"),
        )
    if kind == "csv":
        path = Path(
            output.get("path") or data_directory() / "pipeline-output.csv"
        ).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        fields = list(schema.get("properties", {}).keys()) or sorted(
            {key for row in records for key in row}
        )
        tmp = path.with_suffix(path.suffix + ".tmp")
        mode = "a" if output.get("mode") == "append" and path.exists() else "w"
        with tmp.open(mode, newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
            if mode == "w":
                writer.writeheader()
            writer.writerows(
                {key: _flatten(row.get(key, "")) for key in fields} for row in records
            )
        os.replace(tmp, path)
        return {"type": "csv", "path": str(path), "records": len(records)}
    path = Path(
        output.get("path") or data_directory() / "pipeline-output.sqlite3"
    ).expanduser()
    table = output.get("table", "extracted_records")
    connection = sqlite3.connect(path)
    fields = list(schema.get("properties", {}).keys()) or sorted(
        {key for row in records for key in row}
    )
    columns = ", ".join(f'"{field}" TEXT' for field in fields)
    connection.execute(
        f'CREATE TABLE IF NOT EXISTS "{table}" (id INTEGER PRIMARY KEY, {columns})'
    )
    for row in records:
        names = ", ".join(f'"{field}"' for field in fields)
        marks = ", ".join("?" for _ in fields)
        connection.execute(
            f'INSERT INTO "{table}" ({names}) VALUES ({marks})',
            tuple(str(_flatten(row.get(field, ""))) for field in fields),
        )
    connection.commit()
    connection.close()
    return {
        "type": "sqlite",
        "path": str(path),
        "table": table,
        "records": len(records),
    }


def run_pipeline(
    database: Database,
    definition: dict,
    preview: bool = False,
    run_id: int | None = None,
    only_titles: set[str] | None = None,
) -> dict:
    definition = resolve_definition(database, definition)
    fields = definition.get("fields") or []
    schema = definition.get("schema") or schema_from_fields(fields)
    retries = int(definition.get("retries", 0) or 0)
    concurrency = max(1, int(definition.get("concurrency", 1) or 1))
    timeout = float(definition.get("timeout", 60) or 60)
    dedup = bool(definition.get("dedup", True))
    llm = definition.get("llm", {})
    prompt = definition.get("prompt", "")
    use_browser = bool(definition.get("use_browser", True))
    fetch_source = definition.get("fetch_source", "builtin")
    firecrawl_api_key = definition.get("firecrawl_api_key")
    firecrawl_base_url = definition.get(
        "firecrawl_base_url", "https://api.firecrawl.dev"
    )
    pipeline_id = None
    if run_id is not None:
        run_row = database.get_run(run_id)
        pipeline_id = run_row["pipeline_id"] if run_row else None

    def log(
        step: str, message: str, level: str = "info", article_title: str = ""
    ) -> None:
        if run_id is not None:
            database.append_run_log(run_id, step, message, level, article_title)
            database.update_run(run_id, last_message=message, phase=step)

    if run_id is not None:
        clear_cancel(run_id)
        database.update_run(run_id, status="running", started_at=_now())

    sources = definition.get("sources")
    if not sources:
        src = definition.get("source") or {
            "type": "feeds",
            "feed_ids": definition.get("feed_ids", []),
        }
        sources = [src]

    log("fetch", "Collecting articles for the pipeline source(s)")
    articles = []
    source = {}

    for source in sources:
        if source.get("type") == "snapshot":
            snap_id = source.get("snapshot_id")
            if snap_id:
                for a in database.snapshot_articles(snap_id):
                    links = a["links"]
                    if isinstance(links, str) and links:
                        try:
                            links = json.loads(links)
                        except Exception:
                            links = []
                    articles.append(
                        {
                            "title": a["title"],
                            "url": a["url"],
                            "source": a["source"],
                            "published": a["published"],
                            "text": a["text"],
                            "links": links or [],
                            "_pre_extracted": True,
                        }
                    )
        elif source.get("type") == "websites":
            requested_ids = [int(x) for x in source.get("change_ids") or []]
            recheck = bool(definition.get("recheck_websites"))
            for website_id in source.get("website_ids", []):
                website = database.website(int(website_id))
                if not website or not website["enabled"]:
                    continue
                if recheck:
                    log("fetch", f"Rechecking website monitor: {website['name']}")
                    result = check_website_monitor(database, int(website_id))
                    if result.get("skipped"):
                        log(
                            "fetch",
                            result.get("error") or "Check already running",
                            level="warn",
                        )
                    elif result.get("error"):
                        log(
                            "fetch",
                            f"Failed to fetch {website['name']}: {result['error']}",
                            level="error",
                        )
                    elif result.get("changed"):
                        log(
                            "change_detection",
                            f"Meaningful change detected: {website['name']}",
                        )
                    else:
                        log("change_detection", f"No meaningful change: {website['name']}")
                changes = []
                if requested_ids:
                    for change_id in requested_ids:
                        row = database.website_change(int(change_id))
                        if row and int(row["source_id"]) == int(website_id):
                            changes.append(row)
                else:
                    changes = database.pending_website_changes(int(website_id))
                if not changes:
                    log(
                        "change_detection", f"No pending website changes: {website['name']}"
                    )
                    continue
                for change in changes:
                    field_keys = {
                        _norm_key(f.get("name")): f["name"] for f in fields if f.get("name")
                    }
                    table_rows: list = []
                    try:
                        parsed_rows = json.loads(change["rows"] or "[]")
                        if isinstance(parsed_rows, list):
                            table_rows = parsed_rows
                    except (TypeError, ValueError):
                        table_rows = []
                    if table_rows:
                        for row in table_rows:
                            if not isinstance(row, dict):
                                continue
                            record = {
                                field_keys.get(_norm_key(key), key): value
                                for key, value in row.items()
                                if _norm_key(key) and value is not None
                            }
                            record.update(
                                {
                                    "title": website["name"],
                                    "url": website["url"],
                                    "source": website["name"],
                                    "published": change["detected_at"] or "",
                                    "text": json.dumps(
                                        row, ensure_ascii=False, default=str
                                    ),
                                    "_mapped_record": True,
                                    "_source_type": "website",
                                    "_website_id": int(website_id),
                                    "_snapshot_id": change["snapshot_id"],
                                    "_change_id": change["id"],
                                    "_fetch_backend": change["backend"],
                                    "_detected_at": change["detected_at"],
                                }
                            )
                            articles.append(record)
                        log(
                            "change_detection",
                            f"Queued {len(table_rows)} table rows from change #{change['id']} for {website['name']}",
                        )
                        continue
                    excerpt = changed_excerpt(change["diff"], change["clean_text"])
                    articles.append(
                        {
                            "title": website["name"],
                            "url": website["url"],
                            "source": website["name"],
                            "published": change["detected_at"] or "",
                            "text": excerpt,
                            "full_text": change["clean_text"],
                            "diff": change["diff"],
                            "_pre_extracted": True,
                            "_source_type": "website",
                            "_website_id": int(website_id),
                            "_snapshot_id": change["snapshot_id"],
                            "_change_id": change["id"],
                            "_fetch_backend": change["backend"],
                            "_detected_at": change["detected_at"],
                        }
                    )
                    log(
                        "change_detection",
                        f"Queued pending change #{change['id']} for {website['name']}",
                    )
        elif source.get("type") == "api_sources":
            for source_id in source.get("api_source_ids", []):
                api_src = database.api_source(int(source_id))
                if not api_src or not api_src["enabled"]:
                    continue
                try:
                    log("fetch", f"Fetching API source: {api_src['name']}")
                    result = fetch_feed(api_src["url"])
                    database.update_api_source_checked_time(int(source_id))
                    config = (
                        json.loads(api_src["extraction_config"] or "{}")
                        if "extraction_config" in api_src.keys()
                        else {}
                    )
                    mapped = []
                    if config.get("item_pointer") and config.get("fields"):
                        import requests
                        payload = requests.get(api_src["url"], timeout=30).json()
                        mapped = map_records(payload, config)
                    source_items = mapped or result.get("items", [])
                    for item in source_items:
                        base = {
                            "title": item.get("title") or item.get("name") or "API record",
                            "url": item.get("url")
                            or f"{api_src['url']}#record-{len(articles)}",
                            "source": api_src["name"],
                            "published": item.get("published", ""),
                            "text": item.get("content", "")
                            or item.get("summary", "")
                            or json.dumps(item, ensure_ascii=False),
                            **item,
                            "_source_type": "api",
                        }
                        if mapped:
                            base["_mapped_record"] = True
                            base["_pre_extracted"] = True
                        articles.append(base)
                except Exception as exc:
                    log(
                        "fetch",
                        f"Failed to fetch API {api_src['name']}: {exc}",
                        level="error",
                    )
        elif source.get("type") == "api":
            url = source.get("url")
            if url:
                try:
                    log("fetch", f"Fetching API URL: {url}")
                    result = fetch_feed(url)
                    for item in result.get("items", []):
                        articles.append(
                            {
                                "title": item.get("title", "Untitled"),
                                "url": item.get("url") or f"{url}#record-{len(articles)}",
                                "source": item.get("source") or "API",
                                "published": item.get("published", ""),
                                "text": item.get("content")
                                or item.get("summary")
                                or json.dumps(item, ensure_ascii=False),
                                "_source_type": "api",
                            }
                        )
                except Exception as exc:
                    log("fetch", f"Failed to fetch API url {url}: {exc}", level="error")
        else:
            feed_ids = set(source.get("feed_ids", []))
            for folder in database.folders():
                for feed in database.feeds(folder["id"]):
                    if feed["id"] not in feed_ids:
                        continue
                    try:
                        log("fetch", f"Fetching feed: {feed['title']}")
                        result = fetch_feed(feed["url"])
                    except Exception as exc:
                        log(
                            "fetch",
                            f"Failed to fetch {feed['title']}: {exc}",
                            level="error",
                        )
                        continue
                    limit = definition.get("max_articles", 20)
                    for item in result["items"][:limit]:
                        articles.append({**item, "source": feed["title"]})
                        if preview:
                            break

    before = len(articles)
    date_filter = definition.get("date_filter")
    articles = [a for a in articles if _in_date_range(a.get("published"), date_filter)]
    if date_filter and date_filter.get("enabled"):
        log("fetch", f"Date filter kept {len(articles)} of {before} articles")

    seen: set[str] = set()
    deduped = []
    for a in articles:
        key = (a.get("url") or "").strip()
        if not key and a.get("text"):
            key = "t:" + hashlib.md5(a["text"].encode("utf-8", "ignore")).hexdigest()
        if dedup and key and key in seen:
            continue
        if key:
            seen.add(key)
        deduped.append(a)
    articles = deduped
    if dedup:
        log("fetch", f"After dedupe: {len(articles)} unique articles")

    if only_titles:
        articles = [a for a in articles if a.get("title", "Untitled") in only_titles]
        log("fetch", f"Retry scope: {len(articles)} articles")

    if run_id is not None:
        database.update_run(
            run_id, progress_total=len(articles), articles_seen=len(articles)
        )

    snap_id = None
    if not preview and run_id is not None and articles:
        try:
            pipeline_name = definition.get("name") or (f"Pipeline {pipeline_id}" if pipeline_id else "Pipeline")
            snap_name = f"{pipeline_name} (Run #{run_id})"
            sources_list = sorted(list({a.get("source", "Unknown") for a in articles if a.get("source")}))
            source_label = ", ".join(sources_list)[:200]
            snap_id = database.create_snapshot(snap_name, "pipeline", source_label)
        except Exception as exc:
            log("snapshot", f"Failed to create run snapshot header: {exc}", level="warn")

    # Setup transformations sequence
    transforms = definition.get("transforms")
    if not transforms:
        transforms = []
        transforms.append({
            "type": "extract",
            "mode": definition.get("extraction_mode", "auto"),
            "hybrid_llm_fill": definition.get("hybrid_llm_fill", False),
            "llm": definition.get("llm"),
            "prompt": definition.get("prompt"),
            "api_config_id": definition.get("api_config_id"),
            "prompt_id": definition.get("prompt_id"),
            "schema_id": definition.get("schema_id"),
        })
        emb = definition.get("embeddings")
        if emb and emb.get("enabled"):
            transforms.append({
                "type": "chunk",
                "provider": emb.get("provider"),
                "model": emb.get("model"),
                "chunk_size": emb.get("chunk_size"),
                "chunk_overlap": emb.get("chunk_overlap"),
                "strategy": emb.get("strategy"),
                "min_words": emb.get("min_words"),
                "filter_by_keywords": emb.get("filter_by_keywords"),
                "generate_vectors": emb.get("generate_vectors"),
                "api_key": emb.get("api_key"),
            })

    errors = []
    cancelled = False

    def transform_keyword_filter(items, step_config):
        keywords = resolve_keywords(step_config, database)
        if not keywords:
            return items
        match_all = bool(step_config.get("match_all", False))
        filtered = [item for item in items if item_matches_keywords(item, keywords, match_all)]
        log(
            "filter",
            f"Keyword filter kept {len(filtered)}/{len(items)} item(s) ({len(keywords)} term(s))",
        )
        return filtered

    def transform_extract_single(item, step_config):
        step_schema_id = step_config.get("schema_id")
        step_schema = schema
        step_fields = fields
        if step_schema_id:
            try:
                row = next((s for s in database.schemas() if s["id"] == int(step_schema_id)), None)
                if row:
                    flds = json.loads(row["fields"] or "[]")
                    step_fields = flds
                    step_schema = schema_from_fields(flds)
            except Exception:
                pass

        title = item.get("title", "Untitled")
        mapped = bool(item.get("_mapped_record"))
        if mapped or not should_refetch_article(item, step_config):
            log("extract", f"Using already-fetched text: {title}", article_title=title)
            article = {
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "source": item.get("source", ""),
                "published": item.get("published", ""),
                "text": item.get("text", ""),
                "links": item.get("links", []),
            }
            record = {k: v for k, v in item.items() if not k.startswith("_")}
        else:
            log("render", f"Rendering article: {title}", article_title=title)
            def do_extract() -> dict:
                return extract_article(
                    item,
                    item.get("source", ""),
                    fetch_source=fetch_source,
                    firecrawl_api_key=firecrawl_api_key,
                    firecrawl_base_url=firecrawl_base_url,
                    use_browser=use_browser,
                )
            article = with_retry(do_extract, retries)
            record = {k: v for k, v in item.items() if not k.startswith("_")}

        if snap_id is not None:
            try:
                database.add_snapshot_article(snap_id, {
                    "title": article.get("title") or item.get("title") or "Untitled",
                    "url": article.get("url") or item.get("url") or "",
                    "source": article.get("source") or item.get("source") or "Unknown",
                    "published": article.get("published") or item.get("published") or "",
                    "author": article.get("author") or item.get("author") or "",
                    "text": article.get("text") or "",
                    "links": article.get("links") or [],
                })
            except Exception:
                pass

        mode = step_config.get("mode", "auto").lower()
        step_llm = step_config.get("llm") or llm or {}
        step_prompt = step_config.get("prompt") or prompt or ""

        if mode == "mapped":
            if not mapped:
                log("extract", f"Strict mapped mode: no mapping configured for {title}, returning raw text fields", level="warn", article_title=title)
                record = {
                    "title": article.get("title", ""),
                    "url": article.get("url", ""),
                    "text": article.get("text", ""),
                    "source": article.get("source", ""),
                }
        elif mode == "llm":
            log("extract", f"Calling LLM for: {title}", article_title=title)
            def do_llm() -> object:
                body = article["text"]
                if item.get("diff"):
                    body = (
                        "Changed sections:\n"
                        f"{item.get('text') or ''}\n\n"
                        "Full current page text:\n"
                        f"{item.get('full_text') or article.get('text') or ''}"
                    )
                return extract_json(
                    step_llm["endpoint"],
                    step_llm["model"],
                    step_llm.get("api_key", ""),
                    step_prompt,
                    body,
                    timeout=timeout,
                )
            record = with_retry(do_llm, retries)
        elif mode == "raw":
            log("extract", f"Using raw text for: {title}", article_title=title)
            record = {
                "title": article.get("title", ""),
                "url": article.get("url", ""),
                "text": article.get("text", ""),
                "source": article.get("source", ""),
            }
        else: # auto
            if mapped:
                required_fields = step_schema.get("required", [])
                missing = [f for f in required_fields if record.get(f) is None or record.get(f) == ""]
                if missing and step_llm.get("enabled") and step_config.get("hybrid_llm_fill", False):
                    log("extract", f"Hybrid gap-fill: extracting missing required fields: {', '.join(missing)}", article_title=title)
                    mini_properties = {k: step_schema["properties"][k] for k in missing if k in step_schema.get("properties", {})}
                    mini_schema = {
                        "type": "object",
                        "properties": mini_properties,
                        "required": missing
                    }
                    try:
                        gap_fill_record = extract_json(
                            step_llm["endpoint"],
                            step_llm["model"],
                            step_llm.get("api_key", ""),
                            f"Extract the following missing fields: {', '.join(missing)}. Schema:\n{json.dumps(mini_schema)}",
                            article["text"],
                            timeout=timeout,
                        )
                        if isinstance(gap_fill_record, dict):
                            for k, v in gap_fill_record.items():
                                if v is not None and v != "":
                                    record[k] = v
                    except Exception as exc:
                        log("extract", f"Hybrid gap-fill failed for {title}: {exc}", level="warn", article_title=title)
            elif step_llm.get("enabled"):
                log("extract", f"Calling LLM for: {title}", article_title=title)
                def do_llm() -> object:
                    body = article["text"]
                    if item.get("diff"):
                        body = (
                            "Changed sections:\n"
                            f"{item.get('text') or ''}\n\n"
                            "Full current page text:\n"
                            f"{item.get('full_text') or article.get('text') or ''}"
                        )
                    return extract_json(
                        step_llm["endpoint"],
                        step_llm["model"],
                        step_llm.get("api_key", ""),
                        step_prompt,
                        body,
                        timeout=timeout,
                    )
                record = with_retry(do_llm, retries)
            else:
                log("extract", f"Using raw text for: {title}", article_title=title)
                record = {
                    "title": article.get("title", ""),
                    "url": article.get("url", ""),
                    "text": article.get("text", ""),
                    "source": article.get("source", ""),
                }

        def step_coerce_and_fill(rec: dict) -> dict:
            res = dict(rec)
            for f in step_fields:
                name = (f.get("name") or "").strip()
                if not name:
                    continue
                val = res.get(name)
                if (val is None or val == "") and "default" in f and f["default"] not in (None, ""):
                    res[name] = f["default"]
                v = res.get(name)
                expected = f.get("type", "string")
                if v is not None:
                    if expected in ("number", "integer") and not isinstance(v, (int, float)):
                        try:
                            res[name] = int(v) if expected == "integer" else float(v)
                        except (TypeError, ValueError):
                            pass
                    elif expected == "boolean" and isinstance(v, str):
                        res[name] = v.strip().lower() in ("true", "1", "yes", "y")
            return res

        record = step_coerce_and_fill(record)
        log("validate", f"Validating record: {title}", article_title=title)
        
        validate_schema = dict(step_schema)
        relax = (
            step_config.get("role") == "chunk"
            or item.get("_source_type") == "chunk"
            or (item.get("_meta") or {}).get("source_type") == "chunk"
            or mode == "raw"
            or (mode == "auto" and not step_llm.get("enabled") and not mapped)
        )
        if relax and "required" in validate_schema:
            validate_schema = {k: v for k, v in validate_schema.items() if k != "required"}
        
        validate(record, validate_schema)
        meta = dict(item.get("_meta") or {})
        meta.update(record.get("_meta") or {})
        meta.update({
            "url": item.get("url") or article.get("url") or meta.get("url"),
            "article_url": item.get("url") or article.get("url") or meta.get("article_url") or meta.get("parent_url"),
            "feed_url": item.get("feed_url") or item.get("source"),
            "author": item.get("author"),
            "published": item.get("published"),
            "categories": item.get("categories"),
            "pipeline_id": pipeline_id,
            "run_id": run_id,
            "snapshot_id": item.get("_snapshot_id")
            or (str(source.get("snapshot_id")) if source.get("type") == "snapshot" else None),
            "source_type": item.get("_source_type") or meta.get("source_type") or "feed",
            "website_id": item.get("_website_id"),
            "change_id": item.get("_change_id"),
            "detected_at": item.get("_detected_at") or (_now() if item.get("_change_id") else None),
            "fetch_backend": item.get("_fetch_backend") or meta.get("fetch_backend") or article.get("_fetch_backend"),
            "parent_url": meta.get("parent_url") or item.get("url") or article.get("url"),
            "parent_title": meta.get("parent_title"),
            "chunk_index": meta.get("chunk_index"),
        })
        record["_meta"] = meta
        if item.get("_source_type") == "chunk":
            record["_source_type"] = "chunk"
        return record

    def transform_enrich_llm_single(item, step_config):
        title = item.get("title") or item.get("_meta", {}).get("article_title") or "Record"
        prompt_template = step_config.get("prompt", "")
        output_field = step_config.get("output_field", "enrichment")
        step_llm = step_config.get("llm") or llm or {}
        log("enrich", f"Enriching {title} via LLM prompt: {output_field}", article_title=title)
        body = item.get("text") or json.dumps({k: v for k, v in item.items() if not k.startswith("_")}, ensure_ascii=False)
        def do_enrich():
            return extract_json(
                step_llm.get("endpoint") or "https://api.openai.com/v1/chat/completions",
                step_llm.get("model") or "gpt-4o-mini",
                step_llm.get("api_key", ""),
                f"You are helping enrich structured records. Analyze the text/record below and output a JSON object containing a single key '{output_field}' with your response.\nPrompt instructions: {prompt_template}",
                body,
                timeout=timeout,
            )
        res = with_retry(do_enrich, retries)
        if isinstance(res, dict) and output_field in res:
            item[output_field] = res[output_field]
        elif isinstance(res, dict):
            first_val = next(iter(res.values()), None)
            if first_val is not None:
                item[output_field] = first_val
        else:
            item[output_field] = str(res)
        return item

    def transform_chunk_single(item, step_config):
        title = item.get("title") or item.get("_meta", {}).get("article_title") or "Record"
        parent_url = item.get("url") or (item.get("_meta") or {}).get("article_url") or (item.get("_meta") or {}).get("url") or ""
        text_content = item.get("text") or ""
        word_count = len(text_content.split())
        min_words = int(step_config.get("min_words") or 0)
        should_index = word_count >= min_words
        split_stream = bool(step_config.get("split_pipeline_stream", False))
        if should_index:
            try:
                doc_id = f"{item.get('_meta', {}).get('source_type', 'article')}:{parent_url or title}"
                index_document(
                    database,
                    doc_id,
                    text_content,
                    {
                        "source_url": item.get("_meta", {}).get("source_url") or parent_url,
                        "article_url": parent_url,
                        "article_title": title,
                        "source": item.get("source") or item.get("_meta", {}).get("source") or "",
                        "published": item.get("published") or item.get("_meta", {}).get("published") or "",
                    },
                    step_config,
                    step_config.get("api_key", ""),
                    generate_vectors=bool(step_config.get("generate_vectors", False)),
                )
            except Exception as exc:
                log("index", f"Chunk index skipped for {title}: {exc}", level="warn", article_title=title)

        if not split_stream:
            return item

        from rss_reader.chunker import chunk_text
        chunks = chunk_text(
            text_content,
            step_config.get("chunk_size", 800),
            step_config.get("chunk_overlap", 120),
            step_config.get("strategy", "paragraph"),
        )
        keywords = []
        if step_config.get("filter_by_keywords"):
            keywords = resolve_keywords({**step_config, "use_saved_keywords": True}, database)
        log("chunk", f"Split {title} into {len(chunks)} chunk(s)", article_title=title)
        chunk_records = []
        for idx, chunk_text_content in enumerate(chunks):
            candidate = {"title": title, "text": chunk_text_content}
            if keywords and not item_matches_keywords(candidate, keywords, bool(step_config.get("match_all"))):
                continue
            base = {k: v for k, v in item.items() if not k.startswith("_")}
            base.update({
                "title": f"{title} (Chunk {idx + 1})",
                "text": chunk_text_content,
                "url": parent_url,
                "_source_type": "chunk",
                "_parent_title": title,
            })
            meta = dict(item.get("_meta") or {})
            meta.update({
                "chunk_index": idx,
                "parent_title": title,
                "parent_url": parent_url,
                "article_url": parent_url,
                "source_type": "chunk",
                "chunk_text": chunk_text_content,
            })
            base["_meta"] = meta
            chunk_records.append(base)
        if keywords:
            log("chunk", f"Keyword filter kept {len(chunk_records)}/{len(chunks)} chunk(s) for {title}", article_title=title)
        return chunk_records

    def transform_synthesize(items, step_config):
        groups: dict[str, list] = {}
        for item in items:
            groups.setdefault(parent_key(item), []).append(item)
        step_llm = step_config.get("llm") or llm or {}
        step_prompt = (step_config.get("prompt") or "").strip()
        outputs = []
        for key, group in groups.items():
            ordered = sorted(group, key=lambda x: int((x.get("_meta") or {}).get("chunk_index") or 0))
            first = ordered[0]
            meta0 = first.get("_meta") or {}
            parent_title = meta0.get("parent_title") or first.get("title") or "Untitled"
            passages = []
            for ch in ordered:
                payload = {k: v for k, v in ch.items() if not k.startswith("_")}
                if not payload.get("text"):
                    payload["text"] = (ch.get("_meta") or {}).get("chunk_text") or ""
                payload["chunk_index"] = (ch.get("_meta") or {}).get("chunk_index")
                passages.append(payload)
            body = json.dumps(
                {"title": parent_title, "url": key, "passages": passages},
                ensure_ascii=False,
            )
            log("synthesize", f"Combining {len(passages)} passage(s) for {parent_title}", article_title=parent_title)
            if step_llm.get("enabled") and step_prompt:
                schema_hint = ""
                if fields:
                    schema_hint = "\nRequired output schema:\n" + json.dumps(schema)
                def do_synth():
                    return extract_json(
                        step_llm.get("endpoint") or "https://api.openai.com/v1/chat/completions",
                        step_llm.get("model") or "gpt-4o-mini",
                        step_llm.get("api_key", ""),
                        step_prompt + schema_hint,
                        body,
                        timeout=timeout,
                    )
                record = with_retry(do_synth, retries)
                if not isinstance(record, dict):
                    record = {"text": str(record)}
            else:
                record = {
                    "title": parent_title,
                    "url": key,
                    "text": "\n\n".join(str(p.get("text") or "") for p in passages if p.get("text")),
                    "passages": passages,
                }
            for f in fields:
                name = (f.get("name") or "").strip()
                if not name:
                    continue
                val = record.get(name)
                if (val is None or val == "") and "default" in f and f["default"] not in (None, ""):
                    record[name] = f["default"]
            if fields:
                validate_schema = dict(schema)
                try:
                    validate(record, validate_schema)
                except Exception:
                    if "required" in validate_schema:
                        validate(record, {k: v for k, v in validate_schema.items() if k != "required"})
                    else:
                        raise
            record["_meta"] = {
                **meta0,
                "source_type": "article",
                "parent_url": key,
                "parent_title": parent_title,
                "article_url": key,
                "passage_count": len(passages),
                "pipeline_id": pipeline_id,
                "run_id": run_id,
            }
            outputs.append(record)
        return outputs

    def run_concurrent_transform(worker_fn, items, step_config):
        results = [None] * len(items)
        errs = []
        lock = threading.Lock()
        completed = 0
        def worker(i: int, item: dict):
            try:
                return ("rec", i, worker_fn(item, step_config))
            except Exception as exc:
                return ("err", i, (item.get("title", "Untitled"), str(exc)))
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = {ex.submit(worker, i, item): i for i, item in enumerate(items)}
            for fut in as_completed(futures):
                if run_id is not None and is_cancelled(run_id):
                    for f in futures:
                        f.cancel()
                    nonlocal cancelled
                    cancelled = True
                    raise RuntimeError("Run cancelled")
                kind, i, payload = fut.result()
                with lock:
                    completed += 1
                    if kind == "rec":
                        results[i] = payload
                    else:
                        errs.append(payload)
                    if run_id is not None:
                        database.update_run(
                            run_id,
                            progress_current=completed,
                        )
        for name, err_msg in errs:
            errors.append(_error_item(name, err_msg))
        
        flat_results = []
        for r in results:
            if r is not None:
                if isinstance(r, list):
                    flat_results.extend(r)
                else:
                    flat_results.append(r)
        return flat_results

    try:
        for idx, step in enumerate(transforms):
            if run_id is not None and is_cancelled(run_id):
                cancelled = True
                break
            step_type = step.get("type", "extract")
            log("transform", f"Transform step {idx + 1}/{len(transforms)}: {step_type}")
            if step_type == "keyword_filter":
                articles = transform_keyword_filter(articles, step)
            elif step_type == "extract":
                articles = run_concurrent_transform(transform_extract_single, articles, step)
            elif step_type == "enrich_llm":
                articles = run_concurrent_transform(transform_enrich_llm_single, articles, step)
            elif step_type == "chunk":
                articles = run_concurrent_transform(transform_chunk_single, articles, step)
            elif step_type == "synthesize":
                articles = transform_synthesize(articles, step)
    except RuntimeError as exc:
        if "cancelled" in str(exc).lower():
            cancelled = True
            log("cancel", "Run cancelled by user", level="warn")
        else:
            raise

    records = articles
    output = None
    if not cancelled:
        _mark_website_changes_processed(database, records, run_id)
        output = (
            None
            if preview or not records
            else follow_on_destinations(
                database,
                definition,
                write_outputs(records, definition.get("output", {}), schema),
            )
        )
    elif run_id is not None:
        log("output", "Skipped DuckDB write because run was cancelled", level="warn")
    if run_id is not None:
        if cancelled:
            status = "cancelled"
        elif errors and not records:
            status = "failed"
        else:
            status = "success"
        database.update_run(
            run_id,
            status=status,
            finished_at=_now(),
            articles_seen=len(articles),
            records_count=len(records),
            error_count=len(errors),
            output_info=json.dumps(output or {}),
            result=json.dumps(
                {
                    "records": records,
                    "errors": errors,
                    "output": output,
                    "articles_seen": len(articles),
                }
            ),
            error="" if status == "success" else _first_error_message(errors),
        )
        clear_cancel(run_id)

    if not preview and run_id is not None and snap_id is not None:
        try:
            database.prune_snapshots("snapshot")
        except Exception:
            pass

    return {
        "records": records,
        "errors": errors,
        "output": output,
        "articles_seen": len(articles),
    }


def run_pipeline_safe(
    database: Database,
    definition: dict,
    preview: bool = False,
    run_id: int | None = None,
    **kwargs: Any,
) -> dict:
    try:
        return run_pipeline(database, definition, preview, run_id, **kwargs)
    except Exception as exc:
        if run_id is not None:
            run = database.get_run(run_id)
            if run and run["status"] in ("queued", "running"):
                database.update_run(
                    run_id,
                    status="failed",
                    finished_at=_now(),
                    error=str(exc),
                )
            clear_cancel(run_id)
        raise
