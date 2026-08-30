#!/usr/bin/env python3
"""
Autofeeder — one-line cross-platform installer
===============================================
Works on macOS, Linux, and Windows.
Requires only Python 3.8+ in PATH; downloads a newer portable Python if needed.
No admin/sudo, no git, no curl/wget required.

Usage
-----
  python3 install.py                   # standard install
  python3 install.py --no-browser      # skip Playwright Chromium download
  python3 install.py --offline --bundle /path/to/bundle.zip
  python3 install.py --dir ~/.mydir    # custom install location
  python3 install.py --ca-bundle /etc/ssl/corporate.pem
  python3 install.py --insecure        # disable TLS verification (last resort)
  python3 install.py --uninstall
  python3 install.py --dry-run         # show what would happen, do nothing
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen, build_opener, ProxyHandler, HTTPSHandler
import ssl
import json
import re

# ---------------------------------------------------------------------------
# Configuration — update these when cutting a release
# ---------------------------------------------------------------------------
PYPI_PACKAGE = "rss-text-reader"
GITHUB_REPO = "https://github.com/arunavdaniel/Autofeeder"
GITHUB_RELEASES_API = "https://api.github.com/repos/arunavdaniel/Autofeeder/releases/latest"
DEFAULT_INSTALL_DIR = Path.home() / ".autofeeder"
MIN_PYTHON = (3, 10)
APP_NAME = "Autofeeder"
LAUNCHER_NAME = "autofeeder"

# python-build-standalone portable Python download base
PBS_BASE = (
    "https://github.com/indygreg/python-build-standalone/releases/download/"
    "20241016/"
)

# ---------------------------------------------------------------------------
# Colours (disabled on Windows unless ANSICON/WT_SESSION is set)
# ---------------------------------------------------------------------------
_use_color = sys.stdout.isatty() and (
    platform.system() != "Windows"
    or os.environ.get("WT_SESSION")
    or os.environ.get("ANSICON")
)


def _c(code: str, text: str) -> str:
    if not _use_color:
        return text
    return f"\033[{code}m{text}\033[0m"


def green(t: str) -> str:  return _c("32;1", t)
def yellow(t: str) -> str: return _c("33;1", t)
def red(t: str) -> str:    return _c("31;1", t)
def bold(t: str) -> str:   return _c("1", t)
def dim(t: str) -> str:    return _c("2", t)


def info(msg: str) -> None:
    print(f"  {bold('→')} {msg}")


def ok(msg: str) -> None:
    print(f"  {green('✔')} {msg}")


def warn(msg: str) -> None:
    print(f"  {yellow('⚠')} {msg}")


def error(msg: str) -> None:
    print(f"  {red('✘')} {msg}", file=sys.stderr)


def header(msg: str) -> None:
    print(f"\n{bold(msg)}")


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=f"Install {APP_NAME} — local-first RSS extraction app.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--dir", metavar="PATH", default=None,
                   help=f"Install directory (default: {DEFAULT_INSTALL_DIR})")
    p.add_argument("--no-browser", action="store_true",
                   help="Skip downloading Playwright Chromium browser")
    p.add_argument("--offline", action="store_true",
                   help="Offline mode — requires --bundle")
    p.add_argument("--bundle", metavar="ZIP", default=None,
                   help="Path to a pre-downloaded release zip (for offline installs)")
    p.add_argument("--version", metavar="VER", default=None,
                   help="Install a specific version (default: latest)")
    p.add_argument("--ca-bundle", metavar="PEM", default=None,
                   help="Path to a custom CA bundle (e.g. corporate SSL inspection cert)")
    p.add_argument("--insecure", action="store_true",
                   help="Disable TLS certificate verification (use as last resort)")
    p.add_argument("--uninstall", action="store_true",
                   help=f"Remove the {APP_NAME} installation")
    p.add_argument("--dry-run", action="store_true",
                   help="Show what would be done without making changes")
    return p.parse_args()


# ---------------------------------------------------------------------------
# TLS / proxy setup
# ---------------------------------------------------------------------------

def make_ssl_context(ca_bundle: str | None, insecure: bool) -> ssl.SSLContext:
    if insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    if ca_bundle:
        ctx = ssl.create_default_context(cafile=ca_bundle)
        return ctx
    # Honour common env-var overrides used by pip/requests
    bundle = (
        os.environ.get("REQUESTS_CA_BUNDLE")
        or os.environ.get("CURL_CA_BUNDLE")
        or os.environ.get("SSL_CERT_FILE")
    )
    if bundle and Path(bundle).is_file():
        return ssl.create_default_context(cafile=bundle)
    return ssl.create_default_context()


def make_opener(ssl_ctx: ssl.SSLContext) -> object:
    """Build a urllib opener that respects HTTP_PROXY / HTTPS_PROXY env vars."""
    proxies: dict[str, str] = {}
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        val = os.environ.get(var)
        if val:
            key = var.lower().split("_")[0]  # "http" or "https"
            proxies[key] = val
    handlers = [ProxyHandler(proxies), HTTPSHandler(context=ssl_ctx)]
    return build_opener(*handlers)


# ---------------------------------------------------------------------------
# Download helper
# ---------------------------------------------------------------------------

def download(url: str, dest: Path, opener, label: str = "") -> None:
    """Download *url* to *dest* with a simple progress bar."""
    label = label or dest.name
    info(f"Downloading {label} …")
    req = Request(url, headers={"User-Agent": f"autofeeder-installer/1.0 Python/{sys.version.split()[0]}"})
    try:
        with opener.open(req) as resp, open(dest, "wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            received = 0
            chunk = 65536
            while True:
                data = resp.read(chunk)
                if not data:
                    break
                fh.write(data)
                received += len(data)
                if total and sys.stdout.isatty():
                    pct = received * 100 // total
                    bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
                    print(f"\r    [{bar}] {pct:3d}%", end="", flush=True)
        if total and sys.stdout.isatty():
            print()
    except URLError as exc:
        error(f"Download failed: {exc}")
        raise


# ---------------------------------------------------------------------------
# Python version checks
# ---------------------------------------------------------------------------

def current_python_ok() -> bool:
    return sys.version_info >= MIN_PYTHON


def find_python(install_dir: Path) -> Path:
    """Return a path to a Python ≥ MIN_PYTHON executable.

    Search order:
    1. Current interpreter (if new enough)
    2. `python3` / `python` in PATH
    3. Portable Python already downloaded by a previous install
    """
    if current_python_ok():
        return Path(sys.executable)

    for candidate in ("python3", "python3.12", "python3.11", "python3.10", "python"):
        found = shutil.which(candidate)
        if found:
            try:
                ver_out = subprocess.check_output(
                    [found, "-c", "import sys; print(sys.version_info[:2])"],
                    stderr=subprocess.DEVNULL, text=True
                ).strip()
                ver = tuple(map(int, re.findall(r"\d+", ver_out)[:2]))
                if ver >= MIN_PYTHON:
                    return Path(found)
            except Exception:
                pass

    # Check if we already downloaded a portable Python
    portable = install_dir / "python" / _portable_exe()
    if portable.is_file():
        return portable

    return None  # type: ignore


def _portable_exe() -> str:
    system = platform.system()
    if system == "Windows":
        return "python.exe"
    return "bin/python3"


def portable_python_url() -> str:
    """Return a URL for the python-build-standalone portable Python."""
    system = platform.system()
    machine = platform.machine().lower()

    # Map to PBS naming conventions
    if system == "Darwin":
        arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
        return (
            f"{PBS_BASE}cpython-3.12.7+20241016-{arch}-apple-darwin-install_only.tar.gz"
        )
    elif system == "Linux":
        arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
        return (
            f"{PBS_BASE}cpython-3.12.7+20241016-{arch}-unknown-linux-gnu-install_only.tar.gz"
        )
    elif system == "Windows":
        arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
        return (
            f"{PBS_BASE}cpython-3.12.7+20241016-{arch}-pc-windows-msvc-install_only.tar.gz"
        )
    raise RuntimeError(f"Unsupported platform: {system}/{machine}")


def download_portable_python(install_dir: Path, opener, dry_run: bool) -> Path:
    """Download and unpack a standalone portable Python into install_dir/python/."""
    url = portable_python_url()
    python_dir = install_dir / "python"
    exe = python_dir / _portable_exe()

    if exe.is_file():
        ok("Portable Python already present.")
        return exe

    if dry_run:
        info(f"[dry-run] Would download portable Python from:\n    {url}")
        return exe

    python_dir.mkdir(parents=True, exist_ok=True)
    archive = python_dir / "python.tar.gz"
    download(url, archive, opener, "Portable Python 3.12")

    info("Unpacking portable Python …")
    import tarfile
    with tarfile.open(archive) as tf:
        tf.extractall(python_dir)
    archive.unlink(missing_ok=True)

    # Portable builds unpack into a `python/` sub-dir — flatten one level
    unpacked = next(python_dir.glob("python*/"), None)
    if unpacked and unpacked.is_dir():
        for item in unpacked.iterdir():
            shutil.move(str(item), str(python_dir / item.name))
        unpacked.rmdir()

    if not exe.is_file():
        raise RuntimeError(f"Portable Python binary not found at {exe}")

    exe.chmod(exe.stat().st_mode | 0o111)
    ok(f"Portable Python ready: {exe}")
    return exe


# ---------------------------------------------------------------------------
# Latest release / PyPI lookup
# ---------------------------------------------------------------------------

def latest_pypi_version(opener) -> str | None:
    try:
        req = Request(
            f"https://pypi.org/pypi/{PYPI_PACKAGE}/json",
            headers={"Accept": "application/json"},
        )
        with opener.open(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data["info"]["version"]
    except Exception:
        return None


def latest_github_release_zip(opener, version: str | None = None) -> str | None:
    """Return the zip download URL from the latest (or specified) GitHub release."""
    try:
        if version:
            url = GITHUB_RELEASES_API.replace("/latest", f"/tags/v{version}")
        else:
            url = GITHUB_RELEASES_API
        req = Request(url, headers={"Accept": "application/vnd.github+json"})
        with opener.open(req, timeout=10) as resp:
            data = json.loads(resp.read())
            # prefer the "Source code (zip)" asset
            for asset in data.get("assets", []):
                if asset["name"].endswith(".zip"):
                    return asset["browser_download_url"]
            return data.get("zipball_url")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Venv + pip
# ---------------------------------------------------------------------------

def create_venv(python_exe: Path, venv_dir: Path, dry_run: bool) -> Path:
    if dry_run:
        info(f"[dry-run] Would create venv at {venv_dir}")
        return venv_dir / ("Scripts" if platform.system() == "Windows" else "bin") / "python"

    info(f"Creating virtual environment in {venv_dir} …")
    subprocess.check_call(
        [str(python_exe), "-m", "venv", "--upgrade-deps", str(venv_dir)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    system = platform.system()
    venv_python = venv_dir / ("Scripts" if system == "Windows" else "bin") / (
        "python.exe" if system == "Windows" else "python3"
    )
    if not venv_python.exists():
        venv_python = venv_dir / ("Scripts" if system == "Windows" else "bin") / "python"
    ok(f"Virtual environment ready.")
    return venv_python


def pip_install(venv_python: Path, *args: str, dry_run: bool = False) -> None:
    cmd = [str(venv_python), "-m", "pip", "install", "--quiet", "--upgrade", *args]
    if dry_run:
        info(f"[dry-run] Would run: {' '.join(cmd)}")
        return
    info(f"Running pip install {' '.join(args)} …")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Surface pip output so the user knows what went wrong
        print(result.stdout[-2000:] if result.stdout else "")
        print(result.stderr[-2000:] if result.stderr else "", file=sys.stderr)
        raise RuntimeError(f"pip install failed (exit {result.returncode})")
    ok("Package installed.")


def install_from_bundle(venv_python: Path, bundle_zip: Path, dry_run: bool) -> None:
    """Install from a local zip (offline mode)."""
    if not bundle_zip.exists():
        raise FileNotFoundError(f"Bundle not found: {bundle_zip}")

    with tempfile.TemporaryDirectory() as tmp:
        info(f"Unpacking bundle {bundle_zip.name} …")
        with zipfile.ZipFile(bundle_zip) as zf:
            zf.extractall(tmp)
        # Expect either a wheel, a tarball, or a pyproject.toml-based tree
        wheels = list(Path(tmp).rglob("*.whl"))
        sdists = list(Path(tmp).rglob("*.tar.gz"))
        pyproject = list(Path(tmp).rglob("pyproject.toml"))

        if wheels:
            pip_install(venv_python, str(wheels[0]), "--no-index", dry_run=dry_run)
        elif sdists:
            pip_install(venv_python, str(sdists[0]), "--no-index", dry_run=dry_run)
        elif pyproject:
            pip_install(venv_python, str(pyproject[0].parent), "--no-index", dry_run=dry_run)
        else:
            raise RuntimeError("Bundle does not contain a wheel, sdist, or pyproject.toml.")


# ---------------------------------------------------------------------------
# Playwright browser
# ---------------------------------------------------------------------------

def install_playwright(venv_python: Path, dry_run: bool) -> None:
    if dry_run:
        info("[dry-run] Would install Playwright Chromium browser")
        return
    info("Downloading Playwright Chromium browser (this may take a minute) …")
    try:
        subprocess.check_call(
            [str(venv_python), "-m", "playwright", "install", "chromium", "--with-deps"],
            timeout=600,
        )
        ok("Playwright Chromium installed.")
    except subprocess.CalledProcessError:
        warn(
            "Playwright Chromium download failed (may be blocked by network policy).\n"
            "    Browser-based article fetching will be unavailable.\n"
            "    Re-run with --no-browser to suppress this warning."
        )
    except FileNotFoundError:
        warn("playwright not found in venv — skipping browser install.")


# ---------------------------------------------------------------------------
# Launcher scripts
# ---------------------------------------------------------------------------

def venv_bin(venv_dir: Path) -> Path:
    system = platform.system()
    return venv_dir / ("Scripts" if system == "Windows" else "bin")


def write_launcher(install_dir: Path, venv_dir: Path, dry_run: bool) -> Path:
    """Write a platform-appropriate launcher and return its path."""
    system = platform.system()

    if system == "Windows":
        launcher = install_dir / f"{LAUNCHER_NAME}.bat"
        venv_exec = str(venv_bin(venv_dir) / "rss-text-reader.exe")
        content = (
            "@echo off\n"
            ":: Check if Autofeeder is already running\n"
            "powershell -Command \"try { $r = Invoke-WebRequest http://127.0.0.1:8765/api/health"
            " -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop;"
            " Start-Process http://127.0.0.1:8765; exit 0 } catch {} \"\n"
            f'"{venv_exec}" %*\n'
        )
    else:
        launcher = install_dir / LAUNCHER_NAME
        venv_exec = str(venv_bin(venv_dir) / "rss-text-reader")
        content = (
            "#!/bin/sh\n"
            "# If already running, just open the browser\n"
            "if command -v curl >/dev/null 2>&1; then\n"
            "  if curl -fsS --max-time 1 http://127.0.0.1:8765/api/health >/dev/null 2>&1; then\n"
            "    echo 'Autofeeder is already running — opening http://127.0.0.1:8765'\n"
            "    case \"$(uname)\" in\n"
            "      Darwin) open http://127.0.0.1:8765 ;;\n"
            "      *) xdg-open http://127.0.0.1:8765 2>/dev/null || true ;;\n"
            "    esac\n"
            "    exit 0\n"
            "  fi\n"
            "fi\n"
            f'exec "{venv_exec}" "$@"\n'
        )

    if dry_run:
        info(f"[dry-run] Would write launcher: {launcher}")
        return launcher

    launcher.write_text(content)
    if system != "Windows":
        launcher.chmod(launcher.stat().st_mode | 0o111)
    ok(f"Launcher written: {launcher}")
    return launcher


def suggest_path_addition(install_dir: Path) -> None:
    """Print shell-specific instructions for adding install_dir to PATH."""
    system = platform.system()
    target = str(install_dir)

    if system == "Windows":
        print(
            f"\n  {yellow('Add to PATH (run once in PowerShell):')}\n"
            f'  [Environment]::SetEnvironmentVariable("PATH",'
            f' "$env:PATH;{target}", "User")\n'
        )
    else:
        shell = Path(os.environ.get("SHELL", "/bin/sh")).name
        rc_files = {
            "zsh": "~/.zshrc",
            "bash": "~/.bashrc",
            "fish": "~/.config/fish/config.fish",
        }
        rc = rc_files.get(shell, "~/.profile")
        print(
            f"\n  {yellow('Add to PATH — paste into ' + rc + ':')}\n"
            f"  export PATH=\"{target}:$PATH\"\n"
        )


# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

def uninstall(install_dir: Path, dry_run: bool) -> None:
    header(f"Uninstalling {APP_NAME}")
    if not install_dir.exists():
        warn(f"Nothing to remove at {install_dir}")
        return
    if dry_run:
        info(f"[dry-run] Would remove {install_dir}")
        return
    answer = input(f"  Remove {install_dir}? [y/N] ").strip().lower()
    if answer != "y":
        info("Aborted.")
        return
    shutil.rmtree(install_dir)
    ok(f"Removed {install_dir}.")


# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

def print_banner() -> None:
    print(green(bold(r"""
   _         _        __            _
  /_\  _  _ | |_ ___ / _| ___  ___ | |  ___  _ __
 / _ \| || ||  _/ _ \  _|/ -_)/ -_)| |_/ -_)| '_|
/_/ \_\\___/  \__\___/_|  \___|\___||___|___||_|
""")))
    print(bold(f"  {APP_NAME} Installer"))
    print(dim("  Local-first RSS extraction — your data, your machine.\n"))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()

    print_banner()

    install_dir = Path(args.dir).expanduser() if args.dir else DEFAULT_INSTALL_DIR
    venv_dir = install_dir / "venv"

    # --- Uninstall path ---
    if args.uninstall:
        uninstall(install_dir, args.dry_run)
        return 0

    # --- Offline checks ---
    if args.offline and not args.bundle:
        error("--offline requires --bundle <path/to/bundle.zip>")
        return 1

    # --- SSL context + opener ---
    try:
        ssl_ctx = make_ssl_context(args.ca_bundle, args.insecure)
    except Exception as exc:
        error(f"SSL setup failed: {exc}")
        return 1
    opener = make_opener(ssl_ctx)

    # ------------------------------------------------------------------ #
    header("Step 1 — Checking Python")
    # ------------------------------------------------------------------ #
    python_exe = find_python(install_dir)

    if python_exe is None:
        warn(
            f"Python {'.'.join(map(str, MIN_PYTHON))}+ not found in PATH.\n"
            "    Downloading a portable Python …"
        )
        if args.offline:
            error("Cannot download portable Python in offline mode. Install Python manually.")
            return 1
        try:
            install_dir.mkdir(parents=True, exist_ok=True)
            python_exe = download_portable_python(install_dir, opener, args.dry_run)
        except Exception as exc:
            error(f"Could not download portable Python: {exc}")
            return 1
    else:
        ver = platform.python_version()
        ok(f"Python {ver} at {python_exe}")

    # ------------------------------------------------------------------ #
    header("Step 2 — Preparing install directory")
    # ------------------------------------------------------------------ #
    if not args.dry_run:
        install_dir.mkdir(parents=True, exist_ok=True)
    info(f"Install directory: {install_dir}")

    # ------------------------------------------------------------------ #
    header("Step 3 — Creating virtual environment")
    # ------------------------------------------------------------------ #
    venv_python = create_venv(python_exe, venv_dir, args.dry_run)

    # ------------------------------------------------------------------ #
    header("Step 4 — Installing Autofeeder")
    # ------------------------------------------------------------------ #
    if args.bundle:
        install_from_bundle(venv_python, Path(args.bundle).expanduser(), args.dry_run)
    elif args.offline:
        error("--offline set but no --bundle provided.")
        return 1
    elif args.dry_run:
        info(f"[dry-run] Would install '{PYPI_PACKAGE}' from PyPI or GitHub releases.")
    else:
        # Try PyPI first (simplest), fall back to GitHub zip
        pypi_ver = latest_pypi_version(opener)
        if pypi_ver:
            version_spec = f"=={args.version}" if args.version else ""
            pip_install(venv_python, f"{PYPI_PACKAGE}{version_spec}", dry_run=args.dry_run)
        else:
            warn("PyPI unavailable or package not published — trying GitHub releases …")
            zip_url = latest_github_release_zip(opener, args.version)
            if not zip_url:
                error(
                    "Could not reach PyPI or GitHub releases.\n"
                    "    Use --offline --bundle /path/to/bundle.zip for air-gapped installs."
                )
                return 1
            with tempfile.TemporaryDirectory() as tmp:
                archive = Path(tmp) / "release.zip"
                download(zip_url, archive, opener, f"{APP_NAME} source zip")
                install_from_bundle(venv_python, archive, args.dry_run)

    # ------------------------------------------------------------------ #
    header("Step 5 — Playwright browser")
    # ------------------------------------------------------------------ #
    if args.no_browser:
        info("Skipping Playwright browser download (--no-browser).")
    else:
        if not args.dry_run:
            # Install the optional [browser] extra to get the playwright package
            pip_install(venv_python, f"{PYPI_PACKAGE}[browser]", dry_run=False)
        install_playwright(venv_python, args.dry_run)

    # ------------------------------------------------------------------ #
    header("Step 6 — Creating launcher")
    # ------------------------------------------------------------------ #
    launcher = write_launcher(install_dir, venv_dir, args.dry_run)

    # ------------------------------------------------------------------ #
    header("All done! 🎉")
    # ------------------------------------------------------------------ #
    print(green(bold("\n  Autofeeder installed successfully.\n")))

    suggest_path_addition(install_dir)

    print(
        f"  {dim('Uninstall anytime with:')}\n"
        f"    {bold('python3 install.py --uninstall')}\n"
    )

    if args.dry_run:
        info(f"[dry-run] Would launch: {launcher}")
        return 0

    print(green(bold("  Launching Autofeeder — opening http://127.0.0.1:8765 …\n")))
    # exec() replaces the installer process with the app — clean, no zombie processes
    rss_cmd = venv_bin(venv_dir) / (
        "rss-text-reader.exe" if platform.system() == "Windows" else "rss-text-reader"
    )
    if rss_cmd.exists():
        os.execv(str(rss_cmd), [str(rss_cmd)])
    else:
        # Fallback: run as a subprocess (e.g. when installed from a local zip path)
        subprocess.call([str(venv_python), "-m", "rss_reader.web"])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n  Interrupted.")
        sys.exit(1)
