# Autofeeder

**Local-first extraction application.** Feed it RSS/Atom sources, and it extracts article text, runs
LLM-structured extraction, and stores the results in DuckDB — all on your machine.

Autofeeder is a desktop-class, local-only **extraction app**. It uses RSS/Atom feeds as just one convenient
way to discover and pull source articles, then extracts clean readable text from each article, runs that text
through any OpenAI-compatible LLM to produce structured JSON, and stores the results in **DuckDB** as the
single primary output. No server accounts, no cloud lock-in — your data and your keys stay on your machine.

> Replaces the older "Autofeedly / RSS Text Reader" design. The on-disk data directory is still named
> `RSS Text Reader` for backward compatibility; the product is branded **Autofeeder** everywhere user-facing.

---

## Table of contents

1. [What it does](#what-it-does)
2. [What it can be used for](#what-it-can-be-used-for)
3. [Architecture](#architecture)
4. [Data flow](#data-flow)
5. [Feature reference](#feature-reference)
6. [Tech stack](#tech-stack)
7. [Getting started](#getting-started)
8. [LLM configuration](#llm-configuration)
9. [The Mapper & DuckDB](#the-mapper--duckdb)
10. [Scheduling](#scheduling)
11. [Project structure](#project-structure)
12. [Build installers](#build-installers)
13. [Data location](#data-location)

---

## What it does

Autofeeder is an extraction pipeline, end to end:

1. **Collect sources** — Subscribe to RSS/Atom feeds (one of several ways to pull source articles) and
   organize them into folders. Fetch articles with a normal HTTP fetch or an optional headless browser
   (Playwright) for JS-heavy sites.
2. **Snapshot** — Capture a point-in-time set of articles so processing is reproducible and re-runnable.
3. **Extract text** — Pull the readable article body out of the raw page/html.
4. **Map schema** — Define a structured schema (fields, types, descriptions) describing what you want to pull
   out of each article.
5. **Run LLM extraction** — Send the article text + an extraction prompt to any OpenAI-compatible model and
   get back validated JSON that matches your schema.
6. **Store in DuckDB** — Write the structured records into a DuckDB table, alongside metadata columns
   (`ingested_at`, `feed_title`, `article_url`, `run_id`).
7. **Browse & query** — Open the built-in DuckDB viewer to run SQL, preview tables, and rename/edit/delete
   databases and tables.
8. **Automate** — Schedule snapshots (interval or daily) that flow into DuckDB automatically.

Everything is driven from a single-page app; the backend is a Flask service on port `8765` that also serves
the built frontend.

---

## What it can be used for

- **Personal research extraction** — Turn newsletters, blogs, and news feeds into a queryable local database
  of structured facts (e.g. "every product launch mentioned this week with price + date").
- **Market & competitive intelligence** — Extract competitors' pricing, feature mentions, or funding
  announcements from trade press into a DuckDB table you can `JOIN`, `GROUP BY`, and chart.
- **Knowledge base build-out** — Convert a watch-list of sources into structured records for RAG/semantic
  search or downstream analysis.
- **Monitoring & alerting prep** — Keep a rolling DuckDB table of extracted entities; pair with the SQL
  viewer to spot trends without leaving your machine.
- **Dataset creation** — Build labeled, schema-conforming datasets from web sources for fine-tuning or
  evaluation, then query them from DuckDB.
- **Offline/local LLM workflows** — Point extraction at a local model (Ollama, LM Studio) so nothing leaves
  the box; keys never touch the server.
- **Reproducible pipelines** — Snapshot + schedule so the same articles are extracted identically on a timer.

---

## Architecture

```mermaid
flowchart TB
  subgraph Browser["Frontend (React + Vite SPA)"]
    UI[Pages: Overview, Sources, Schemas, Mapper, Pipelines, DuckDB, Schedules, Stats, Run History, Settings]
  end

  subgraph Backend["Flask backend (:8765)"]
    Web[web.py — REST API + static SPA]
    Feeds[feeds.py — fetch/parse]
    Extract[extractor.py / llm.py — LLM JSON extraction]
    Pipe[pipeline.py — orchestration + scheduler]
    Duck[duckstore.py — DuckDB engine]
    DB[(database.py — SQLite metadata)]
  end

  subgraph Storage["Local data"]
    DDB[(DuckDB files)]
    SQL[(SQLite metadata DB)]
    ART[(Saved article text)]
  end

  UI <-->|HTTP /api| Web
  Web --> Feeds
  Web --> Extract
  Web --> Pipe
  Web --> Duck
  Web --> DB
  Feeds --> ART
  Extract --> LLM[OpenAI-compatible LLM\n(Ollama / LM Studio / OpenAI)]
  Pipe --> Duck
  Duck --> DDB
  DB --> SQL
```

ASCII fallback:

```
+-----------------------------------------------------------+
|  Frontend (React 19 + Vite + Tailwind SPA)                |
|  Overview · Sources · Schemas · Mapper · Pipelines ·      |
|  DuckDB · Schedules · Stats · Run History · Settings      |
+-----------------------------+-----------------------------+
                              |  HTTP /api (JSON)
                              v
+-----------------------------------------------------------+
|  Flask backend  (port 8765, also serves dist/)            |
|  web.py  -> routes                                         |
|  feeds.py -> RSS/Atom fetch + parse                       |
|  extractor.py / llm.py -> LLM JSON extraction             |
|  pipeline.py -> orchestration + scheduler loop            |
|  duckstore.py -> DuckDB read/write                        |
|  database.py -> SQLite metadata                           |
+--------+---------+---------+---------+--------------------+
         |         |         |         |
         v         v         v         v
     LLM API   DuckDB     SQLite     Article text
   (Ollama/    files      metadata    (on disk)
    OpenAI/    (.duckdb)  DB
    LM Studio)
```

---

## Data flow

```mermaid
sequenceDiagram
  actor User
  participant UI as Frontend
  participant API as Flask /api
  participant Feed as feeds.py
  participant LLM as LLM (OpenAI-compat)
  participant Duck as duckstore.py
  participant DDB as DuckDB file

  User->>UI: Subscribe to feeds / pick sources
  UI->>API: GET/POST feeds & folders
  API->>Feed: fetch + parse RSS/Atom
  Feed-->>API: article list + text
  User->>UI: Build schema (fields/types)
  User->>UI: Map schema -> DuckDB table (drag & drop)
  UI->>API: create-table / save mapping
  User->>UI: Run pipeline (or schedule)
  UI->>API: POST pipeline/run
  API->>Feed: pull snapshot articles
  API->>LLM: article text + extraction prompt
  LLM-->>API: structured JSON (schema-shaped)
  API->>Duck: write records (+ meta cols)
  Duck->>DDB: INSERT INTO table
  UI->>API: GET duckdb/preview, /query
  API-->>UI: table rows / SQL result
```

---

## Feature reference

| Area | What you can do |
|------|-----------------|
| **Overview** | Dashboard with counts (folders, feeds, pipelines, runs, records, errors) and the last run summary. |
| **Sources** | Add/edit/delete RSS & Atom feeds, group them into folders, auto-refresh cadence (15m/30m/1h/6h/off), optional browser fetching. |
| **Schemas** | Define reusable extraction schemas: named fields with type, description, required flag, default. |
| **Mapper** | Visually map a schema to a DuckDB table. Drag fields from the schema panel into the column mapping; add/delete columns; pick an existing table or create a new one; save mappings for reuse. Live `CREATE TABLE` SQL preview. |
| **Pipelines** | Compose a run: choose feeds/snapshots, LLM endpoint + model + prompt, schema, DuckDB destination (database/table, write mode, dedupe key), retries/concurrency/timeout. Preview one article before saving. |
| **DuckDB viewer** | Browse all databases (sidebar "viewer"), open tables, run read-only or write SQL, preview rows. Rename/edit/delete databases and rename/delete tables. |
| **Schedules** | Standalone Schedules tab: interval or daily snapshot schedules with feed/folder selection and a DuckDB destination; runs automatically via the scheduler loop. |
| **Stats** | Charts of runs, records, and errors over time. |
| **Run History** | Per-run logs, phases, progress, and extracted output for every pipeline execution. |
| **Settings** | App preferences, dark mode, and local LLM/API configuration (keys stored browser-local only). |

| **Websites** | Monitor arbitrary public pages over HTTP or Playwright, keep normalized page snapshots, detect meaningful changes, review diffs, and feed changed content into pipelines. |
| **Embeddings** | Optional paragraph/sentence chunking with local hash vectors or OpenAI-compatible/Ollama/LM Studio embedding endpoints. Configuration stays local to the browser. |
| **Semantic Search** | Search indexed article and website chunks by meaning, with relevance score, source, title, publication date, matched text, and original URL. |
| **Exports** | Export canonical DuckDB tables or filtered queries to CSV, Parquet, JSON, or SQLite. PostgreSQL replication is optional and never required. |

### DuckDB is the primary output

CSV and JSON *download* buttons were removed; DuckDB is the system of record. The Mapper and Pipelines both
write into DuckDB tables. Each extracted record also carries metadata columns:

- `ingested_at TIMESTAMP`
- `feed_title VARCHAR`
- `article_url VARCHAR`
- `run_id BIGINT`

### Local-first & private

- LLM API keys are used only for the request and are **never written to the server database**; endpoint and
  prompt live in browser `localStorage`.
- No accounts, no telemetry, no network calls except to the feeds and the LLM endpoint you configure.
- Website fetching is limited to public URLs and does not bypass authentication, CAPTCHAs, access controls, or anti-bot protections.

### Optional extraction stages

Pipelines can use only the stages they need:

```text
SOURCE → FETCH → SNAPSHOT → CHANGE DETECTION → TEXT EXTRACTION
                                      ↓
                         CHUNKING → EMBEDDING → LOCAL VECTOR SEARCH
                                      ↓
                         LLM EXTRACTION → VALIDATION → DEDUPLICATION
                                      ↓
                              DUCKDB → OPTIONAL EXPORT / REPLICATION
```

RSS/Atom feeds and website monitors share the source/pipeline model. Embeddings are not required for normal
LLM extraction, and LLMs are not required for snapshots, chunking, or local semantic search with the built-in
local hash index.

---

## Tech stack

**Frontend**
- React 19, Vite, TypeScript
- Tailwind CSS (hand-written shadcn-style UI primitives — no Radix)
- `sonner` toasts, `lucide-react` icons
- Charts: hand-written SVG bar/line components
- Safe JSON parsing helper (`lib/json.ts`) to survive double-encoded payloads

**Backend**
- Flask (port `8765`), serves the built SPA from `frontend/dist` plus `/api`
- DuckDB (`duckstore.py`) for extracted records
- SQLite (`database.py`) for metadata (feeds, schemas, mappings, pipelines, schedules, runs)
- `llm.py` / `extractor.py` for OpenAI-compatible chat-completion extraction
- `feeds.py` for RSS/Atom fetch + parse, optional Playwright browser fetching
- `pipeline.py` for orchestration + the scheduler loop

**Packaging**
- `pyinstaller` spec in `packaging/` builds macOS `.dmg`, Windows installer, Linux `.AppImage`
- GitHub Actions builds per-platform installers on release tags

---

## Getting started

### One-line install (macOS, Linux, Windows)

Pick the line for your platform and paste it into a terminal. No admin rights, no `git`, no `curl`
pre-installed on the target machine required.

#### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.sh | sh
```

No `curl`? Use Python directly (works on every machine with Python):

```bash
python3 -c "$(python3 -c "import urllib.request; print(urllib.request.urlopen('https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.py').read().decode())")"
```

Or download `install.py` and run it:

```bash
python3 install.py
```

#### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/arunavdaniel/Autofeeder/main/install.ps1 | iex
```

Or with the Python script directly:

```bash
python install.py
```

---

### What the installer does

1. Checks for Python 3.10+ in PATH. If missing, downloads a portable Python automatically.
2. Creates a virtual environment at `~/.autofeeder/venv/` (no admin rights needed).
3. Installs the package from PyPI or the latest GitHub release zip.
4. Downloads the Playwright Chromium browser (optional — skip with `--no-browser`).
5. Writes a launcher script at `~/.autofeeder/autofeeder` (or `autofeeder.bat` on Windows).

The installer then opens `http://127.0.0.1:8765` automatically.

---

### Installer options

| Flag | Description |
|---|---|
| `--no-browser` | Skip Playwright Chromium download (browser fetching unavailable) |
| `--dir PATH` | Custom install directory (default: `~/.autofeeder/`) |
| `--version VER` | Install a specific version (default: latest) |
| `--offline --bundle file.zip` | Air-gapped install from a local bundle zip |
| `--ca-bundle /path/to/cert.pem` | Use a custom CA bundle (corporate SSL inspection) |
| `--insecure` | Disable TLS verification (last resort) |
| `--uninstall` | Remove the installation |
| `--dry-run` | Show what would be done without making any changes |

**Examples:**

```bash
# Skip browser download (faster, works where Playwright is blocked)
python3 install.py --no-browser

# Behind a corporate proxy with SSL inspection
python3 install.py --ca-bundle /etc/ssl/corporate.pem

# Fully offline (pre-download the bundle on an internet machine first)
python3 install.py --offline --bundle ~/Downloads/rss-text-reader-bundle.zip

# Uninstall
python3 install.py --uninstall
```

---

### Enterprise environments

The installer is designed to work on locked-down machines:

| Restriction | How it's handled |
|---|---|
| No admin/sudo | Installs entirely to `~/.autofeeder/` (user home) |
| No `git` | Downloads a source zip from GitHub releases or installs via PyPI |
| No `curl`/`wget` | Falls back to Python's built-in `urllib` |
| Old or no system Python | Downloads a self-contained portable Python via [python-build-standalone](https://github.com/indygreg/python-build-standalone) |
| HTTP/HTTPS proxy | Reads `HTTP_PROXY` / `HTTPS_PROXY` env vars automatically |
| NTLM/Kerberos proxy (Windows) | `install.ps1` uses system proxy with default network credentials |
| Custom CA / SSL inspection | Use `--ca-bundle` flag or set `REQUESTS_CA_BUNDLE` env var |
| Playwright download blocked | Use `--no-browser`; the app still works without it |
| Fully air-gapped network | Use `--offline --bundle` with a pre-downloaded zip |

---

### Manual install (developer mode)

If you prefer the traditional approach:

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install -e .
python -m playwright install chromium   # optional
rss-text-reader
```

Use **Auto-refresh** to refresh the selected feed every 15 minutes, 30 minutes, 1 hour, or 6 hours. Choose
**Auto-refresh off** to disable scheduled refreshes.

Use **Delete Feed** to remove one feed while keeping its folder and saved articles. **Delete Folder** removes
the folder, its feeds, and its saved articles after confirmation.

---

## LLM configuration

The **LLM JSON extraction** panel accepts any OpenAI-compatible chat completions endpoint. Enter the endpoint,
model, optional API key, and an extraction prompt. It sends the selected article snapshot to the model and
displays validated JSON. The API key is used only for that request and is not written to the local database;
the endpoint and prompt are kept only in browser local storage.

Examples of compatible endpoints:

- OpenAI — `https://api.openai.com/v1/chat/completions`
- Ollama — `http://localhost:11434/v1/chat/completions`
- LM Studio — `http://localhost:1234/v1/chat/completions`

---

## The Mapper & DuckDB

The **Mapper** page is where schemas meet tables:

1. Pick a **Schema** — its fields appear in a draggable panel (name, type, required badge, description).
2. Pick a **DuckDB database** — existing tables are fetched into a dropdown.
3. Pick an existing **table** (loads its columns) or type a new name.
4. **Drag fields** from the schema panel into the mapping, or click **Add all**. Each becomes a column; edit
   the column name or DuckDB type, or add/delete rows to match exactly what you want.
5. A live `CREATE TABLE` preview shows everything the schema will send to DuckDB (including meta columns).
6. **Create / ensure DuckDB table** writes it; **Save mapping** stores the mapping for reuse.

The **DuckDB** page is the viewer: a sidebar lists every database (the "viewer folder"), selecting one shows its
tables, you can run SQL (read-only by default, with an explicit write mode), preview rows, and
rename/edit/delete databases and tables.

### Mapping and pipeline guarantees

- Selecting a **schema** in the pipeline builder now makes it authoritative: the fields populate the
  extraction schema, validation, and the DuckDB output mappings automatically.
- **Saved Mapper mappings** can be applied directly to a pipeline's output step.
- **JSON/API extraction mappings** bypass the LLM and write extracted columns straight to DuckDB when their
  paths resolve; missing fields are validated like any other record.
- **Website table mode** turns each detected row (via the saved table selector) into a record through
  change detection, instead of running the LLM on the whole page.
- The DuckDB writer reconciles existing tables (`ALTER TABLE` for new columns), supports `append`,
  `overwrite`/`replace`, and `upsert` modes, honors single or comma-separated composite dedupe keys, and
  stamps `ingested_at` automatically. System columns are guarded so mapped fields cannot accidentally
  clobber internal metadata.
- Semantic search skips chunks whose embedding dimension no longer matches the active model, so stale
  indexes never silently return wrong results.

### Website monitoring and change review

Add a public website under **Websites**, choose HTTP or Browser/Playwright, and select a polling frequency.
Each check normalizes the page, removes common boilerplate such as scripts, navigation, footers, and counters,
then compares a content hash with the previous snapshot. If there is no meaningful change, the check stops
without an LLM call. If content changed, Autofeeder stores the old/new snapshot relationship and a unified
diff. The change can be reviewed, ignored, or sent to an extraction pipeline. Raw HTML and clean text remain
local in SQLite metadata storage.

### Embeddings and semantic search

The **Embeddings** page configures chunk size, overlap, strategy, provider, model, endpoint, and result count.
The default local provider creates deterministic vectors without a cloud service. For higher-quality retrieval,
use an OpenAI-compatible endpoint, Ollama, or LM Studio. Indexed chunks are stored in SQLite with document ID,
source/article URL, text, position, model, dimension, and vector JSON. **Semantic Search** embeds a question,
scores local chunks by cosine similarity, and returns the most relevant passages with links back to their sources.

### Export and database upsert

The **Exports** page reads from DuckDB and writes optional copies to CSV, Parquet, JSON, SQLite, or a generated
RSS/JSON feed. Upsert sync can copy rows into SQLite, Postgres, MySQL/MariaDB, Microsoft SQL Server, or Oracle
on a key column (default `url`). Database drivers are optional extras:

```
pip install 'rss-text-reader[sync]'
```

or install individually: `psycopg[binary]`, `pymysql`, `pymssql`, `oracledb`. Without those packages or a live
server, Autofeeder continues to work normally. DSNs look like `mysql://user:pass@localhost:3306/news`,
`mssql://user:pass@localhost:1433/news`, and `oracle://user:pass@localhost:1521/ORCL`.

---

## Scheduling

Open the **Schedules** tab to create automated snapshot schedules independent of pipelines:

- Choose feeds/folders and a max article count.
- Choose interval (every N minutes) or daily (at a time) cadence.
- Set a DuckDB destination (database + optional table, write mode, dedupe key).
- Enable/disable per schedule; the backend scheduler loop runs them and records `last_run`.

---

## Project structure

```
rss-text-reader/
├── rss_reader/            # Flask backend
│   ├── app.py             # app factory / bootstrap
│   ├── web.py             # REST API + SPA serving (routes: feeds, schemas,
│   │                     #   mappings, pipelines, duckdb, schedules, runs, stats)
│   ├── database.py        # SQLite metadata store + helpers
│   ├── duckstore.py       # DuckDB engine (tables, query, import, rename, drop)
│   ├── extractor.py       # extraction orchestration
│   ├── feeds.py           # RSS/Atom fetch + parse, browser fetch
│   ├── llm.py             # OpenAI-compatible LLM client
│   └── pipeline.py        # pipeline run + scheduler loop
├── frontend/
│   └── src/
│       ├── pages/         # overview, sources, schemas, mapper, pipelines,
│       │                 #   duckdb, schedules, stats, run-history, settings
│       ├── lib/           # api.ts, types.ts, json.ts, llm-settings.ts
│       └── components/    # hand-written ui/* primitives, charts
├── packaging/             # pyinstaller spec
├── tests/
├── pyproject.toml
├── start_web.sh
└── README.md
```

---

## Build installers

Install PyInstaller with `python -m pip install pyinstaller`, then run:

```bash
pyinstaller --clean --noconfirm packaging/rss-text-reader.spec
```

Build on the target operating system. The GitHub Actions workflow builds a macOS `.dmg`, Windows `.exe`
installer, and Linux `.AppImage` on every release tag. Windows builds also require NSIS; the workflow installs
it automatically. Installers are unsigned by default and may show an operating-system security warning.

There is no single native installer that can run unchanged on macOS, Windows, and Linux. Each operating system
uses its own executable format and Tk runtime. The release workflow produces one installer per platform; macOS
Intel and Apple Silicon may also require separate builds unless a universal2 dependency build is used.

---

## Data location

- macOS: `~/Library/Application Support/RSS Text Reader`
- Windows: `%APPDATA%/RSS Text Reader`
- Linux: `$XDG_DATA_HOME/RSS Text Reader` or `~/.local/share/RSS Text Reader`
