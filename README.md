<p align="center">
  <img src="docs/images/icon.svg" width="128" height="128" alt="Autofeeder Logo" />
  <h1 align="center">Autofeeder</h1>
  <p align="center">
    <b>Local-first intelligence extraction.</b> Point it at RSS feeds, websites, or APIs. Define what you want to pull out. Get a structured DuckDB table on your machine — no cloud, no accounts, no data leaving your box.
  </p>
</p>

---

## Screenshots Showcase

| Overview & Health | Sources & Discovery |
| :---: | :---: |
| ![Overview](docs/images/overview.png) | ![Discover](docs/images/discover.png) |

| Extraction Pipelines | Built-in DuckDB SQL Viewer |
| :---: | :---: |
| ![Pipelines](docs/images/pipelines.png) | ![DuckDB Viewer](docs/images/duckdb.png) |

| Website Change Monitor | Local Embeddings & Semantic Search |
| :---: | :---: |
| ![Websites](docs/images/websites.png) | ![Embeddings](docs/images/embeddings.png) |

---

## Install

One command. Opens in your browser when done. Works on macOS, Linux, and Windows — including locked-down enterprise machines.

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.sh | sh
```

### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.ps1 | iex
```

### No `curl`? Any machine with Python works

```bash
python3 install.py
```

> Download [`install.py`](https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.py) first, then run it. That's it.

After install, Autofeeder starts automatically and opens **http://127.0.0.1:8765** in your browser.

---

## What it does

Autofeeder is an end-to-end extraction pipeline that runs entirely on your machine:

```
SOURCES  →  FETCH  →  SNAPSHOT  →  TEXT EXTRACTION  →  LLM  →  DUCKDB
  RSS            HTTP/browser     trafilatura          any      queryable
  Atom           or Playwright    clean text        OpenAI-    structured
  Websites       / Selenium                        compat     table
  APIs
```

1. **Subscribe to sources** — RSS/Atom feeds, arbitrary public websites, or JSON APIs. Group into folders.
2. **Snapshot** — Capture a reproducible point-in-time set of articles.
3. **Extract text** — Pull clean readable body text from raw HTML using trafilatura.
4. **Define a schema** — Describe what structured fields you want out of each article (name, type, description).
5. **Run LLM extraction** — Send article text + your prompt to any OpenAI-compatible model. Get validated JSON back.
6. **Write to DuckDB** — Records land in a local DuckDB table with metadata columns stamped automatically.
7. **Query** — Open the built-in SQL viewer, run any query, export to CSV/Parquet/JSON.
8. **Automate** — Schedule any pipeline on an interval or daily timer.

---

## What you can build with it

| Use case | What you do |
|---|---|
| **Market intelligence** | Subscribe to trade press, extract competitor pricing/announcements → queryable DuckDB table |
| **Research database** | Turn newsletters and blogs into structured facts you can `JOIN` and `GROUP BY` |
| **Knowledge base** | Feed a source list → chunk → embed → semantic search, all local |
| **Dataset creation** | Build schema-conforming labeled datasets for fine-tuning from web sources |
| **Website monitoring** | Watch public pages for meaningful changes, review diffs, trigger extraction on change |
| **Local LLM pipeline** | Point at Ollama or LM Studio — nothing leaves your machine, no API keys required |
| **Scheduled feeds** | Snapshot + schedule → rolling DuckDB table updated automatically on a timer |

---

## Installer options

```bash
# Skip Playwright browser download (faster; JS-heavy article fetching unavailable)
python3 install.py --no-browser

# Custom install location
python3 install.py --dir /opt/autofeeder

# Install a specific version
python3 install.py --version 0.2.1

# Corporate SSL inspection / custom CA certificate
python3 install.py --ca-bundle /etc/ssl/corporate-ca.pem

# Fully offline / air-gapped — requires a platform-specific pre-downloaded bundle zip
# Download: autofeeder-offline-macos.zip / autofeeder-offline-linux.zip / autofeeder-offline-windows.zip
python3 install.py --offline --bundle ~/Downloads/autofeeder-offline-macos.zip

# Preview what would happen without making any changes
python3 install.py --dry-run

# Uninstall
python3 install.py --uninstall
```

### Enterprise compatibility

The installer works on locked-down machines with no admin rights:

| Restriction | How it's handled |
|---|---|
| No admin / sudo | Installs entirely to `~/.autofeeder/` in your home directory |
| No `git` | Downloads a source zip from GitHub releases or from PyPI |
| No `curl` / `wget` | Falls back to Python's built-in `urllib` automatically |
| Python < 3.10 or missing | Downloads a portable Python 3.12 via [python-build-standalone](https://github.com/indygreg/python-build-standalone) |
| HTTP/HTTPS proxy | Reads `HTTP_PROXY` / `HTTPS_PROXY` env vars |
| NTLM / Kerberos proxy (Windows) | `install.ps1` uses the system proxy with default network credentials |
| Corporate SSL inspection | `--ca-bundle` flag or `REQUESTS_CA_BUNDLE` env var |
| Playwright blocked by IT | `--no-browser` — app works fully without it |
| Air-gapped / no internet | `--offline --bundle` with a zip pre-downloaded on another machine |

---

## Re-running after install

```bash
~/.autofeeder/autofeeder          # macOS / Linux
~/.autofeeder/autofeeder.bat      # Windows
```

If Autofeeder is already running, the launcher detects it and just opens your browser to `http://127.0.0.1:8765` without starting a second instance.

---

## Features

| Page | What you can do |
|---|---|
| **Overview** | Dashboard: counts of feeds, pipelines, runs, records extracted, errors. Last run summary. |
| **Sources** | Add/edit/delete RSS & Atom feeds. Group into folders. Auto-refresh every 15 m / 30 m / 1 h / 6 h. Optional Playwright browser fetch for JS-heavy sites. |
| **Discover** | Browse a curated catalog of feeds and websites to add in one click. |
| **Websites** | Monitor any public URL. HTTP, Playwright, or Selenium. Change detection via content hash. Diff review. Feed changes into pipelines. |
| **Schemas** | Define reusable extraction schemas: field name, type, description, required flag, default value. |
| **Pipelines** | Compose a run: source → LLM endpoint + model + prompt → schema → DuckDB output (append / overwrite / upsert, dedupe key). Preview one article before saving. Retries, concurrency, timeout. |
| **DuckDB** | SQL viewer: browse databases, open tables, run read-only or write queries, rename/delete databases and tables. |
| **Embeddings** | Chunk articles into paragraphs/sentences. Embed locally (deterministic hash vectors) or via any OpenAI-compatible endpoint, Ollama, or LM Studio. |
| **Semantic Search** | Embed a question → cosine similarity over local chunks → results with source, title, date, matched text, URL. |
| **Exports** | Export DuckDB tables or query results to CSV, Parquet, JSON, SQLite. Upsert-sync to Postgres, MySQL, MSSQL, Oracle. |
| **Schedules** | Create interval or daily snapshot schedules with a DuckDB destination. Runs automatically in the background. |
| **Run History** | Per-run logs, phase-by-phase progress, errors, and extracted output for every pipeline execution. |
| **Stats** | Charts of runs, records written, and errors over time. |
| **Settings** | Dark mode, app preferences. LLM API keys and endpoints stay in browser `localStorage` only — never written to the server. |

### Pipeline stages (only use what you need)

```
SOURCE → FETCH → SNAPSHOT → CHANGE DETECTION → TEXT EXTRACTION
                                    ↓
                       CHUNKING → EMBEDDING → LOCAL VECTOR SEARCH
                                    ↓
                       LLM EXTRACTION → VALIDATION → DEDUPLICATION
                                    ↓
                            DUCKDB → EXPORT / REPLICATION
```

### DuckDB output schema

Every extracted record carries automatic metadata columns:

```sql
ingested_at   TIMESTAMP   -- when the record was written
feed_title    VARCHAR     -- source feed or website name
article_url   VARCHAR     -- original article URL
run_id        BIGINT      -- links back to the pipeline run
```

### Privacy

- LLM API keys are used for the outbound request only. They are **never written to disk or the local database**.
- Endpoint, model, and prompt live in browser `localStorage`.
- No telemetry. No accounts. No network calls except to feeds and the LLM endpoint you configure.

---

## LLM configuration

Autofeeder works with any OpenAI-compatible chat completions endpoint:

| Provider | Endpoint |
|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` |
| Ollama (local) | `http://localhost:11434/v1/chat/completions` |
| LM Studio (local) | `http://localhost:1234/v1/chat/completions` |
| Anything else | Any `POST /v1/chat/completions` compatible API |

Configure in **Settings → LLM**. The key is used only for the duration of the request.

---

## Optional extras

```bash
# Playwright & Selenium browsers (for JS-heavy article fetching)
pip install 'autofeeder[browser]'
python -m playwright install chromium

# Database sync / upsert (Postgres, MySQL, MSSQL, Oracle)
pip install 'autofeeder[sync]'

# Sentence-level embeddings via sentence-transformers
pip install 'autofeeder[embeddings]'
```

Connection strings: `postgres://user:pass@host:5432/db`, `mysql://user:pass@host:3306/db`,
`mssql://user:pass@host:1433/db`, `oracle://user:pass@host:1521/ORCL`.

---

## Developer setup

```bash
git clone https://github.com/arunavdaniel/Autofeeder.git
cd Autofeeder
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .
rss-text-reader                  # starts server + opens browser
```

Build the frontend (only needed when editing frontend source):

```bash
cd frontend
npm install
npm run build                    # output goes to rss_reader/frontend_dist/
```

Build offline installer bundle:

```bash
python scripts/build_offline_bundle.py
```

---

## Architecture

```mermaid
flowchart TB
  subgraph Frontend["React 19 + Vite SPA (served from rss_reader/frontend_dist/)"]
    UI["Overview · Sources · Discover · Websites · Schemas · Pipelines\nDuckDB · Embeddings · Semantic Search · Exports · Schedules · Run History · Stats · Settings"]
  end

  subgraph Backend["Flask backend (:8765)"]
    Web["web.py — REST API + static SPA"]
    Feeds["feeds.py — RSS/Atom + website fetch"]
    Extract["extractor.py / llm.py — LLM JSON extraction"]
    Pipe["pipeline.py — orchestration + scheduler"]
    Duck["duckstore.py — DuckDB engine"]
    Vec["vectorstore.py — local embeddings + cosine search"]
    DB[("database.py — SQLite metadata")]
  end

  subgraph Storage["Local data (no cloud)"]
    DDB[("DuckDB files (.duckdb)")]
    SQL[("SQLite metadata DB")]
    ART[("Article text snapshots")]
  end

  UI <-->|HTTP /api| Web
  Web --> Feeds & Extract & Pipe & Duck & Vec & DB
  Extract --> LLM["OpenAI-compatible LLM\n(Ollama / LM Studio / OpenAI / any)"]
  Duck --> DDB
  DB --> SQL
  Feeds --> ART
```

---

## Project structure

```
Autofeeder/
├── docs/images/                # Screenshots and logo assets for documentation
├── rss_reader/                 # Python backend (Flask)
│   ├── web.py                  # REST API + SPA serving
│   ├── database.py             # SQLite metadata (feeds, schemas, pipelines, runs)
│   ├── duckstore.py            # DuckDB engine (query, import, alter, export)
│   ├── extractor.py            # extraction orchestration
│   ├── llm.py                  # OpenAI-compatible LLM client
│   ├── feeds.py                # RSS/Atom fetch + parse
│   ├── fetchers.py             # HTTP, Playwright & Selenium fetcher abstraction
│   ├── pipeline.py             # pipeline runner + scheduler loop
│   ├── chunker.py              # paragraph/sentence chunking
│   ├── embeddings.py           # embedding provider abstraction
│   ├── vectorstore.py          # local cosine similarity search
│   ├── website.py              # website monitor + change detection
│   ├── catalog.py              # source catalog / discovery
│   ├── json_mapping.py         # JSON/API extraction without LLM
│   ├── publish.py              # RSS/JSON feed output
│   ├── backup.py               # backup / restore
│   └── frontend_dist/          # pre-built React SPA (committed, ships with pip)
├── frontend/                   # React 19 + Vite + TypeScript source
│   └── src/
│       ├── pages/              # one file per page/route
│       ├── components/         # ui primitives, layout, charts
│       └── lib/                # api.ts, types.ts, utils
├── scripts/
│   └── build_offline_bundle.py # generates self-contained offline installer zip
├── install.py                  # cross-platform one-line installer
├── install.sh                  # macOS/Linux curl wrapper
├── install.ps1                 # Windows PowerShell wrapper
├── packaging/                  # PyInstaller spec & logo assets
├── tests/
└── pyproject.toml
```

---

## Data location

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/RSS Text Reader` |
| Windows | `%APPDATA%\RSS Text Reader` |
| Linux | `$XDG_DATA_HOME/RSS Text Reader` or `~/.local/share/RSS Text Reader` |

DuckDB files are stored in the **DuckDB viewer folder** you configure in the app. SQLite metadata and article snapshots go to the data location above.
