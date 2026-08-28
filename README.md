# Autofeedly

Autofeedly is a local web automation tool that turns RSS/Atom feeds into extracted text, structured JSON, CSV files, or SQLite records.

## Run from source

Python 3.10+ is required.

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\\Scripts\\activate
python -m pip install -e .
rss-text-reader
```

Playwright also needs its browser runtime:

```bash
python -m playwright install chromium
```

The command starts the server and opens `http://127.0.0.1:8765` automatically. Use `rss-text-reader --no-browser` when you want to open the URL manually.

Use **Auto-refresh** to refresh the selected feed every 15 minutes, 30 minutes, 1 hour, or 6 hours. Choose **Auto-refresh off** to disable scheduled refreshes.

The **LLM JSON extraction** panel accepts any OpenAI-compatible chat completions endpoint. Enter the endpoint, model, optional API key, and an extraction prompt. It sends the selected article snapshot to the model and displays validated JSON. The API key is used only for that request and is not written to the local database; the endpoint and prompt are kept only in browser local storage.

Examples of compatible endpoints include OpenAI, Ollama (`http://localhost:11434/v1/chat/completions`), and LM Studio (`http://localhost:1234/v1/chat/completions`).

## Pipeline builder

Open `http://127.0.0.1:8765/pipelines` to create an automated extraction pipeline. Select feeds, configure the optional LLM prompt, add schema fields manually, choose CSV or SQLite output, and use **Preview** to process one article before saving the pipeline. The saved pipeline can then be run from the pipeline dashboard.

Use **Delete Feed** to remove one feed while keeping its folder and saved articles. **Delete Folder** removes the folder, its feeds, and its saved articles after confirmation.

## Build installers

Install PyInstaller with `python -m pip install pyinstaller`, then run:

```bash
pyinstaller --clean --noconfirm packaging/rss-text-reader.spec
```

Build on the target operating system. The GitHub Actions workflow builds a macOS `.dmg`, Windows `.exe` installer, and Linux `.AppImage` on every release tag. Windows builds also require NSIS; the workflow installs it automatically. Installers are unsigned by default and may show an operating-system security warning.

There is no single native installer that can run unchanged on macOS, Windows, and Linux. Each operating system uses its own executable format and Tk runtime. The release workflow produces one installer per platform; macOS Intel and Apple Silicon may also require separate builds unless a universal2 dependency build is used.

## Data location

- macOS: `~/Library/Application Support/RSS Text Reader`
- Windows: `%APPDATA%/RSS Text Reader`
- Linux: `$XDG_DATA_HOME/RSS Text Reader` or `~/.local/share/RSS Text Reader`
