from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request

from .database import Database
from .extractor import extract_article
from .feeds import fetch_feed
from .llm import extract_json, generate_schema
from .pipeline import run_pipeline, schema_from_fields


def create_app(database_path: Path | None = None) -> Flask:
    app = Flask(__name__)
    database = Database(database_path)
    app.config["DATABASE"] = database

    @app.get("/")
    def index():
        return render_template("dashboard.html")

    @app.get("/reader")
    def reader():
        return render_template("index.html")

    @app.get("/api/dashboard")
    def dashboard_data():
        folders = database.folders()
        feeds = [feed for folder in folders for feed in database.feeds(folder["id"])]
        pipelines = database.pipelines()
        return jsonify(
            {
                "folders": len(folders),
                "feeds": len(feeds),
                "pipelines": len(pipelines),
                "active_pipelines": sum(bool(row["enabled"]) for row in pipelines),
                "saved_articles": sum(
                    len(database.saved_articles(folder["id"])) for folder in folders
                ),
            }
        )

    @app.get("/pipelines")
    def pipelines_page():
        return render_template("pipelines.html")

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
        return jsonify(extract_article(data, data.get("source", "")))

    @app.post("/api/articles/bulk")
    def bulk_articles():
        data = request.json or {}
        articles = data.get("articles", [])
        if not isinstance(articles, list) or len(articles) > 100:
            return jsonify(error="Select between 1 and 100 articles"), 400
        return jsonify(
            [extract_article(item, item.get("source", "")) for item in articles]
        )

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
        definition["schema"] = schema_from_fields(definition.get("fields", []))
        try:
            existing = database.pipeline_by_name(name)
            pipeline_id = database.save_pipeline(
                name, definition, existing["id"] if existing else None
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 400
        if definition.get("run_on_change"):
            threading.Thread(
                target=run_pipeline, args=(database, definition), daemon=True
            ).start()
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
        try:
            return jsonify(
                run_pipeline(
                    database,
                    json.loads(row["definition"]),
                    bool((request.json or {}).get("preview")),
                )
            )
        except Exception as exc:
            return jsonify(error=str(exc)), 500

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Autofeedly web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--no-browser", action="store_true", help="Do not open a browser window"
    )
    args = parser.parse_args()
    app = create_app()
    if not args.no_browser:
        threading.Timer(
            0.8, webbrowser.open, args=(f"http://{args.host}:{args.port}",)
        ).start()
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
