from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from .database import Database, data_directory
from .duckstore import _resolve_path


def _manifest(database: Database) -> dict:
    duckdb_files: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in database.duckdb_databases():
        path = _resolve_path(row["path"])
        key = str(path.resolve())
        if key in seen or not path.exists():
            continue
        seen.add(key)
        duckdb_files.append(
            {
                "name": path.name,
                "path": str(path),
                "arcname": f"duckdb/{path.name}",
            }
        )
    return {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "sqlite": str(database.path),
        "duckdb_files": duckdb_files,
    }


def create_backup(database: Database) -> Path:
    data_dir = data_directory()
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = data_dir / f"autofeeder-backup-{ts}.zip"
    manifest = _manifest(database)
    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(database.path, arcname="reader.sqlite3")
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        for item in manifest["duckdb_files"]:
            archive.write(item["path"], arcname=item["arcname"])
    return backup_path


def restore_backup(database: Database, archive_path: Path) -> dict:
    data_dir = data_directory()
    if not archive_path.exists():
        raise FileNotFoundError(f"Backup not found: {archive_path}")

    safety = data_dir / f"pre-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    safety.mkdir(parents=True, exist_ok=True)
    if database.path.exists():
        shutil.copy2(database.path, safety / "reader.sqlite3")

    restored_duckdb = 0
    with zipfile.ZipFile(archive_path, "r") as archive:
        names = archive.namelist()
        if "reader.sqlite3" not in names:
            raise ValueError("Backup is missing reader.sqlite3")
        archive.extract("reader.sqlite3", path=safety)
        shutil.copy2(safety / "reader.sqlite3", database.path)
        for name in names:
            if not name.startswith("duckdb/") or name.endswith("/"):
                continue
            target = data_dir / Path(name).name
            if target.exists():
                shutil.copy2(target, safety / target.name)
            archive.extract(name, path=data_dir)
            restored_duckdb += 1

    return {
        "ok": True,
        "restart_required": True,
        "safety_backup": str(safety),
        "restored_duckdb_files": restored_duckdb,
    }
