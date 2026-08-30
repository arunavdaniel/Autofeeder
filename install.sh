#!/bin/sh
# Autofeeder — one-line installer for macOS and Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/arunav/rss-text-reader/main/install.sh | sh
# Or with options: curl -fsSL .../install.sh | sh -s -- --no-browser
set -eu

INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.py"

# Find a suitable Python interpreter
find_python() {
  for cmd in python3 python3.12 python3.11 python3.10 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
      ver=$("$cmd" -c "import sys; print('%d%d' % sys.version_info[:2])" 2>/dev/null || echo "0")
      if [ "$ver" -ge 310 ] 2>/dev/null; then
        echo "$cmd"
        return 0
      fi
    fi
  done
  # Fall back to any python — install.py will handle the version bootstrap
  for cmd in python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "$cmd"
      return 0
    fi
  done
  return 1
}

PYTHON=$(find_python 2>/dev/null) || {
  echo "ERROR: No Python interpreter found in PATH." >&2
  echo "       Install Python 3.10+ from https://python.org and re-run this script." >&2
  exit 1
}

echo "→ Using Python: $PYTHON ($($PYTHON --version 2>&1))"

# Download and run install.py
if command -v curl >/dev/null 2>&1; then
  "$PYTHON" - "$@" <<EOF_SCRIPT
$(curl -fsSL "$INSTALL_SCRIPT_URL")
EOF_SCRIPT
elif command -v wget >/dev/null 2>&1; then
  "$PYTHON" - "$@" <<EOF_SCRIPT
$(wget -qO- "$INSTALL_SCRIPT_URL")
EOF_SCRIPT
else
  # Pure Python download fallback (no curl, no wget)
  "$PYTHON" -c "
import urllib.request, sys, os, tempfile, subprocess
url = '$INSTALL_SCRIPT_URL'
with tempfile.NamedTemporaryFile(suffix='.py', delete=False, mode='wb') as f:
    with urllib.request.urlopen(url) as r:
        f.write(r.read())
    tmp = f.name
try:
    sys.exit(subprocess.call([sys.executable, tmp] + sys.argv[1:]))
finally:
    os.unlink(tmp)
" "$@"
fi
