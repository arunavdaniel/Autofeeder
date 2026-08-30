from pathlib import Path

from rss_reader import publish
from rss_reader.database import Database
from rss_reader.web import create_app


def test_parse_dsn_and_unknown_kind():
    parsed = publish.parse_dsn("mysql://alice:s3cret@db.internal:3307/news")
    assert parsed["host"] == "db.internal"
    assert parsed["port"] == 3307
    assert parsed["user"] == "alice"
    assert parsed["database"] == "news"
    oracle = publish.parse_dsn("oracle://system:pw@localhost:1521/XEPDB1")
    assert oracle["database"] == "XEPDB1"
    mssql = publish.parse_dsn("mssql://sa:pw@localhost:1433/master")
    assert mssql["scheme"] == "mssql"
    try:
        publish.run_sync_target({"kind": "mongo", "database": "x", "table": "t", "dest": {}})
        raise AssertionError("should have failed")
    except ValueError as exc:
        assert "Unknown" in str(exc) or "mongo" in str(exc)


def test_rows_to_rss_and_sqlite_upsert(tmp_path):
    xml = publish.rows_to_rss(
        title="Watchlist",
        feed_link="http://127.0.0.1:8765/p/watchlist.xml",
        items=[{"title": "Hello", "url": "https://example.com/a", "text": "Body"}],
        mapping={},
    )
    assert "<title>Hello</title>" in xml
    assert "https://example.com/a" in xml

    dest = tmp_path / "out.sqlite3"
    result = publish.upsert_sqlite(
        str(dest),
        "articles",
        [{"url": "https://example.com/a", "title": "Hello"}, {"url": "https://example.com/a", "title": "Hello 2"}],
        "url",
    )
    assert result["rows"] == 2
    import sqlite3

    con = sqlite3.connect(dest)
    count = con.execute("SELECT COUNT(*), title FROM articles").fetchone()
    assert count[0] == 1
    assert count[1] == "Hello 2"


def test_publish_and_sync_api(tmp_path, monkeypatch):
    app = create_app(tmp_path / "web.sqlite3")
    client = app.test_client()

    duck = tmp_path / "news.duckdb"
    monkeypatch.setattr("rss_reader.duckstore.fetch_dicts", lambda *a, **k: [{"title": "A", "url": "https://ex.com/1", "text": "hi"}])

    created = client.post(
        "/api/publish",
        json={"kind": "rss", "name": "Watch", "database": str(duck), "table": "articles", "api_key": "secret"},
    )
    assert created.status_code == 201
    slug = created.get_json()["slug"]

    denied = client.get(f"/p/{slug}.xml")
    assert denied.status_code == 401
    ok = client.get(f"/p/{slug}.xml?key=secret")
    assert ok.status_code == 200
    assert b"<rss" in ok.data

    json_ok = client.get(f"/p/{slug}.json?key=secret")
    assert json_ok.status_code == 200
    assert json_ok.get_json()["count"] == 1

    dest = tmp_path / "replica.sqlite3"
    target = client.post(
        "/api/sync-targets",
        json={
            "name": "Replica",
            "kind": "sqlite",
            "database": str(duck),
            "table": "articles",
            "key_column": "url",
            "dest": {"path": str(dest), "table": "articles"},
        },
    )
    assert target.status_code == 201
    run = client.post(f"/api/sync-targets/{target.get_json()['id']}/run")
    assert run.status_code == 200
    assert run.get_json()["rows"] == 1
    assert dest.exists()

    kinds = client.get("/api/sync-kinds")
    assert kinds.status_code == 200
    assert {item["id"] for item in kinds.get_json()} == {"sqlite", "postgres", "mysql", "mssql", "oracle"}
    rejected = client.post(
        "/api/sync-targets",
        json={"name": "Bad", "kind": "mongo", "database": str(duck), "table": "articles", "dest": {}},
    )
    assert rejected.status_code == 400


def test_app_migrates_legacy_schedules(tmp_path):
    db = Database(tmp_path / "web.sqlite3")
    db.create_snapshot_schedule(
        "Hourly",
        feed_ids=[9],
        folder_ids=[],
        max_articles=10,
        dest=None,
        schedule={"enabled": True, "kind": "interval", "minutes": 30},
    )
    create_app(tmp_path / "web.sqlite3")
    db2 = Database(tmp_path / "web.sqlite3")
    assert db2.snapshot_schedules() == []
    assert db2.pipeline_by_name("Hourly")
