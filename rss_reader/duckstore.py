from __future__ import annotations

import hashlib
import json
import re
import csv
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

import duckdb

from .database import data_directory


_DB_LOCKS: dict[str, threading.Lock] = {}
_DB_LOCKS_GUARD = threading.Lock()


def _lock(path: str) -> threading.Lock:
    with _DB_LOCKS_GUARD:
        return _DB_LOCKS.setdefault(path, threading.Lock())


def _resolve_path(database: str) -> Path:
    p = Path(database).expanduser()
    if not p.is_absolute():
        p = data_directory() / database
    if p.suffix.lower() != ".duckdb":
        p = p.with_suffix(".duckdb")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


_DUCK_TYPES = {
    "string": "VARCHAR",
    "str": "VARCHAR",
    "text": "VARCHAR",
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
    "array": "VARCHAR",
    "list": "VARCHAR",
    "object": "JSON",
    "json": "JSON",
}


def duckdb_type(ftype: str) -> str:
    name = (ftype or "string").upper()
    if name in {
        "VARCHAR",
        "TEXT",
        "BIGINT",
        "INTEGER",
        "INT",
        "DOUBLE",
        "FLOAT",
        "REAL",
        "BOOLEAN",
        "BOOL",
        "DATE",
        "TIMESTAMP",
        "TIME",
        "JSON",
        "BLOB",
    }:
        return name
    return _DUCK_TYPES.get((ftype or "string").lower(), "VARCHAR")


def _coerce(value: Any, dtype: str) -> Any:
    if value is None:
        return None
    if dtype in ("JSON",):
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return value
    if (
        dtype in ("VARCHAR",)
        or dtype.startswith("TIMESTAMP")
        or dtype in ("DATE", "TIME")
    ):
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)
    if dtype == "BOOLEAN":
        if isinstance(value, str):
            return value.strip().lower() in ("true", "1", "yes")
        return bool(value)
    if dtype == "DOUBLE":
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if dtype == "BIGINT":
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None
    return str(value)


def _article_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


_META_COLUMNS = [
    ("article_id", "VARCHAR"),
    ("source_url", "VARCHAR"),
    ("feed_url", "VARCHAR"),
    ("article_url", "VARCHAR"),
    ("author", "VARCHAR"),
    ("published_at", "VARCHAR"),
    ("categories", "VARCHAR"),
    ("pipeline_id", "BIGINT"),
    ("run_id", "BIGINT"),
    ("snapshot_id", "VARCHAR"),
    ("source_type", "VARCHAR"),
    ("website_id", "BIGINT"),
    ("change_id", "BIGINT"),
    ("detected_at", "TIMESTAMP"),
    ("ingested_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
]


def write_records(
    database: str,
    table: str,
    records: list[dict],
    mappings: list[dict] | None = None,
    mode: str = "append",
    dedupe_key: str | None = None,
) -> dict:
    path = _resolve_path(database)
    with _lock(str(path)):
        con = duckdb.connect(str(path))
        try:
            user_cols = [
                (m["target"], duckdb_type(m.get("type", "string")))
                for m in mappings or []
                if m.get("target")
            ]
            user_names = {c[0] for c in user_cols}
            reserved = {
                "article_id",
                "ingested_at",
                "run_id",
                "pipeline_id",
                "snapshot_id",
                "source_type",
                "website_id",
                "change_id",
                "detected_at",
                "feed_url",
                "source_url",
                "article_url",
            }
            for name in user_names:
                if name in reserved:
                    raise ValueError(
                        f"Column '{name}' is reserved as a system column and cannot be mapped."
                    )
            meta_cols = [c for c in _META_COLUMNS if c[0] not in user_names]
            all_cols = list(user_cols) + meta_cols
            col_defs = ", ".join(f'"{n}" {t}' for n, t in all_cols)
            con.execute(f'CREATE TABLE IF NOT EXISTS "{table}" ({col_defs})')
            existing_cols = {
                row[0]
                for row in con.execute(
                    f"SELECT column_name FROM information_schema.columns WHERE table_name=?",
                    [table],
                ).fetchall()
            }
            for name, typ in all_cols:
                if name not in existing_cols:
                    try:
                        con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {typ}')
                        existing_cols.add(name)
                    except Exception:
                        pass
            if mode in ("replace", "overwrite"):
                con.execute(f'DELETE FROM "{table}"')

            names = [c[0] for c in all_cols]
            insert_names = [n for n in names if n != "ingested_at"]
            placeholders = ", ".join(["?"] * len(insert_names))
            col_sql = ", ".join(f'"{n}"' for n in insert_names)
            rows = []
            for r in records:
                row: dict[str, Any] = {}
                for m in mappings or []:
                    if not m.get("target"):
                        continue
                    val = r.get(m["source"])
                    if val is None:
                        val = m.get("default")
                    row[m["target"]] = _coerce(
                        val, duckdb_type(m.get("type", "string"))
                    )
                meta = r.get("_meta") or {}
                row["article_id"] = _article_id(
                    meta.get("url") or json.dumps(r, default=str)[:200]
                )
                if "source_url" not in user_names:
                    row["source_url"] = meta.get("url")
                if "feed_url" not in user_names:
                    row["feed_url"] = meta.get("feed_url")
                if "article_url" not in user_names:
                    row["article_url"] = meta.get("article_url")
                if "author" not in user_names:
                    row["author"] = meta.get("author")
                if "published_at" not in user_names:
                    row["published_at"] = meta.get("published")
                if "categories" not in user_names:
                    cats = meta.get("categories")
                    row["categories"] = (
                        json.dumps(cats) if isinstance(cats, list) else (cats or None)
                    )
                if "pipeline_id" not in user_names:
                    row["pipeline_id"] = meta.get("pipeline_id")
                if "run_id" not in user_names:
                    row["run_id"] = meta.get("run_id")
                if "snapshot_id" not in user_names:
                    row["snapshot_id"] = meta.get("snapshot_id")
                if "source_type" not in user_names:
                    row["source_type"] = meta.get("source_type")
                if "website_id" not in user_names:
                    row["website_id"] = meta.get("website_id")
                if "change_id" not in user_names:
                    row["change_id"] = meta.get("change_id")
                if "detected_at" not in user_names:
                    row["detected_at"] = meta.get("detected_at")
                rows.append(tuple(row.get(n) for n in insert_names))

            key_sources = []
            if isinstance(dedupe_key, (list, tuple)):
                key_sources = [str(k) for k in dedupe_key]
            elif dedupe_key:
                key_sources = [
                    part.strip() for part in str(dedupe_key).split(",") if part.strip()
                ]
            key_targets = [
                next(
                    (
                        m["target"]
                        for m in mappings or []
                        if m.get("source") == src and m.get("target")
                    ),
                    None,
                )
                for src in key_sources
            ]
            key_targets = [t for t in key_targets if t]

            if key_targets:
                existing: set[tuple] = set()
                for (value,) in con.execute(
                    f'SELECT DISTINCT {", ".join(f'"{t}"' for t in key_targets)} FROM "{table}"'
                ).fetchall():
                    existing.add(tuple(value) if isinstance(value, tuple) else (value,))
                new_keys = [
                    tuple(row[insert_names.index(t)] for t in key_targets)
                    for row in rows
                ]
                if mode == "upsert":
                    stale = {key for key in new_keys if key in existing}
                    if stale and key_targets:
                        for key in stale:
                            condition = " AND ".join(f'"{t}" = ?' for t in key_targets)
                            con.execute(
                                f'DELETE FROM "{table}" WHERE {condition}', list(key)
                            )
                    rows = rows
                else:
                    rows = [
                        row for row, key in zip(rows, new_keys) if key not in existing
                    ]

            if rows:
                con.executemany(
                    f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders})', rows
                )
            con.commit()
            return {
                "type": "duckdb",
                "path": str(path),
                "table": table,
                "records": len(rows),
                "replaced": 0,
            }
        finally:
            con.close()


def create_table(
    database: str,
    table: str,
    columns: list[dict],
    include_meta: bool = False,
) -> dict:
    path = _resolve_path(database)
    with _lock(str(path)):
        con = duckdb.connect(str(path))
        try:
            cols = [
                (c["name"], duckdb_type(c.get("type", "VARCHAR")))
                for c in columns
                if c.get("name")
            ]
            if include_meta:
                meta_names = {c[0] for c in cols}
                cols = cols + [c for c in _META_COLUMNS if c[0] not in meta_names]
            if not cols:
                raise ValueError("No columns defined")
            col_defs = ", ".join(f'"{n}" {t}' for n, t in cols)
            con.execute(f'CREATE TABLE IF NOT EXISTS "{table}" ({col_defs})')
            con.commit()
            return {"table": table, "columns": [c[0] for c in cols]}
        finally:
            con.close()


def query(database: str, sql: str, readonly: bool = True, timeout: int = 30) -> dict:
    path = _resolve_path(database)
    if not path.exists():
        return {
            "columns": [],
            "rows": [],
            "row_count": 0,
            "error": "Database not found",
        }
    con = duckdb.connect(str(path), read_only=readonly)
    try:
        result = con.execute(sql)
        if result.description is None:
            return {"columns": [], "rows": [], "row_count": 0}
        columns = [d[0] for d in result.description]
        fetched = result.fetchall()
        rows = [[_jsonify(v) for v in row] for row in fetched]
        return {"columns": columns, "rows": rows, "row_count": len(rows)}
    finally:
        con.close()


def fetch_dicts(
    database: str, table: str | None = None, sql: str | None = None, limit: int = 200
) -> list[dict[str, Any]]:
    if sql and sql.strip():
        query_sql = sql.strip().rstrip(";")
    elif table:
        if not _valid_ident(table):
            raise ValueError("Invalid table name")
        query_sql = f'SELECT * FROM "{table}" LIMIT {max(1, int(limit))}'
    else:
        raise ValueError("table or sql is required")
    result = query(database, query_sql, readonly=True)
    if result.get("error"):
        raise ValueError(result["error"])
    columns = result.get("columns") or []
    return [dict(zip(columns, row)) for row in (result.get("rows") or [])]


def _jsonify(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def list_tables(database: str) -> list[dict]:
    path = _resolve_path(database)
    if not path.exists():
        return []
    con = duckdb.connect(str(path), read_only=True)
    try:
        tables = con.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
        ).fetchall()
        out = []
        for (name,) in tables:
            try:
                cnt = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            except Exception:
                cnt = None
            columns: list[dict] = []
            try:
                rows = con.execute(f'DESCRIBE "{name}"').fetchall()
                columns = [{"column": r[0], "type": r[1], "null": r[2]} for r in rows]
            except Exception:
                columns = []
            out.append(
                {
                    "name": name,
                    "rows": cnt,
                    "columns": len(columns),
                    "schema": columns,
                }
            )
        return out
    finally:
        con.close()


def table_schema(database: str, table: str) -> list[dict]:
    path = _resolve_path(database)
    if not path.exists():
        return []
    con = duckdb.connect(str(path), read_only=True)
    try:
        rows = con.execute(f'DESCRIBE "{table}"').fetchall()
        return [{"column": r[0], "type": r[1], "null": r[2]} for r in rows]
    finally:
        con.close()


def table_preview(database: str, table: str, limit: int = 100, offset: int = 0) -> dict:
    order = ""
    try:
        cols = table_schema(database, table)
        if any((c.get("column") or "") == "ingested_at" for c in cols):
            order = " ORDER BY ingested_at DESC NULLS LAST"
    except Exception:
        order = ""
    path = _resolve_path(database)
    total_rows = 0
    if path.exists():
        con = duckdb.connect(str(path), read_only=True)
        try:
            total_rows = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        except Exception:
            total_rows = 0
        finally:
            con.close()
    result = query(
        database,
        f'SELECT * FROM "{table}"{order} LIMIT {int(limit)} OFFSET {int(offset)}',
    )
    result["total_rows"] = total_rows
    result["offset"] = int(offset)
    result["limit"] = int(limit)
    return result


def database_info(database: str) -> dict:
    path = _resolve_path(database)
    info: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
        "file_size_bytes": None,
        "file_created_at": None,
        "file_modified_at": None,
        "table_count": 0,
        "total_rows": 0,
        "tables": [],
    }
    if not path.exists():
        return info
    stat = path.stat()
    info["file_size_bytes"] = stat.st_size
    info["file_created_at"] = datetime.fromtimestamp(stat.st_ctime).isoformat(
        timespec="seconds"
    )
    info["file_modified_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat(
        timespec="seconds"
    )
    tables = list_tables(database)
    info["tables"] = tables
    info["table_count"] = len(tables)
    info["total_rows"] = sum(int(t.get("rows") or 0) for t in tables)
    return info


def _valid_ident(name: str) -> bool:
    return (
        bool(name) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name or "") is not None
    )


def drop_table(database: str, table: str) -> dict:
    if not _valid_ident(table):
        raise ValueError("Invalid table name")
    path = _resolve_path(database)
    with _lock(str(path)):
        con = duckdb.connect(str(path))
        try:
            con.execute(f'DROP TABLE IF EXISTS "{table}"')
            return {"ok": True, "table": table}
        finally:
            con.close()


def rename_table(database: str, table: str, new_name: str) -> dict:
    if not _valid_ident(table) or not _valid_ident(new_name):
        raise ValueError("Invalid table name")
    path = _resolve_path(database)
    with _lock(str(path)):
        con = duckdb.connect(str(path))
        try:
            con.execute(f'ALTER TABLE "{table}" RENAME TO "{new_name}"')
            return {"ok": True, "table": new_name}
        finally:
            con.close()


def export_table(
    database: str, table: str, destination: str, fmt: str, sql: str | None = None
) -> dict:
    """Export a table or filtered query using DuckDB's native readers/writers."""
    path = _resolve_path(database)
    target = Path(destination).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    query_sql = sql or f'SELECT * FROM "{table}"'
    with _lock(str(path)):
        con = duckdb.connect(str(path), read_only=True)
        try:
            count = con.execute(
                f"SELECT COUNT(*) FROM ({query_sql}) AS export_rows"
            ).fetchone()[0]
            if fmt == "parquet":
                con.execute(f"COPY ({query_sql}) TO ? (FORMAT PARQUET)", [str(target)])
            elif fmt == "csv":
                con.execute(
                    f"COPY ({query_sql}) TO ? (HEADER, DELIMITER ',')", [str(target)]
                )
            elif fmt == "json":
                con.execute(
                    f"COPY ({query_sql}) TO ? (FORMAT JSON, ARRAY true)", [str(target)]
                )
            elif fmt == "sqlite":
                columns = [
                    item[0]
                    for item in con.execute(
                        f"SELECT * FROM ({query_sql}) AS export_rows LIMIT 0"
                    ).description
                ]
                rows = con.execute(query_sql).fetchall()
                sqlite = sqlite3.connect(target)
                sqlite.execute(
                    f'CREATE TABLE IF NOT EXISTS "{table}" ({", ".join(f"{c!r} TEXT" for c in columns)})'
                )
                sqlite.executemany(
                    f'INSERT INTO "{table}" VALUES ({", ".join("?" for _ in columns)})',
                    [[None if v is None else str(v) for v in row] for row in rows],
                )
                sqlite.commit()
                sqlite.close()
            else:
                raise ValueError("Unsupported export format")
            return {
                "format": fmt,
                "path": str(target),
                "rows": int(count),
                "columns": columns if fmt == "sqlite" else [],
            }
        finally:
            con.close()


def read_table(
    database: str, table: str, limit: int | None = None
) -> tuple[list[str], list[tuple]]:
    path = _resolve_path(database)
    with _lock(str(path)):
        con = duckdb.connect(str(path), read_only=True)
        try:
            query = f'SELECT * FROM "{table}"' + (
                f" LIMIT {int(limit)}" if limit else ""
            )
            result = con.execute(query)
            return [item[0] for item in result.description], result.fetchall()
        finally:
            con.close()


def import_file(database: str, table: str, file_path: str) -> dict:
    path = _resolve_path(database)
    with _lock(str(path)):
        con = duckdb.connect(str(path))
        try:
            fp = Path(file_path)
            if fp.suffix.lower() == ".json":
                con.execute(
                    f'CREATE OR REPLACE TABLE "{table}" AS SELECT * FROM read_json_auto(?)',
                    [str(fp)],
                )
            elif fp.suffix.lower() == ".parquet":
                con.execute(
                    f'CREATE OR REPLACE TABLE "{table}" AS SELECT * FROM read_parquet(?)',
                    [str(fp)],
                )
            else:
                con.execute(
                    f'CREATE OR REPLACE TABLE "{table}" AS SELECT * FROM read_csv_auto(?, header=true)',
                    [str(fp)],
                )
            cnt = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            con.commit()
            return {"table": table, "rows": cnt}
        finally:
            con.close()


def find_record_by_url(databases: list[str], url: str) -> dict | None:
    for db_name in databases:
        path = _resolve_path(db_name)
        if not path.exists():
            continue
        try:
            con = duckdb.connect(str(path), read_only=True)
        except Exception:
            continue
        try:
            tables = con.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
            ).fetchall()
            for (table_name,) in tables:
                try:
                    cols = [
                        c[0].lower()
                        for c in con.execute(f'DESCRIBE "{table_name}"').fetchall()
                    ]
                except Exception:
                    continue
                url_col = None
                for candidate in ["source_url", "article_url", "url"]:
                    if candidate in cols:
                        url_col = candidate
                        break
                if not url_col:
                    continue
                try:
                    res = con.execute(
                        f'SELECT * FROM "{table_name}" WHERE "{url_col}" = ? LIMIT 1',
                        [url],
                    )
                    row = res.fetchone()
                    if row:
                        columns = [d[0] for d in res.description]
                        record = {
                            columns[i]: _jsonify(row[i]) for i in range(len(columns))
                        }
                        record["_database_name"] = db_name
                        record["_table_name"] = table_name
                        return record
                except Exception:
                    pass
        finally:
            con.close()
    return None


def search_duckdb_records(
    databases: list[str],
    query: str,
    keywords: str = "",
    table_name: str | None = None,
    column_filters: dict[str, str] | None = None,
) -> list[dict]:
    search_terms = []
    if query.strip():
        search_terms.append(query.strip().lower())
    if keywords.strip():
        for kw in keywords.split(","):
            if kw.strip():
                search_terms.append(kw.strip().lower())
    if not search_terms and not column_filters:
        return []

    results = []
    for db_name in databases:
        path = _resolve_path(db_name)
        if not path.exists():
            continue
        try:
            con = duckdb.connect(str(path), read_only=True)
        except Exception:
            continue
        try:
            if table_name:
                tables = [(table_name,)]
            else:
                tables = con.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
                ).fetchall()
            for (curr_table,) in tables:
                try:
                    cols_desc = con.execute(f'DESCRIBE "{curr_table}"').fetchall()
                except Exception:
                    continue

                text_cols = []
                for col in cols_desc:
                    cname, ctype = col[0], col[1]
                    if ctype in ("VARCHAR", "TEXT", "JSON"):
                        text_cols.append(cname)

                if not text_cols:
                    continue

                clauses = []
                params = []
                if search_terms:
                    for term in search_terms:
                        term_clauses = []
                        for col in text_cols:
                            term_clauses.append(f'"{col}" ILIKE ?')
                            params.append(f"%{term}%")
                        clauses.append("(" + " OR ".join(term_clauses) + ")")

                if column_filters:
                    for filter_col, filter_val in column_filters.items():
                        if filter_val.strip():
                            # check if column exists
                            col_exists = any(c[0] == filter_col for c in cols_desc)
                            if col_exists:
                                clauses.append(
                                    f'CAST("{filter_col}" AS VARCHAR) ILIKE ?'
                                )
                                params.append(f"%{filter_val.strip()}%")

                if not clauses:
                    continue

                sql_where = " AND ".join(clauses)
                sql_query = f'SELECT * FROM "{curr_table}" WHERE {sql_where} LIMIT 50'

                try:
                    res = con.execute(sql_query, params)
                    rows = res.fetchall()
                    if rows:
                        columns = [d[0] for d in res.description]
                        for idx, row in enumerate(rows):
                            record = {
                                columns[i]: _jsonify(row[i])
                                for i in range(len(columns))
                            }
                            record["_database_name"] = db_name
                            record["_table_name"] = curr_table

                            title = (
                                record.get("article_title")
                                or record.get("title")
                                or record.get("name")
                                or f"Record #{idx + 1}"
                            )
                            url = (
                                record.get("article_url")
                                or record.get("source_url")
                                or record.get("url")
                                or ""
                            )
                            source = (
                                record.get("source")
                                or record.get("feed_url")
                                or f"{db_name} > {table_name}"
                            )
                            published = (
                                record.get("published_at")
                                or record.get("published")
                                or record.get("date")
                                or ""
                            )

                            text_preview_parts = []
                            for col in text_cols:
                                if col not in (
                                    "source_url",
                                    "article_url",
                                    "url",
                                    "_database_name",
                                    "_table_name",
                                ):
                                    val = record.get(col)
                                    if val and len(str(val)) > 10:
                                        text_preview_parts.append(f"{col}: {val}")

                            text_preview = (
                                "\n".join(text_preview_parts)
                                if text_preview_parts
                                else str(record)
                            )

                            results.append(
                                {
                                    "chunk_id": f"duckdb:{db_name}:{table_name}:{idx}",
                                    "source_url": url,
                                    "article_url": url,
                                    "article_title": str(title),
                                    "source": str(source),
                                    "published": str(published),
                                    "chunk_text": text_preview,
                                    "relevance": 1.0,
                                    "duckdb_record": record,
                                }
                            )
                except Exception:
                    pass
        finally:
            con.close()
    return results


def ensure_registered(database: Any, path: str, name: str | None = None, description: str = "") -> None:
    """Register a DuckDB file in the app catalog if it is not already listed."""
    if not path:
        return
    abs_path = str(_resolve_path(path))
    existing = {str(_resolve_path(row["path"])) for row in database.duckdb_databases()}
    if abs_path in existing:
        return
    label = name or Path(path).stem.replace("_", " ").title() or "DuckDB"
    database.save_duckdb_database(label, path, description or "Auto-registered")


def discover_and_register(database: Any) -> None:
    """Pick up DuckDB files on disk and pipeline output paths so Exports/DuckDB stay in sync."""
    for file in sorted(data_directory().glob("*.duckdb")):
        if file.is_file():
            ensure_registered(database, str(file), file.stem)
    for row in database.pipelines():
        try:
            definition = json.loads(row["definition"] or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        output = definition.get("output") or {}
        if output.get("type", "duckdb") == "duckdb" and output.get("database"):
            resolved = _resolve_path(output["database"])
            if resolved.exists():
                ensure_registered(database, output["database"])
        dest = (definition.get("snapshot") or {}).get("dest") or {}
        if dest.get("database") and _resolve_path(dest["database"]).exists():
            ensure_registered(database, dest["database"])
