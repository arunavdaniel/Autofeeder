from __future__ import annotations

import os
import json
import sqlite3
import sys
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
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self._create_schema()

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
            """
        )
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

    def close(self) -> None:
        self.connection.close()
