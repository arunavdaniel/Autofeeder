from pathlib import Path

from rss_reader.backup import create_backup, restore_backup
from rss_reader.database import Database


def test_migrate_snapshot_schedules_to_pipelines(tmp_path):
    db = Database(tmp_path / "test.sqlite3")
    schedule_id = db.create_snapshot_schedule(
        "Daily news",
        feed_ids=[1],
        folder_ids=[],
        max_articles=25,
        dest={"database": "news.duckdb", "table": "articles"},
        schedule={"enabled": True, "kind": "daily", "time": "09:00"},
        enabled=True,
    )
    assert schedule_id
    converted = db.migrate_snapshot_schedules_to_pipelines()
    assert converted == 1
    assert db.snapshot_schedules() == []
    pipeline = db.pipeline_by_name("Daily news")
    assert pipeline
    definition = __import__("json").loads(pipeline["definition"])
    assert definition["snapshot"]["enabled"] is True
    assert definition["llm"]["enabled"] is False
    assert definition["snapshot"]["kind"] == "daily"


def test_backup_round_trip(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr("rss_reader.database.data_directory", lambda: data_dir)
    monkeypatch.setattr("rss_reader.duckstore.data_directory", lambda: data_dir)
    monkeypatch.setattr("rss_reader.backup.data_directory", lambda: data_dir)

    db = Database(data_dir / "reader.sqlite3")
    db.add_folder("News")
    db.save_duckdb_database("main", str(data_dir / "main.duckdb"))
    (data_dir / "main.duckdb").write_text("duckdb-placeholder")

    backup_path = create_backup(db)
    assert backup_path.exists()

    db.add_folder("Should be replaced")
    restore_backup(db, backup_path)

    folders = [row["name"] for row in db.folders()]
    assert folders == ["News"]


def test_run_totals_counts_all_runs(tmp_path):
    db = Database(tmp_path / "test.sqlite3")
    pid = db.save_pipeline("P", {"name": "P"})
    for i in range(3):
        run_id = db.create_run(pid)
        db.update_run(run_id, status="success", records_count=10 + i, error_count=1)
    queued = db.create_run(pid)
    db.update_run(queued, status="queued")
    totals = db.run_totals()
    assert totals["total_runs"] == 4
    assert totals["total_records"] == 33
    assert totals["total_errors"] == 3
    assert totals["active_runs"] == 1


def test_unified_snapshots_maps_article_kind_to_feed(tmp_path):
    db = Database(tmp_path / "test.sqlite3")
    db.create_snapshot("Clip", "article", "Saved")
    db.create_snapshot("Job", "pipeline", "Nightly")
    rows = db.unified_snapshots()
    types = {row["name"]: row["type"] for row in rows}
    assert types["Clip"] == "feed"
    assert types["Job"] == "pipeline"
