#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ ! -d frontend/dist ]; then
  echo "Building frontend (first run)..."
  (cd frontend && npm install && npm run build)
fi

if curl -fsS --max-time 2 http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  echo "Autofeeder is already running at http://127.0.0.1:8765"
  exit 0
fi

echo "Starting Autofeeder at http://127.0.0.1:8765"
python -m rss_reader.web --daemon --no-browser "$@"
sleep 0.8
if curl -fsS --max-time 3 http://127.0.0.1:8765/api/health >/dev/null; then
  echo "Server is up. Open http://127.0.0.1:8765/discover"
else
  echo "Server did not start. Check /tmp/rss-server.log"
  exit 1
fi
