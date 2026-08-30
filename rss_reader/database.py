from __future__ import annotations

import os
import json
import sqlite3
import sys
import threading
from pathlib import Path
from typing import Any


def data_directory() -> Path:
    if sys.platform == "win32":
        root = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library/Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    path = root / "RSS Text Reader"
    path.mkdir(parents=True, exist_ok=True)
    return path


class Database:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_directory() / "reader.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._ensure_connection()
        self._create_schema()

    def _ensure_connection(self) -> sqlite3.Connection:
        conn = getattr(self._local, "connection", None)
        if conn is None:
            conn = sqlite3.connect(self.path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 5000")
            self._local.connection = conn
        return conn

    @property
    def connection(self) -> sqlite3.Connection:
        return self._ensure_connection()

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS feeds (
                id INTEGER PRIMARY KEY,
                folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                site_url TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS saved_articles (
                id INTEGER PRIMARY KEY,
                folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                source TEXT DEFAULT '',
                published TEXT DEFAULT '',
                text TEXT NOT NULL,
                saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(folder_id, url)
            );
            CREATE TABLE IF NOT EXISTS pipelines (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                definition TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                id INTEGER PRIMARY KEY,
                pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE CASCADE,
                preview INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                phase TEXT NOT NULL DEFAULT '',
                last_message TEXT NOT NULL DEFAULT '',
                progress_current INTEGER NOT NULL DEFAULT 0,
                progress_total INTEGER NOT NULL DEFAULT 0,
                articles_seen INTEGER NOT NULL DEFAULT 0,
                records_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                output_info TEXT NOT NULL DEFAULT '{}',
                result TEXT NOT NULL DEFAULT '{}',
                error TEXT NOT NULL DEFAULT '',
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS pipeline_job_logs (
                id INTEGER PRIMARY KEY,
                run_id INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
                step TEXT NOT NULL,
                message TEXT NOT NULL,
                level TEXT NOT NULL DEFAULT 'info',
                article_title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'feed',
                source_label TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS snapshot_articles (
                id INTEGER PRIMARY KEY,
                snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',
                published TEXT NOT NULL DEFAULT '',
                author TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL DEFAULT '',
                links TEXT NOT NULL DEFAULT '[]',
                captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS api_configs (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                provider TEXT NOT NULL DEFAULT 'custom',
                endpoint TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                temperature REAL,
                timeout INTEGER NOT NULL DEFAULT 60,
                extra TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS prompt_templates (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                system_prompt TEXT NOT NULL DEFAULT '',
                extraction_prompt TEXT NOT NULL DEFAULT '',
                variables TEXT NOT NULL DEFAULT '[]',
                schema_id INTEGER,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS schemas (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                json_schema TEXT NOT NULL DEFAULT '{}',
                fields TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS duckdb_databases (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                path TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_opened_at TEXT
            );
            CREATE TABLE IF NOT EXISTS snapshot_schedules (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                feed_ids TEXT NOT NULL DEFAULT '[]',
                folder_ids TEXT NOT NULL DEFAULT '[]',
                max_articles INTEGER NOT NULL DEFAULT 50,
                dest TEXT,
                schedule TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS field_mappings (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                schema_id INTEGER,
                database TEXT NOT NULL DEFAULT '',
                table_name TEXT NOT NULL DEFAULT '',
                columns TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS websites (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                fetch_method TEXT NOT NULL DEFAULT 'http',
                frequency TEXT NOT NULL DEFAULT '1h',
                schema_id INTEGER,
                prompt TEXT NOT NULL DEFAULT '',
                destination TEXT NOT NULL DEFAULT '{}',
                fetch_options TEXT NOT NULL DEFAULT '{}',
                pipeline_id INTEGER,
                enabled INTEGER NOT NULL DEFAULT 1,
                last_checked TEXT,
                last_changed TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                last_status_code INTEGER,
                last_backend TEXT NOT NULL DEFAULT '',
                last_duration_ms INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS api_sources (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                frequency TEXT NOT NULL DEFAULT '1h',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_checked TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS api_snapshots (
                id INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES api_sources(id) ON DELETE CASCADE,
                fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                content_hash TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '{}',
                previous_snapshot_id INTEGER,
                changed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS website_snapshots (
                id INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
                fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                content_hash TEXT NOT NULL,
                raw_html TEXT NOT NULL DEFAULT '',
                clean_text TEXT NOT NULL DEFAULT '',
                previous_snapshot_id INTEGER,
                changed INTEGER NOT NULL DEFAULT 0,
                backend TEXT NOT NULL DEFAULT '',
                status_code INTEGER,
                title TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER
            );
            CREATE TABLE IF NOT EXISTS website_changes (
                id INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
                snapshot_id INTEGER NOT NULL REFERENCES website_snapshots(id) ON DELETE CASCADE,
                previous_snapshot_id INTEGER,
                diff TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                processed_at TEXT,
                run_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS website_checks (
                id INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
                started_at TEXT,
                finished_at TEXT,
                backend TEXT NOT NULL DEFAULT '',
                status_code INTEGER,
                snapshot_id INTEGER,
                changed INTEGER NOT NULL DEFAULT 0,
                change_id INTEGER,
                error TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER
            );
            CREATE TABLE IF NOT EXISTS embedding_configs (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                provider TEXT NOT NULL DEFAULT 'local',
                endpoint TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                chunk_size INTEGER NOT NULL DEFAULT 800,
                chunk_overlap INTEGER NOT NULL DEFAULT 120,
                strategy TEXT NOT NULL DEFAULT 'paragraph',
                top_k INTEGER NOT NULL DEFAULT 5,
                enabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS document_chunks (
                id INTEGER PRIMARY KEY,
                document_id TEXT NOT NULL,
                chunk_id TEXT NOT NULL UNIQUE,
                source_url TEXT NOT NULL DEFAULT '',
                article_url TEXT NOT NULL DEFAULT '',
                article_title TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',
                published TEXT NOT NULL DEFAULT '',
                chunk_text TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                embedding_model TEXT NOT NULL DEFAULT '',
                embedding_dimension INTEGER NOT NULL DEFAULT 0,
                embedding TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);
            CREATE INDEX IF NOT EXISTS idx_changes_source ON website_changes(source_id, detected_at);
            CREATE TABLE IF NOT EXISTS keywords (
                id INTEGER PRIMARY KEY,
                word TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL DEFAULT 'general',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        self.connection.commit()
        self._migrate_schema()

    def _migrate_schema(self) -> None:
        for table, column, decl in [
            ("pipeline_runs", "result", "TEXT NOT NULL DEFAULT '{}'"),
            ("pipelines", "last_scheduled_run", "TEXT"),
            ("pipelines", "last_snapshot_run", "TEXT"),
            ("snapshot_articles", "starred", "INTEGER NOT NULL DEFAULT 0"),
            ("snapshot_articles", "read", "INTEGER NOT NULL DEFAULT 0"),
            ("snapshot_articles", "tags", "TEXT NOT NULL DEFAULT ''"),
            ("websites", "fetch_options", "TEXT NOT NULL DEFAULT '{}'"),
            ("api_sources", "extraction_config", "TEXT NOT NULL DEFAULT '{}'"),
            ("websites", "pipeline_id", "INTEGER"),
            ("websites", "last_error", "TEXT NOT NULL DEFAULT ''"),
            ("websites", "last_status_code", "INTEGER"),
            ("websites", "last_backend", "TEXT NOT NULL DEFAULT ''"),
            ("websites", "last_duration_ms", "INTEGER"),
            ("website_snapshots", "backend", "TEXT NOT NULL DEFAULT ''"),
            ("website_snapshots", "status_code", "INTEGER"),
            ("website_snapshots", "title", "TEXT NOT NULL DEFAULT ''"),
            ("website_snapshots", "duration_ms", "INTEGER"),
            ("website_changes", "run_id", "INTEGER"),
            ("website_changes", "rows", "TEXT NOT NULL DEFAULT '[]'"),
            ("duckdb_databases", "updated_at", "TEXT"),
        ]:
            existing = [
                row[1] for row in self.connection.execute(f"PRAGMA table_info({table})")
            ]
            if column not in existing:
                self.connection.execute(
                    f"ALTER TABLE {table} ADD COLUMN {column} {decl}"
                )
        for stmt in [
            "CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON pipeline_runs(pipeline_id)",
            "CREATE INDEX IF NOT EXISTS idx_runs_created ON pipeline_runs(created_at)",
            "CREATE INDEX IF NOT EXISTS idx_snap_art_snap ON snapshot_articles(snapshot_id)",
            "CREATE INDEX IF NOT EXISTS idx_snap_art_title ON snapshot_articles(title)",
            """CREATE TABLE IF NOT EXISTS website_checks (
                id INTEGER PRIMARY KEY,
                source_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
                started_at TEXT,
                finished_at TEXT,
                backend TEXT NOT NULL DEFAULT '',
                status_code INTEGER,
                snapshot_id INTEGER,
                changed INTEGER NOT NULL DEFAULT 0,
                change_id INTEGER,
                error TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER
            )""",
            "CREATE INDEX IF NOT EXISTS idx_website_checks_source ON website_checks(source_id, finished_at)",
            """CREATE TABLE IF NOT EXISTS publish_channels (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                database TEXT NOT NULL,
                table_name TEXT NOT NULL DEFAULT '',
                sql TEXT NOT NULL DEFAULT '',
                mapping TEXT NOT NULL DEFAULT '{}',
                api_key TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS sync_targets (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'sqlite',
                database TEXT NOT NULL,
                table_name TEXT NOT NULL DEFAULT '',
                sql TEXT NOT NULL DEFAULT '',
                dest TEXT NOT NULL DEFAULT '{}',
                key_column TEXT NOT NULL DEFAULT 'url',
                schedule TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""",
        ]:
            self.connection.execute(stmt)
        self.connection.commit()

    def folders(self) -> list[sqlite3.Row]:
        return self.connection.execute("SELECT * FROM folders ORDER BY name").fetchall()

    def add_folder(self, name: str) -> int:
        cursor = self.connection.execute(
            "INSERT INTO folders(name) VALUES (?)", (name.strip(),)
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def delete_folder(self, folder_id: int) -> None:
        self.connection.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        self.connection.commit()

    def feeds(self, folder_id: int) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM feeds WHERE folder_id = ? ORDER BY title", (folder_id,)
        ).fetchall()

    def add_feed(self, folder_id: int, title: str, url: str, site_url: str = "") -> int:
        cursor = self.connection.execute(
            "INSERT INTO feeds(folder_id, title, url, site_url) VALUES (?, ?, ?, ?)",
            (folder_id, title, url, site_url),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def delete_feed(self, feed_id: int) -> None:
        self.connection.execute("DELETE FROM feeds WHERE id = ?", (feed_id,))
        self.connection.commit()

    def save_article(self, folder_id: int, article: dict[str, Any]) -> None:
        self.connection.execute(
            """INSERT INTO saved_articles(folder_id, title, url, source, published, text)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(folder_id, url) DO UPDATE SET text=excluded.text,
               title=excluded.title, published=excluded.published""",
            (
                folder_id,
                article["title"],
                article["url"],
                article.get("source", ""),
                article.get("published", ""),
                article["text"],
            ),
        )
        self.connection.commit()

    def saved_articles(self, folder_id: int) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM saved_articles WHERE folder_id = ? ORDER BY saved_at DESC",
            (folder_id,),
        ).fetchall()

    def pipelines(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM pipelines ORDER BY name"
        ).fetchall()

    def pipeline(self, pipeline_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM pipelines WHERE id = ?", (pipeline_id,)
        ).fetchone()

    def pipeline_by_name(self, name: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM pipelines WHERE name = ?", (name,)
        ).fetchone()

    def save_pipeline(
        self, name: str, definition: dict, pipeline_id: int | None = None
    ) -> int:
        if pipeline_id:
            self.connection.execute(
                "UPDATE pipelines SET name=?, definition=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (name.strip(), json.dumps(definition), pipeline_id),
            )
            result = pipeline_id
        else:
            cursor = self.connection.execute(
                "INSERT INTO pipelines(name, definition) VALUES (?, ?)",
                (name.strip(), json.dumps(definition)),
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_pipeline(self, pipeline_id: int) -> None:
        self.connection.execute("DELETE FROM pipelines WHERE id=?", (pipeline_id,))
        self.connection.commit()

    def create_run(self, pipeline_id: int, preview: bool = False) -> int:
        cursor = self.connection.execute(
            "INSERT INTO pipeline_runs(pipeline_id, preview, status) VALUES (?, ?, 'queued')",
            (pipeline_id, 1 if preview else 0),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def update_run(self, run_id: int, **fields: object) -> None:
        if not fields:
            return
        setters = ", ".join(f"{key}=?" for key in fields)
        self.connection.execute(
            f"UPDATE pipeline_runs SET {setters} WHERE id=?",
            tuple(fields.values()) + (run_id,),
        )
        self.connection.commit()

    def get_run(self, run_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM pipeline_runs WHERE id=?", (run_id,)
        ).fetchone()

    def append_run_log(
        self,
        run_id: int,
        step: str,
        message: str,
        level: str = "info",
        article_title: str = "",
    ) -> None:
        self.connection.execute(
            "INSERT INTO pipeline_job_logs(run_id, step, message, level, article_title) VALUES (?, ?, ?, ?, ?)",
            (run_id, step, message, level, article_title),
        )
        self.connection.commit()

    def run_logs(self, run_id: int) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM pipeline_job_logs WHERE run_id=? ORDER BY id",
            (run_id,),
        ).fetchall()

    def pipeline_runs(
        self, pipeline_id: int | None = None, limit: int = 50
    ) -> list[sqlite3.Row]:
        if pipeline_id is None:
            return self.connection.execute(
                "SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return self.connection.execute(
            "SELECT * FROM pipeline_runs WHERE pipeline_id=? ORDER BY id DESC LIMIT ?",
            (pipeline_id, limit),
        ).fetchall()

    def runs_filtered(
        self,
        pipeline_id: int | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[sqlite3.Row]:
        clauses: list[str] = []
        params: list[object] = []
        if pipeline_id is not None:
            clauses.append("pipeline_id=?")
            params.append(pipeline_id)
        if status:
            clauses.append("status=?")
            params.append(status)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        return self.connection.execute(
            f"SELECT * FROM pipeline_runs{where} ORDER BY id DESC LIMIT ? OFFSET ?",
            tuple(params) + (limit, offset),
        ).fetchall()

    def runs_count(
        self, pipeline_id: int | None = None, status: str | None = None
    ) -> int:
        clauses: list[str] = []
        params: list[object] = []
        if pipeline_id is not None:
            clauses.append("pipeline_id=?")
            params.append(pipeline_id)
        if status:
            clauses.append("status=?")
            params.append(status)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        return int(
            self.connection.execute(
                f"SELECT COUNT(*) FROM pipeline_runs{where}", tuple(params)
            ).fetchone()[0]
        )

    def run_totals(self) -> dict[str, int]:
        row = self.connection.execute(
            """SELECT COUNT(*) AS total_runs,
                      COALESCE(SUM(records_count), 0) AS total_records,
                      COALESCE(SUM(error_count), 0) AS total_errors,
                      COALESCE(SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END), 0) AS active_runs
               FROM pipeline_runs"""
        ).fetchone()
        return {
            "total_runs": int(row["total_runs"] or 0),
            "total_records": int(row["total_records"] or 0),
            "total_errors": int(row["total_errors"] or 0),
            "active_runs": int(row["active_runs"] or 0),
        }

    def delete_run(self, run_id: int) -> None:
        self.connection.execute("DELETE FROM pipeline_runs WHERE id=?", (run_id,))
        self.connection.commit()

    def rename_feed(self, feed_id: int, name: str) -> None:
        self.connection.execute(
            "UPDATE feeds SET title=? WHERE id=?", (name.strip(), feed_id)
        )
        self.connection.commit()

    def rename_folder(self, folder_id: int, name: str) -> None:
        self.connection.execute(
            "UPDATE folders SET name=? WHERE id=?", (name.strip(), folder_id)
        )
        self.connection.commit()

    def create_snapshot(self, name: str, kind: str, source_label: str = "") -> int:
        cursor = self.connection.execute(
            "INSERT INTO snapshots(name, kind, source_label) VALUES (?, ?, ?)",
            (name.strip(), kind, source_label),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def add_snapshot_article(self, snapshot_id: int, article: dict[str, Any]) -> None:
        links = article.get("links")
        if isinstance(links, (list, dict)):
            links = json.dumps(links, ensure_ascii=False)
        elif not isinstance(links, str):
            links = "[]"
        self.connection.execute(
            """INSERT INTO snapshot_articles
               (snapshot_id, title, url, source, published, author, text, links)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                snapshot_id,
                article.get("title", ""),
                article.get("url", ""),
                article.get("source", ""),
                article.get("published", ""),
                article.get("author", ""),
                article.get("text", ""),
                links,
            ),
        )
        self.connection.commit()

    def snapshots(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            """SELECT s.*, COUNT(a.id) AS article_count
               FROM snapshots s LEFT JOIN snapshot_articles a ON a.snapshot_id=s.id
               GROUP BY s.id ORDER BY s.id DESC"""
        ).fetchall()

    def snapshot(self, snapshot_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM snapshots WHERE id=?", (snapshot_id,)
        ).fetchone()

    def snapshot_articles(self, snapshot_id: int) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM snapshot_articles WHERE snapshot_id=? ORDER BY id",
            (snapshot_id,),
        ).fetchall()

    def update_snapshot(self, snapshot_id: int, name: str) -> None:
        self.connection.execute(
            "UPDATE snapshots SET name=? WHERE id=?", (name.strip(), snapshot_id)
        )
        self.connection.commit()

    def delete_snapshot(self, snapshot_id: int) -> None:
        self.connection.execute("DELETE FROM snapshots WHERE id=?", (snapshot_id,))
        self.connection.commit()

    def prune_snapshots(self, kind: str, keep: int | None = None) -> int:
        """Keep the newest ``keep`` raw snapshots per source; prune the rest."""
        table = {
            "snapshot": "snapshots",
            "website": "website_snapshots",
            "api": "api_snapshots",
        }.get(kind)
        if not table:
            return 0
        if keep is None:
            keep = self.get_setting("snapshot_retention", 10)
        keep = max(1, int(keep) if keep else 10)
        if kind in ("website", "api"):
            cursor = self.connection.execute(
                f"""DELETE FROM {table}
                    WHERE id NOT IN (
                        SELECT id FROM (
                            SELECT id, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY id DESC) AS rn FROM {table}
                        ) WHERE rn <= ?
                    )""",
                (keep,),
            )
        else:
            cursor = self.connection.execute(
                f"""DELETE FROM {table}
                    WHERE id NOT IN (
                        SELECT id FROM (
                            SELECT id,
                                   ROW_NUMBER() OVER (
                                       PARTITION BY COALESCE(NULLIF(source_label, ''), name, '')
                                       ORDER BY id DESC
                                   ) AS rn
                            FROM {table}
                        ) WHERE rn <= ?
                    )""",
                (keep,),
            )
        self.connection.commit()
        return int(cursor.rowcount or 0)

    def unified_snapshots(self, limit: int = 200) -> list[dict]:
        """Aggregate feed, website, and API snapshots into one view."""
        rows: list[dict] = []
        for row in self.connection.execute(
            """SELECT s.id, s.name, s.kind, s.source_label, s.created_at, COUNT(a.id) AS article_count
               FROM snapshots s LEFT JOIN snapshot_articles a ON a.snapshot_id=s.id
               GROUP BY s.id ORDER BY s.id DESC LIMIT ?""",
            (limit,),
        ):
            kind = row["kind"] or "feed"
            ui_type = "pipeline" if kind == "pipeline" else "feed"
            rows.append(
                {
                    "type": ui_type,
                    "id": row["id"],
                    "name": row["name"] or row["source_label"] or "",
                    "kind": kind,
                    "source": row["source_label"] or row["name"] or "",
                    "created_at": row["created_at"],
                    "article_count": row["article_count"],
                    "changed": None,
                }
            )
        for row in self.connection.execute(
            """SELECT ws.id, ws.source_id, ws.title, ws.fetched_at AS created, ws.changed, ws.backend, ws.status_code, w.name
               FROM website_snapshots ws JOIN websites w ON w.id = ws.source_id
               ORDER BY ws.id DESC LIMIT ?""",
            (limit,),
        ):
            rows.append(
                {
                    "type": "website",
                    "id": row["id"],
                    "name": row["name"] or "",
                    "kind": "website",
                    "source": row["name"] or "",
                    "created_at": row["created"],
                    "article_count": None,
                    "changed": bool(row["changed"]),
                    "backend": row["backend"],
                }
            )
        for row in self.connection.execute(
            """SELECT ap.id, ap.source_id, ap.changed, ap.fetched_at AS created, asrc.name
               FROM api_snapshots ap JOIN api_sources asrc ON asrc.id = ap.source_id
               ORDER BY ap.id DESC LIMIT ?""",
            (limit,),
        ):
            rows.append(
                {
                    "type": "api",
                    "id": row["id"],
                    "name": row["name"] or "",
                    "kind": "api",
                    "source": row["name"] or "",
                    "created_at": row["created"],
                    "article_count": None,
                    "changed": bool(row["changed"]),
                }
            )
        rows.sort(key=lambda item: item["created_at"] or "", reverse=True)
        return rows[:limit]

    def update_snapshot_article(self, article_id: int, **fields: object) -> None:
        allowed = {"starred", "read", "tags", "title", "url", "source", "published"}
        setters = {k: v for k, v in fields.items() if k in allowed}
        if not setters:
            return
        clauses = ", ".join(f"{key}=?" for key in setters)
        self.connection.execute(
            f"UPDATE snapshot_articles SET {clauses} WHERE id=?",
            tuple(setters.values()) + (article_id,),
        )
        self.connection.commit()

    def search_snapshot_articles(
        self, query: str, limit: int = 50
    ) -> list[sqlite3.Row]:
        like = f"%{query}%"
        return self.connection.execute(
            """SELECT a.*, s.name AS snapshot_name
               FROM snapshot_articles a
               JOIN snapshots s ON s.id = a.snapshot_id
               WHERE a.title LIKE ? OR a.text LIKE ? OR a.source LIKE ?
               ORDER BY a.id DESC LIMIT ?""",
            (like, like, like, limit),
        ).fetchall()

    def set_pipeline_last_scheduled(self, pipeline_id: int, ts: str) -> None:
        self.connection.execute(
            "UPDATE pipelines SET last_scheduled_run=? WHERE id=?",
            (ts, pipeline_id),
        )
        self.connection.commit()

    def set_pipeline_last_snapshot(self, pipeline_id: int, ts: str) -> None:
        self.connection.execute(
            "UPDATE pipelines SET last_snapshot_run=? WHERE id=?",
            (ts, pipeline_id),
        )
        self.connection.commit()

    def delete_snapshot(self, snapshot_id: int) -> None:
        self.connection.execute("DELETE FROM snapshots WHERE id=?", (snapshot_id,))
        self.connection.commit()

    # ----- Snapshot schedules -----
    def create_snapshot_schedule(
        self,
        name: str,
        feed_ids: list[int],
        folder_ids: list[int],
        max_articles: int,
        dest: dict | None,
        schedule: dict,
        enabled: bool = True,
    ) -> int:
        cursor = self.connection.execute(
            """INSERT INTO snapshot_schedules
               (name, feed_ids, folder_ids, max_articles, dest, schedule, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                name.strip(),
                json.dumps(feed_ids),
                json.dumps(folder_ids),
                int(max_articles or 50),
                json.dumps(dest) if dest else None,
                json.dumps(schedule),
                1 if enabled else 0,
            ),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def snapshot_schedules(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM snapshot_schedules ORDER BY id DESC"
        ).fetchall()

    def delete_snapshot_schedule(self, schedule_id: int) -> None:
        self.connection.execute(
            "DELETE FROM snapshot_schedules WHERE id=?", (schedule_id,)
        )
        self.connection.commit()

    def set_snapshot_schedule_last_run(self, schedule_id: int, ts: str) -> None:
        self.connection.execute(
            "UPDATE snapshot_schedules SET last_run=? WHERE id=?",
            (ts, schedule_id),
        )
        self.connection.commit()

    def migrate_snapshot_schedules_to_pipelines(self) -> int:
        converted = 0
        for row in self.snapshot_schedules():
            name = str(row["name"] or "Scheduled capture").strip()
            existing = self.pipeline_by_name(name)
            if existing:
                name = f"{name} (snapshot {row['id']})"
            feed_ids = json.loads(row["feed_ids"] or "[]")
            folder_ids = json.loads(row["folder_ids"] or "[]")
            dest = json.loads(row["dest"]) if row["dest"] else None
            schedule = json.loads(row["schedule"] or "{}")
            schedule["enabled"] = True
            definition = {
                "sources": [{"type": "feeds", "feed_ids": feed_ids}],
                "folder_ids": folder_ids,
                "feed_ids": feed_ids,
                "max_articles": int(row["max_articles"] or 50),
                "llm": {"enabled": False},
                "extraction_mode": "raw",
                "schedule": {"enabled": False, "kind": "interval", "minutes": 60},
                "snapshot": {
                    "enabled": True,
                    "kind": schedule.get("kind") or "interval",
                    "minutes": schedule.get("minutes") or 60,
                    "time": schedule.get("time") or "09:00",
                    "dest": dest,
                },
                "output": {"type": "duckdb"},
            }
            self.save_pipeline(name, definition)
            self.delete_snapshot_schedule(int(row["id"]))
            converted += 1
        return converted

    def publish_channels(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM publish_channels ORDER BY name"
        ).fetchall()

    def publish_channel_by_slug(self, slug: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM publish_channels WHERE slug=?", (slug,)
        ).fetchone()

    def save_publish_channel(self, payload: dict, channel_id: int | None = None) -> int:
        from .publish import slugify

        slug = slugify(str(payload.get("slug") or payload.get("name") or "feed"))
        kind = str(payload.get("kind") or "rss")
        if kind not in {"rss", "json"}:
            raise ValueError("kind must be rss or json")
        values = (
            kind,
            slug,
            str(payload.get("name") or slug).strip(),
            str(payload.get("database") or "").strip(),
            str(payload.get("table") or payload.get("table_name") or "").strip(),
            str(payload.get("sql") or "").strip(),
            json.dumps(payload.get("mapping") or {}),
            str(payload.get("api_key") or "").strip(),
            1 if payload.get("enabled", True) else 0,
        )
        if not values[3]:
            raise ValueError("database is required")
        if channel_id:
            self.connection.execute(
                """UPDATE publish_channels SET kind=?, slug=?, name=?, database=?, table_name=?,
                   sql=?, mapping=?, api_key=?, enabled=? WHERE id=?""",
                values + (channel_id,),
            )
            result = channel_id
        else:
            cursor = self.connection.execute(
                """INSERT INTO publish_channels
                   (kind, slug, name, database, table_name, sql, mapping, api_key, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                values,
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_publish_channel(self, channel_id: int) -> None:
        self.connection.execute("DELETE FROM publish_channels WHERE id=?", (channel_id,))
        self.connection.commit()

    def sync_targets(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM sync_targets ORDER BY name"
        ).fetchall()

    def sync_target(self, target_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM sync_targets WHERE id=?", (target_id,)
        ).fetchone()

    def save_sync_target(self, payload: dict, target_id: int | None = None) -> int:
        values = (
            str(payload.get("name") or "Sync").strip(),
            str(payload.get("kind") or "sqlite"),
            str(payload.get("database") or "").strip(),
            str(payload.get("table") or payload.get("table_name") or "").strip(),
            str(payload.get("sql") or "").strip(),
            json.dumps(payload.get("dest") or {}),
            str(payload.get("key_column") or "url").strip() or "url",
            json.dumps(payload.get("schedule") or {}),
            1 if payload.get("enabled", True) else 0,
        )
        if not values[2]:
            raise ValueError("database is required")
        kind = str(payload.get("kind") or "sqlite")
        from .publish import SYNC_KINDS

        if kind not in SYNC_KINDS:
            raise ValueError(f"kind must be one of: {', '.join(SYNC_KINDS)}")
        if target_id:
            self.connection.execute(
                """UPDATE sync_targets SET name=?, kind=?, database=?, table_name=?, sql=?,
                   dest=?, key_column=?, schedule=?, enabled=? WHERE id=?""",
                values + (target_id,),
            )
            result = target_id
        else:
            cursor = self.connection.execute(
                """INSERT INTO sync_targets
                   (name, kind, database, table_name, sql, dest, key_column, schedule, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                values,
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_sync_target(self, target_id: int) -> None:
        self.connection.execute("DELETE FROM sync_targets WHERE id=?", (target_id,))
        self.connection.commit()

    def set_sync_target_last_run(self, target_id: int, ts: str) -> None:
        self.connection.execute(
            "UPDATE sync_targets SET last_run=? WHERE id=?", (ts, target_id)
        )
        self.connection.commit()

    # ----- Saved field mappings -----
    def save_field_mapping(
        self,
        name: str,
        schema_id: int | None,
        database: str,
        table: str,
        columns: list[dict],
    ) -> int:
        cursor = self.connection.execute(
            """INSERT INTO field_mappings (name, schema_id, database, table_name, columns)
               VALUES (?, ?, ?, ?, ?)""",
            (name.strip(), schema_id, database, table, json.dumps(columns)),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def field_mappings(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM field_mappings ORDER BY id DESC"
        ).fetchall()

    def delete_field_mapping(self, mapping_id: int) -> None:
        self.connection.execute("DELETE FROM field_mappings WHERE id=?", (mapping_id,))
        self.connection.commit()

    # ----- API sources -----
    def api_sources(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM api_sources ORDER BY name"
        ).fetchall()

    def api_source(self, api_source_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM api_sources WHERE id=?", (api_source_id,)
        ).fetchone()

    def save_api_source(self, payload: dict, api_source_id: int | None = None) -> int:
        values = (
            str(payload.get("name") or payload.get("url") or "API Source").strip(),
            str(payload.get("url") or "").strip(),
            str(payload.get("frequency") or "1h"),
            1 if payload.get("enabled", True) else 0,
        )
        if api_source_id:
            self.connection.execute(
                """UPDATE api_sources SET name=?, url=?, frequency=?, enabled=? WHERE id=?""",
                values + (api_source_id,),
            )
            result = api_source_id
        else:
            cursor = self.connection.execute(
                """INSERT INTO api_sources (name, url, frequency, enabled) VALUES (?, ?, ?, ?)""",
                values,
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def update_api_extraction_config(self, api_source_id: int, config: dict) -> None:
        self.connection.execute(
            "UPDATE api_sources SET extraction_config=? WHERE id=?",
            (json.dumps(config), api_source_id),
        )
        self.connection.commit()

    def delete_api_source(self, api_source_id: int) -> None:
        self.connection.execute("DELETE FROM api_sources WHERE id=?", (api_source_id,))
        self.connection.commit()

    def update_api_source_checked_time(self, api_source_id: int) -> None:
        from datetime import datetime

        now = datetime.now().isoformat()
        self.connection.execute(
            "UPDATE api_sources SET last_checked=? WHERE id=?",
            (now, api_source_id),
        )
        self.connection.commit()

    def api_snapshots(self, source_id: int) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM api_snapshots WHERE source_id=? ORDER BY id DESC",
            (source_id,),
        ).fetchall()

    def latest_api_snapshot(self, source_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM api_snapshots WHERE source_id=? ORDER BY id DESC LIMIT 1",
            (source_id,),
        ).fetchone()

    def api_snapshot(self, snapshot_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM api_snapshots WHERE id=?", (snapshot_id,)
        ).fetchone()

    def add_api_snapshot(
        self,
        source_id: int,
        content_hash: str,
        payload: str,
        previous_snapshot_id: int | None,
        changed: bool,
    ) -> int:
        cursor = self.connection.execute(
            """INSERT INTO api_snapshots
               (source_id, content_hash, payload, previous_snapshot_id, changed)
               VALUES (?, ?, ?, ?, ?)""",
            (
                source_id,
                content_hash,
                payload,
                previous_snapshot_id,
                1 if changed else 0,
            ),
        )
        self.connection.commit()
        self.prune_snapshots("api", 10)
        return int(cursor.lastrowid)

    # ----- Website monitoring -----
    def websites(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM websites ORDER BY name"
        ).fetchall()

    def website(self, website_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM websites WHERE id=?", (website_id,)
        ).fetchone()

    def save_website(self, payload: dict, website_id: int | None = None) -> int:
        options = payload.get("fetch_options") or {}
        if isinstance(options, str):
            options_json = options
        else:
            options_json = json.dumps(options)
        pipeline_id = payload.get("pipeline_id")
        if pipeline_id in ("", None):
            pipeline_id = None
        else:
            pipeline_id = int(pipeline_id)
        schema_id = payload.get("schema_id")
        if schema_id in ("", None):
            schema_id = None
        values = (
            str(payload.get("name") or payload.get("url") or "Website").strip(),
            str(payload.get("url") or "").strip(),
            str(payload.get("fetch_method") or "http"),
            str(payload.get("frequency") or "1h"),
            schema_id,
            str(payload.get("prompt") or ""),
            json.dumps(payload.get("destination") or {}),
            options_json,
            pipeline_id,
            1 if payload.get("enabled", True) else 0,
        )
        if website_id:
            self.connection.execute(
                """UPDATE websites SET name=?, url=?, fetch_method=?, frequency=?, schema_id=?,
                   prompt=?, destination=?, fetch_options=?, pipeline_id=?, enabled=? WHERE id=?""",
                values + (website_id,),
            )
            result = website_id
        else:
            cursor = self.connection.execute(
                """INSERT INTO websites
                   (name, url, fetch_method, frequency, schema_id, prompt, destination,
                    fetch_options, pipeline_id, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                values,
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_website(self, website_id: int) -> None:
        self.connection.execute("DELETE FROM websites WHERE id=?", (website_id,))
        self.connection.commit()

    def website_snapshots(
        self, source_id: int, include_body: bool = False
    ) -> list[sqlite3.Row]:
        cols = (
            "*"
            if include_body
            else (
                "id, source_id, fetched_at, content_hash, previous_snapshot_id, changed, "
                "backend, status_code, title, duration_ms, length(clean_text) AS text_length"
            )
        )
        return self.connection.execute(
            f"SELECT {cols} FROM website_snapshots WHERE source_id=? ORDER BY id DESC",
            (source_id,),
        ).fetchall()

    def website_snapshot(self, snapshot_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM website_snapshots WHERE id=?", (snapshot_id,)
        ).fetchone()

    def latest_website_snapshot(self, source_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM website_snapshots WHERE source_id=? ORDER BY id DESC LIMIT 1",
            (source_id,),
        ).fetchone()

    def add_website_snapshot(
        self,
        source_id: int,
        content_hash: str,
        raw_html: str,
        clean_text: str,
        previous_snapshot_id: int | None,
        changed: bool,
        backend: str = "",
        status_code: int | None = None,
        title: str = "",
        duration_ms: int | None = None,
    ) -> int:
        cursor = self.connection.execute(
            """INSERT INTO website_snapshots
               (source_id, content_hash, raw_html, clean_text, previous_snapshot_id, changed,
                backend, status_code, title, duration_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source_id,
                content_hash,
                raw_html,
                clean_text,
                previous_snapshot_id,
                1 if changed else 0,
                backend or "",
                status_code,
                title or "",
                duration_ms,
            ),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def touch_website_check(
        self,
        source_id: int,
        *,
        error: str = "",
        backend: str = "",
        status_code: int | None = None,
        duration_ms: int | None = None,
        changed: bool = False,
    ) -> None:
        self.connection.execute(
            """UPDATE websites SET
                 last_checked=CURRENT_TIMESTAMP,
                 last_changed=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_changed END,
                 last_error=?,
                 last_backend=?,
                 last_status_code=?,
                 last_duration_ms=?
               WHERE id=?""",
            (
                1 if changed else 0,
                error or "",
                backend or "",
                status_code,
                duration_ms,
                source_id,
            ),
        )
        self.connection.commit()

    def add_website_change(
        self,
        source_id: int,
        snapshot_id: int,
        previous_snapshot_id: int | None,
        diff: str,
        rows: str = "[]",
    ) -> int:
        cursor = self.connection.execute(
            """INSERT INTO website_changes (source_id, snapshot_id, previous_snapshot_id, diff, rows)
               VALUES (?, ?, ?, ?, ?)""",
            (source_id, snapshot_id, previous_snapshot_id, diff, rows or "[]"),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def website_change(self, change_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            """SELECT c.*, s.clean_text, s.raw_html, s.backend, s.title AS snapshot_title,
                      s.content_hash, prev.clean_text AS previous_text
               FROM website_changes c
               JOIN website_snapshots s ON s.id = c.snapshot_id
               LEFT JOIN website_snapshots prev ON prev.id = c.previous_snapshot_id
               WHERE c.id=?""",
            (change_id,),
        ).fetchone()

    def website_changes(
        self, source_id: int | None = None, status: str | None = None
    ) -> list[sqlite3.Row]:
        sql = "SELECT * FROM website_changes"
        clauses = []
        params: list = []
        if source_id is not None:
            clauses.append("source_id=?")
            params.append(source_id)
        if status:
            clauses.append("status=?")
            params.append(status)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY id DESC"
        return self.connection.execute(sql, params).fetchall()

    def pending_website_changes(self, source_id: int) -> list[sqlite3.Row]:
        return self.website_changes(source_id, status="pending")

    def pending_change_counts(self) -> dict[int, int]:
        rows = self.connection.execute(
            "SELECT source_id, COUNT(*) AS n FROM website_changes WHERE status='pending' GROUP BY source_id"
        ).fetchall()
        return {int(row["source_id"]): int(row["n"]) for row in rows}

    def snapshot_counts(self) -> dict[int, int]:
        rows = self.connection.execute(
            "SELECT source_id, COUNT(*) AS n FROM website_snapshots GROUP BY source_id"
        ).fetchall()
        return {int(row["source_id"]): int(row["n"]) for row in rows}

    def update_website_change(
        self, change_id: int, status: str, run_id: int | None = None
    ) -> None:
        if run_id is not None:
            self.connection.execute(
                "UPDATE website_changes SET status=?, run_id=?, processed_at=CASE WHEN ? IN ('processed','ignored') THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id=?",
                (status, run_id, status, change_id),
            )
        else:
            self.connection.execute(
                "UPDATE website_changes SET status=?, processed_at=CASE WHEN ? IN ('processed','ignored') THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id=?",
                (status, status, change_id),
            )
        self.connection.commit()

    def website_checks(self, source_id: int, limit: int = 50) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM website_checks WHERE source_id=? ORDER BY id DESC LIMIT ?",
            (source_id, limit),
        ).fetchall()

    # ----- Local vector documents -----
    def replace_chunks(self, document_id: str, chunks: list[dict]) -> None:
        self.connection.execute(
            "DELETE FROM document_chunks WHERE document_id=?", (document_id,)
        )
        for chunk in chunks:
            self.connection.execute(
                """INSERT INTO document_chunks
                   (document_id, chunk_id, source_url, article_url, article_title, source, published,
                    chunk_text, chunk_index, embedding_model, embedding_dimension, embedding)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    document_id,
                    chunk["chunk_id"],
                    chunk.get("source_url", ""),
                    chunk.get("article_url", ""),
                    chunk.get("article_title", ""),
                    chunk.get("source", ""),
                    chunk.get("published", ""),
                    chunk["chunk_text"],
                    chunk["chunk_index"],
                    chunk.get("embedding_model", ""),
                    chunk.get("embedding_dimension", 0),
                    json.dumps(chunk.get("embedding", [])),
                ),
            )
        self.connection.commit()

    def document_chunks(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM document_chunks ORDER BY id DESC"
        ).fetchall()

    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self.connection.execute(
            "SELECT value FROM settings WHERE key=?", (key,)
        ).fetchone()
        if row:
            try:
                return json.loads(row["value"])
            except Exception:
                return row["value"]
        return default

    def set_setting(self, key: str, value: Any) -> None:
        val_str = json.dumps(value)
        self.connection.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, val_str),
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()

    # ----- API configurations -----
    def api_configs(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM api_configs ORDER BY name"
        ).fetchall()

    def api_config(self, config_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM api_configs WHERE id=?", (config_id,)
        ).fetchone()

    def save_api_config(
        self,
        name: str,
        provider: str = "custom",
        endpoint: str = "",
        model: str = "",
        temperature: float | None = None,
        timeout: int = 60,
        extra: dict | None = None,
        config_id: int | None = None,
    ) -> int:
        payload = json.dumps(extra or {})
        if config_id:
            self.connection.execute(
                """UPDATE api_configs SET name=?, provider=?, endpoint=?, model=?, temperature=?, timeout=?, extra=?, updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (
                    name.strip(),
                    provider,
                    endpoint,
                    model,
                    temperature,
                    timeout,
                    payload,
                    config_id,
                ),
            )
            result = config_id
        else:
            cursor = self.connection.execute(
                "INSERT INTO api_configs(name, provider, endpoint, model, temperature, timeout, extra) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    name.strip(),
                    provider,
                    endpoint,
                    model,
                    temperature,
                    timeout,
                    payload,
                ),
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_api_config(self, config_id: int) -> None:
        self.connection.execute("DELETE FROM api_configs WHERE id=?", (config_id,))
        self.connection.commit()

    # ----- Prompt templates -----
    def prompt_templates(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM prompt_templates ORDER BY name"
        ).fetchall()

    def save_prompt_template(
        self,
        name: str,
        system_prompt: str = "",
        extraction_prompt: str = "",
        variables: list | None = None,
        schema_id: int | None = None,
        prompt_id: int | None = None,
    ) -> int:
        if prompt_id:
            self.connection.execute(
                """UPDATE prompt_templates SET name=?, system_prompt=?, extraction_prompt=?, variables=?, schema_id=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (
                    name.strip(),
                    system_prompt,
                    extraction_prompt,
                    json.dumps(variables or []),
                    schema_id,
                    prompt_id,
                ),
            )
            result = prompt_id
        else:
            cursor = self.connection.execute(
                "INSERT INTO prompt_templates(name, system_prompt, extraction_prompt, variables, schema_id) VALUES (?, ?, ?, ?, ?)",
                (
                    name.strip(),
                    system_prompt,
                    extraction_prompt,
                    json.dumps(variables or []),
                    schema_id,
                ),
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_prompt_template(self, prompt_id: int) -> None:
        self.connection.execute("DELETE FROM prompt_templates WHERE id=?", (prompt_id,))
        self.connection.commit()

    # ----- Schemas -----
    def schemas(self) -> list[sqlite3.Row]:
        return self.connection.execute("SELECT * FROM schemas ORDER BY name").fetchall()

    def save_schema(
        self,
        name: str,
        json_schema: object | None = None,
        fields: object | None = None,
        schema_id: int | None = None,
    ) -> int:
        def _coerce(v: object) -> str:
            if isinstance(v, str):
                return v
            return json.dumps(v if v is not None else {})

        js = _coerce(json_schema)
        fld = _coerce(fields)
        if schema_id:
            self.connection.execute(
                "UPDATE schemas SET name=?, json_schema=?, fields=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (name.strip(), js, fld, schema_id),
            )
            result = schema_id
        else:
            cursor = self.connection.execute(
                "INSERT INTO schemas(name, json_schema, fields) VALUES (?, ?, ?)",
                (name.strip(), js, fld),
            )
            result = int(cursor.lastrowid)
        self.connection.commit()
        return result

    def delete_schema(self, schema_id: int) -> None:
        self.connection.execute("DELETE FROM schemas WHERE id=?", (schema_id,))
        self.connection.commit()

    # ----- DuckDB databases -----
    def duckdb_databases(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM duckdb_databases ORDER BY name"
        ).fetchall()

    def save_duckdb_database(self, name: str, path: str, description: str = "") -> int:
        cursor = self.connection.execute(
            "INSERT INTO duckdb_databases(name, path, description) VALUES (?, ?, ?)",
            (name.strip(), path, description),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def touch_duckdb_database(self, db_id: int) -> None:
        self.connection.execute(
            "UPDATE duckdb_databases SET last_opened_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (db_id,),
        )
        self.connection.commit()

    def touch_duckdb_database_by_path(self, path: str) -> None:
        self.connection.execute(
            "UPDATE duckdb_databases SET last_opened_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE path=?",
            (str(path),),
        )
        self.connection.commit()

    def delete_duckdb_database(self, db_id: int) -> None:
        self.connection.execute("DELETE FROM duckdb_databases WHERE id=?", (db_id,))
        self.connection.commit()

    def update_duckdb_database(
        self,
        db_id: int,
        name: str | None = None,
        path: str | None = None,
        description: object | None = None,
    ) -> None:
        setters: list[str] = []
        params: list[object] = []
        if name is not None:
            setters.append("name=?")
            params.append(name.strip())
        if path is not None:
            setters.append("path=?")
            params.append(path)
        if description is not None:
            setters.append("description=?")
            params.append(description if isinstance(description, str) else "")
        setters.append("updated_at=CURRENT_TIMESTAMP")
        if not setters:
            return
        params.append(db_id)
        self.connection.execute(
            f"UPDATE duckdb_databases SET {', '.join(setters)} WHERE id=?",
            tuple(params),
        )
        self.connection.commit()

    def keywords(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM keywords ORDER BY word ASC"
        ).fetchall()

    def add_keyword(self, word: str, category: str = "general") -> int:
        cur = self.connection.execute(
            "INSERT INTO keywords (word, category) VALUES (?, ?)",
            (word.strip(), category.strip()),
        )
        self.connection.commit()
        return cur.lastrowid

    def delete_keyword(self, keyword_id: int) -> None:
        self.connection.execute("DELETE FROM keywords WHERE id=?", (keyword_id,))
        self.connection.commit()
