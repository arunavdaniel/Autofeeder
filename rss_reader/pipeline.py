from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path
from typing import Any

from jsonschema import validate

from .database import Database, data_directory
from .extractor import extract_article
from .feeds import fetch_feed
from .llm import extract_json


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


def write_outputs(records: list[dict], output: dict, schema: dict) -> dict:
    kind = output.get("type", "csv")
    if kind == "csv":
        path = Path(
            output.get("path") or data_directory() / "pipeline-output.csv"
        ).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if output.get("mode") == "append" and path.exists() else "w"
        fields = list(schema.get("properties", {}).keys()) or sorted(
            {key for row in records for key in row}
        )
        with path.open(mode, newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
            if mode == "w":
                writer.writeheader()
            writer.writerows(
                {key: _flatten(row.get(key, "")) for key in fields} for row in records
            )
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


def run_pipeline(database: Database, definition: dict, preview: bool = False) -> dict:
    schema = definition.get("schema", {"type": "object", "properties": {}})
    feed_ids = definition.get("feed_ids", [])
    articles = []
    for folder in database.folders():
        for feed in database.feeds(folder["id"]):
            if feed["id"] not in feed_ids:
                continue
            result = fetch_feed(feed["url"])
            for item in result["items"][: definition.get("max_articles", 20)]:
                articles.append({**item, "source": feed["title"]})
                if preview:
                    break
    records, errors = [], []
    for item in articles:
        try:
            article = extract_article(item, item.get("source", ""))
            llm = definition.get("llm", {})
            record = (
                extract_json(
                    llm["endpoint"],
                    llm["model"],
                    llm.get("api_key", ""),
                    definition.get("prompt", ""),
                    article["text"],
                )
                if llm.get("enabled")
                else article
            )
            if not llm.get("enabled"):
                record = {
                    "title": article.get("title", ""),
                    "url": article.get("url", ""),
                    "text": article.get("text", ""),
                    "source": article.get("source", ""),
                }
            validate(record, schema)
            records.append(record)
        except Exception as exc:
            errors.append({"title": item.get("title", "Untitled"), "error": str(exc)})
    output = (
        None
        if preview or not records
        else write_outputs(records, definition.get("output", {}), schema)
    )
    return {
        "records": records,
        "errors": errors,
        "output": output,
        "articles_seen": len(articles),
    }
