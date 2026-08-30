#!/usr/bin/env python3
"""
Autofeeder — Offline Bundle Builder
====================================
Creates a complete, self-contained offline bundle (autofeeder-offline-bundle.zip)
containing:
- Pre-built frontend dist (rss_reader/frontend_dist)
- Pre-built wheel for rss-text-reader
- Complete wheel set for ALL dependencies (setuptools, wheel, pip, beautifulsoup4,
  duckdb, feedparser, flask, jsonschema, requests, trafilatura, playwright,
  selenium, psycopg, pymysql, pymssql, oracledb, sentence-transformers, etc.)
- Playwright browser cache (if available)
- One-line installer scripts (install.py, install.sh, install.ps1)

Usage:
    python scripts/build_offline_bundle.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def build_frontend() -> None:
    frontend_dir = ROOT_DIR / "frontend"
    dist_target = ROOT_DIR / "rss_reader" / "frontend_dist"

    print("→ Checking frontend build...")
    if not (dist_target / "index.html").exists():
        print("→ Building frontend...")
        subprocess.check_call(["npm", "run", "build"], cwd=frontend_dir)
        dist_src = frontend_dir / "dist"
        if dist_target.exists():
            shutil.rmtree(dist_target)
        shutil.copytree(dist_src, dist_target)
        print("✔ Frontend built and copied to rss_reader/frontend_dist")
    else:
        print("✔ Frontend dist already present.")


def download_wheels(wheels_dir: Path) -> None:
    print("→ Downloading wheels for all dependencies...")
    wheels_dir.mkdir(parents=True, exist_ok=True)

    # Build local wheel first
    print("→ Building rss-text-reader wheel...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "wheel", "--no-deps", ".", "-w", str(wheels_dir)],
        cwd=ROOT_DIR,
    )

    # Download dependencies for .[all], plus setuptools, wheel, pip
    deps = [
        ".[all]",
        "setuptools>=68",
        "wheel",
        "pip",
    ]
    print(f"→ Downloading wheel cache for: {', '.join(deps)}")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "download", "-d", str(wheels_dir)] + deps,
        cwd=ROOT_DIR,
    )
    print(f"✔ Downloaded {len(list(wheels_dir.glob('*.whl')))} wheels.")


def copy_playwright_browsers(browsers_dir: Path) -> None:
    # Check default playwright location
    system = sys.platform
    if system == "darwin":
        pw_cache = Path.home() / "Library" / "Caches" / "ms-playwright"
    elif system == "win32":
        pw_cache = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
    else:
        pw_cache = Path.home() / ".cache" / "ms-playwright"

    if pw_cache.is_dir() and any(pw_cache.iterdir()):
        print(f"→ Copying Playwright browser cache from {pw_cache}...")
        browsers_dir.mkdir(parents=True, exist_ok=True)
        for item in pw_cache.glob("chromium*"):
            if item.is_dir():
                shutil.copytree(item, browsers_dir / item.name, dirs_exist_ok=True)
                print(f"✔ Bundled browser: {item.name}")


def is_wheel_for_platform(filename: str, target_os: str) -> bool:
    """Return True if wheel filename is compatible with target_os ('macos', 'linux', 'windows', 'universal')."""
    if target_os == "universal":
        return True
    name = filename.lower()
    # Universal / pure python wheels are compatible with all OSes
    if "none-any.whl" in name or "-any.whl" in name:
        return True
    if target_os == "macos" and ("macosx" in name or "darwin" in name):
        return True
    if target_os == "linux" and ("manylinux" in name or "musllinux" in name or "linux" in name):
        return True
    if target_os == "windows" and ("win_amd64" in name or "win32" in name or "win" in name):
        return True
    return False


def create_bundle(tmp_path: Path, target_os: str, target_zip: Path) -> Path:
    print(f"→ Creating zip archive for {target_os}: {target_zip.name}...")
    if target_zip.exists():
        target_zip.unlink()

    with zipfile.ZipFile(target_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(tmp_path):
            for f in files:
                full_path = Path(root) / f
                rel_path = full_path.relative_to(tmp_path)

                # Filter out wheels that belong to a different operating system
                if "wheels" in rel_path.parts and f.endswith(".whl"):
                    if not is_wheel_for_platform(f, target_os):
                        continue

                zf.write(full_path, rel_path)

    size_mb = target_zip.stat().st_size / (1024 * 1024)
    print(f"✔ Created {target_zip.name} ({size_mb:.2f} MB)")
    return target_zip


def main() -> None:
    print("==========================================")
    print("  Autofeeder Offline Bundle Builder")
    print("==========================================")

    build_frontend()

    dist_dir = ROOT_DIR / "dist"
    dist_dir.mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        wheels_dir = tmp_path / "wheels"
        browsers_dir = tmp_path / "browsers"

        download_wheels(wheels_dir)
        copy_playwright_browsers(browsers_dir)

        # Copy installer scripts and readme
        for filename in ("install.py", "install.sh", "install.ps1", "README.md", "pyproject.toml"):
            src = ROOT_DIR / filename
            if src.exists():
                shutil.copy2(src, tmp_path / filename)

        # Copy source package rss_reader
        shutil.copytree(ROOT_DIR / "rss_reader", tmp_path / "rss_reader")

        # Build platform-specific bundles
        for platform_name in ("macos", "linux", "windows", "bundle"):
            os_tag = "universal" if platform_name == "bundle" else platform_name
            target_zip = dist_dir / f"autofeeder-offline-{platform_name}.zip"
            create_bundle(tmp_path, os_tag, target_zip)

    print("\n==========================================")
    print("✔ Offline bundles created successfully in dist/")
    for z in sorted(dist_dir.glob("autofeeder-offline-*.zip")):
        print(f"  - {z.name} ({z.stat().st_size / (1024*1024):.2f} MB)")
    print("==========================================\n")


if __name__ == "__main__":
    main()
