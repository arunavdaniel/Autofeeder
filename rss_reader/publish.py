from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse, unquote
from xml.sax.saxutils import escape as xml_escape

from . import duckstore

_SLUG_RE = re.compile(r"[^a-z0-9]+")

SYNC_KINDS = {
    "sqlite": {"id": "sqlite", "label": "SQLite file", "needs": "path", "install": None,
               "placeholder": "/tmp/autofeeder-sync.sqlite3"},
    "postgres": {"id": "postgres", "label": "Postgres", "needs": "dsn", "install": "pip install 'psycopg[binary]'",
                 "placeholder": "postgresql://user:pass@localhost:5432/news"},
    "mysql": {"id": "mysql", "label": "MySQL / MariaDB", "needs": "dsn", "install": "pip install pymysql",
              "placeholder": "mysql://user:pass@localhost:3306/news"},
    "mssql": {"id": "mssql", "label": "Microsoft SQL Server", "needs": "dsn", "install": "pip install pymssql",
              "placeholder": "mssql://user:pass@localhost:1433/news"},
    "oracle": {"id": "oracle", "label": "Oracle", "needs": "dsn", "install": "pip install oracledb",
               "placeholder": "oracle://user:pass@localhost:1521/ORCL"},
}


def slugify(value: str) -> str:
    slug = _SLUG_RE.sub("-", (value or "").strip().lower()).strip("-")[:48]
    return slug or "feed"


def _pick(row: dict[str, Any], mapping: dict[str, str], field: str, *fallbacks: str) -> str:
    key = (mapping.get(field) or "").strip()
    if key and row.get(key) not in (None, ""):
        return str(row[key])
    for name in fallbacks:
        if row.get(name) not in (None, ""):
            return str(row[name])
    return ""


def rows_to_rss(
    *,
    title: str,
    feed_link: str,
    items: list[dict[str, Any]],
    mapping: dict[str, str] | None = None,
) -> str:
    mapping = mapping or {}
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "<channel>",
        f"<title>{xml_escape(title)}</title>",
        f"<link>{xml_escape(feed_link)}</link>",
        f"<description>{xml_escape(title)}</description>",
        f"<lastBuildDate>{datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')}</lastBuildDate>",
    ]
    for row in items:
        item_title = _pick(row, mapping, "title", "title", "name", "headline")
        link = _pick(row, mapping, "link", "url", "article_url", "link", "href")
        description = _pick(row, mapping, "description", "description", "text", "summary", "body")
        published = _pick(row, mapping, "published", "published", "ingested_at", "created_at")
        guid = _pick(row, mapping, "guid", "url", "article_url") or link or item_title
        parts.append("<item>")
        parts.append(f"<title>{xml_escape(item_title or link or 'Untitled')}</title>")
        if link:
            parts.append(f"<link>{xml_escape(link)}</link>")
        parts.append(f"<guid isPermaLink=\"{'true' if link else 'false'}\">{xml_escape(guid)}</guid>")
        if published:
            parts.append(f"<pubDate>{xml_escape(published)}</pubDate>")
        if description:
            parts.append(f"<description>{xml_escape(description[:4000])}</description>")
        parts.append("</item>")
    parts.extend(["</channel>", "</rss>"])
    return "\n".join(parts)


def channel_payload(channel: dict[str, Any], *, limit: int = 100) -> tuple[list[dict[str, Any]], dict[str, str]]:
    mapping = channel.get("mapping") or {}
    if isinstance(mapping, str):
        mapping = json.loads(mapping or "{}")
    rows = duckstore.fetch_dicts(
        channel["database"],
        channel.get("table") or None,
        channel.get("sql") or None,
        limit=limit,
    )
    return rows, mapping


def render_channel(channel: dict[str, Any], kind: str, public_base: str) -> tuple[str, str]:
    rows, mapping = channel_payload(channel)
    slug = channel["slug"]
    title = channel.get("name") or slug
    if kind == "rss":
        xml = rows_to_rss(
            title=title,
            feed_link=f"{public_base.rstrip('/')}/p/{slug}.xml",
            items=rows,
            mapping=mapping,
        )
        return xml, "application/rss+xml; charset=utf-8"
    body = json.dumps({"slug": slug, "name": title, "count": len(rows), "items": rows}, ensure_ascii=False)
    return body, "application/json; charset=utf-8"


def check_publish_key(channel: dict[str, Any], provided: str | None) -> bool:
    expected = str(channel.get("api_key") or "").strip()
    if not expected:
        return True
    return (provided or "").strip() == expected


def _ident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name or ""):
        raise ValueError(f"Invalid column name: {name}")
    return name


def parse_dsn(dsn: str) -> dict[str, Any]:
    parsed = urlparse((dsn or "").strip())
    database = unquote((parsed.path or "").lstrip("/"))
    if not parsed.hostname:
        raise ValueError("DSN must include a host, e.g. mysql://user:pass@localhost:3306/dbname")
    return {
        "scheme": (parsed.scheme or "").lower(),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname,
        "port": parsed.port,
        "database": database,
    }


def _values(row: dict[str, Any], columns: list[str]) -> list[Any]:
    return [None if row.get(c) is None else str(row.get(c)) for c in columns]


def _layout(rows: list[dict[str, Any]], table: str, key: str) -> tuple[str, str, list[str]]:
    table = _ident(table)
    key = _ident(key)
    columns = [_ident(c) for c in rows[0].keys()]
    if key not in columns:
        raise ValueError(f"Key column {key} is not in the exported rows")
    return table, key, columns


def upsert_sqlite(path: str, table: str, rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    if not rows:
        return {"rows": 0, "path": path, "table": table, "kind": "sqlite"}
    table, key, columns = _layout(rows, table, key)
    dest = sqlite3.connect(path)
    try:
        dest.execute(
            f'CREATE TABLE IF NOT EXISTS "{table}" ({", ".join(f"{c} TEXT" for c in columns)})'
        )
        dest.execute(
            f'CREATE UNIQUE INDEX IF NOT EXISTS "{table}_{key}_uidx" ON "{table}"("{key}")'
        )
        placeholders = ", ".join("?" for _ in columns)
        assignments = ", ".join(f'"{c}"=excluded."{c}"' for c in columns if c != key)
        sql = (
            f'INSERT INTO "{table}" ({", ".join(f"{c}" for c in columns)}) VALUES ({placeholders}) '
            f'ON CONFLICT("{key}") DO UPDATE SET {assignments}'
        )
        for row in rows:
            dest.execute(sql, _values(row, columns))
        dest.commit()
    finally:
        dest.close()
    return {"rows": len(rows), "path": path, "table": table, "kind": "sqlite"}


def upsert_postgres(dsn: str, table: str, rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    try:
        import psycopg
    except ImportError as exc:
        raise ValueError("Postgres sync needs psycopg. Install with: pip install 'psycopg[binary]'") from exc
    if not rows:
        return {"rows": 0, "table": table, "kind": "postgres"}
    parsed = urlparse(dsn)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("Postgres DSN must start with postgresql://")
    table, key, columns = _layout(rows, table, key)
    col_sql = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join("%s" for _ in columns)
    assignments = ", ".join(f'"{c}"=EXCLUDED."{c}"' for c in columns if c != key)
    create_cols = ", ".join(f'"{c}" TEXT' for c in columns)
    sql = (
        f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders}) '
        f'ON CONFLICT ("{key}") DO UPDATE SET {assignments}'
    )
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(f'CREATE TABLE IF NOT EXISTS "{table}" ({create_cols}, UNIQUE ("{key}"))')
            for row in rows:
                cur.execute(sql, _values(row, columns))
        conn.commit()
    return {"rows": len(rows), "table": table, "kind": "postgres"}


def upsert_mysql(dsn: str, table: str, rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    try:
        import pymysql
    except ImportError as exc:
        raise ValueError("MySQL sync needs pymysql. Install with: pip install pymysql") from exc
    if not rows:
        return {"rows": 0, "table": table, "kind": "mysql"}
    parsed = parse_dsn(dsn)
    if parsed["scheme"] not in {"mysql", "mariadb"}:
        raise ValueError("MySQL DSN must start with mysql://")
    table, key, columns = _layout(rows, table, key)
    q = lambda name: f"`{name}`"
    col_sql = ", ".join(q(c) for c in columns)
    placeholders = ", ".join("%s" for _ in columns)
    assignments = ", ".join(f"{q(c)}=VALUES({q(c)})" for c in columns if c != key)
    create_cols = ", ".join(
        f"{q(c)} VARCHAR(512)" if c == key else f"{q(c)} LONGTEXT" for c in columns
    )
    conn = pymysql.connect(
        host=parsed["host"],
        user=parsed["user"],
        password=parsed["password"],
        database=parsed["database"],
        port=int(parsed["port"] or 3306),
        charset="utf8mb4",
        autocommit=False,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE TABLE IF NOT EXISTS {q(table)} ({create_cols}, UNIQUE ({q(key)}))"
            )
            sql = (
                f"INSERT INTO {q(table)} ({col_sql}) VALUES ({placeholders}) "
                f"ON DUPLICATE KEY UPDATE {assignments}"
            )
            for row in rows:
                cur.execute(sql, _values(row, columns))
        conn.commit()
    finally:
        conn.close()
    return {"rows": len(rows), "table": table, "kind": "mysql"}


def upsert_mssql(dsn: str, table: str, rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    try:
        import pymssql
    except ImportError as exc:
        raise ValueError("SQL Server sync needs pymssql. Install with: pip install pymssql") from exc
    if not rows:
        return {"rows": 0, "table": table, "kind": "mssql"}
    parsed = parse_dsn(dsn)
    if parsed["scheme"] not in {"mssql", "sqlserver"}:
        raise ValueError("SQL Server DSN must start with mssql://")
    table, key, columns = _layout(rows, table, key)
    q = lambda name: f"[{name}]"
    create_cols = ", ".join(
        f"{q(c)} NVARCHAR(450)" if c == key else f"{q(c)} NVARCHAR(MAX)" for c in columns
    )
    using_cols = ", ".join(f"%s AS {q(c)}" for c in columns)
    on_clause = f"target.{q(key)} = source.{q(key)}"
    updates = ", ".join(f"target.{q(c)} = source.{q(c)}" for c in columns if c != key)
    insert_cols = ", ".join(q(c) for c in columns)
    insert_vals = ", ".join(f"source.{q(c)}" for c in columns)
    merge = (
        f"MERGE {q(table)} AS target "
        f"USING (SELECT {using_cols}) AS source "
        f"ON ({on_clause}) "
        f"WHEN MATCHED THEN UPDATE SET {updates} "
        f"WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals});"
    )
    conn = pymssql.connect(
        server=parsed["host"],
        user=parsed["user"],
        password=parsed["password"],
        database=parsed["database"],
        port=int(parsed["port"] or 1433),
    )
    try:
        cur = conn.cursor()
        cur.execute(
            f"IF OBJECT_ID(N'{table}', N'U') IS NULL CREATE TABLE {q(table)} ({create_cols})"
        )
        cur.execute(
            f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'{table}_{key}_uidx') "
            f"CREATE UNIQUE INDEX [{table}_{key}_uidx] ON {q(table)} ({q(key)})"
        )
        for row in rows:
            cur.execute(merge, tuple(_values(row, columns)))
        conn.commit()
        cur.close()
    finally:
        conn.close()
    return {"rows": len(rows), "table": table, "kind": "mssql"}


def upsert_oracle(dsn: str, table: str, rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    try:
        import oracledb
    except ImportError as exc:
        raise ValueError("Oracle sync needs oracledb. Install with: pip install oracledb") from exc
    if not rows:
        return {"rows": 0, "table": table, "kind": "oracle"}
    parsed = parse_dsn(dsn)
    if parsed["scheme"] not in {"oracle", "oracledb"}:
        raise ValueError("Oracle DSN must start with oracle://")
    table, key, columns = _layout(rows, table, key)
    q = lambda name: f'"{name}"'
    create_cols = ", ".join(
        f"{q(c)} VARCHAR2(512)" if c == key else f"{q(c)} VARCHAR2(4000)" for c in columns
    )
    binds = ", ".join(f":{i + 1} AS {q(c)}" for i, c in enumerate(columns))
    updates = ", ".join(f"t.{q(c)} = s.{q(c)}" for c in columns if c != key)
    insert_cols = ", ".join(q(c) for c in columns)
    insert_vals = ", ".join(f"s.{q(c)}" for c in columns)
    merge = (
        f"MERGE INTO {q(table)} t "
        f"USING (SELECT {binds} FROM dual) s "
        f"ON (t.{q(key)} = s.{q(key)}) "
        f"WHEN MATCHED THEN UPDATE SET {updates} "
        f"WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals})"
    )
    port = int(parsed["port"] or 1521)
    service = parsed["database"] or "ORCL"
    conn = oracledb.connect(
        user=parsed["user"],
        password=parsed["password"],
        dsn=f"{parsed['host']}:{port}/{service}",
    )
    try:
        cur = conn.cursor()
        cur.execute(
            "BEGIN "
            f"EXECUTE IMMEDIATE 'CREATE TABLE {q(table)} ({create_cols})'; "
            "EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; "
            "END;"
        )
        cur.execute(
            "BEGIN "
            f"EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX \"{table}_{key}_uidx\" ON {q(table)} ({q(key)})'; "
            "EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; "
            "END;"
        )
        for row in rows:
            cur.execute(merge, _values(row, columns))
        conn.commit()
        cur.close()
    finally:
        conn.close()
    return {"rows": len(rows), "table": table, "kind": "oracle"}


def run_sync_target(target: dict[str, Any]) -> dict[str, Any]:
    dest = target.get("dest") or {}
    if isinstance(dest, str):
        dest = json.loads(dest or "{}")
    kind = str(target.get("kind") or dest.get("kind") or "sqlite").lower()
    if kind not in SYNC_KINDS:
        raise ValueError(f"Unknown sync target {kind}")
    rows = duckstore.fetch_dicts(
        target["database"],
        target.get("table") or None,
        target.get("sql") or None,
        limit=int(target.get("limit") or 5000),
    )
    key = str(target.get("key_column") or dest.get("key") or "url")
    table = str(dest.get("table") or target.get("table") or "articles")
    dsn = str(dest.get("dsn") or dest.get("url") or "")
    if kind == "sqlite":
        path = str(dest.get("path") or "")
        if not path:
            raise ValueError("SQLite path is required")
        return upsert_sqlite(path, table, rows, key)
    if not dsn:
        raise ValueError(f"{SYNC_KINDS[kind]['label']} DSN is required")
    if kind == "postgres":
        return upsert_postgres(dsn, table, rows, key)
    if kind == "mysql":
        return upsert_mysql(dsn, table, rows, key)
    if kind == "mssql":
        return upsert_mssql(dsn, table, rows, key)
    return upsert_oracle(dsn, table, rows, key)
