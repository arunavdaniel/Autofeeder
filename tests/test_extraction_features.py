from rss_reader.chunker import chunk_text
from rss_reader.database import Database
from rss_reader.embeddings import catalog, normalize_endpoint
from rss_reader.vectorstore import index_document, search
from rss_reader.website import diff_text, normalize_html, preview_html, selector_preview
from rss_reader.json_mapping import get_path, map_records
from rss_reader import duckstore


def test_chunking_preserves_content_and_bounds_size():
    chunks = chunk_text(
        "one two three four five six seven eight nine ten",
        size=20,
        overlap=4,
        strategy="sentence",
    )
    assert chunks
    assert all(len(chunk) <= 20 for chunk in chunks)
    assert "one" in chunks[0]


def test_embedding_catalog_lists_real_models():
    data = catalog()
    ids = {p["id"] for p in data["providers"]}
    assert {"local", "openai", "ollama", "lmstudio", "gemini"} <= ids
    openai = next(p for p in data["providers"] if p["id"] == "openai")
    assert any(m["id"] == "text-embedding-3-small" for m in openai["models"])
    local = next(p for p in data["providers"] if p["id"] == "local")
    assert any(m["id"] == "all-MiniLM-L6-v2" for m in local["models"])
    assert normalize_endpoint("https://api.openai.com/v1") == "https://api.openai.com/v1/embeddings"


def test_embedding_config_and_search_api(tmp_path):
    from rss_reader.web import create_app

    client = create_app(tmp_path / "emb.sqlite3").test_client()
    models = client.get("/api/embeddings/models")
    assert models.status_code == 200
    assert models.get_json()["providers"]

    saved = client.post(
        "/api/embeddings/config",
        json={"provider": "local", "model": "local-hash"},
    )
    assert saved.status_code == 200
    assert saved.get_json()["model"] == "local-hash"

    index = client.post(
        "/api/embeddings/index",
        json={
            "document_id": "doc-1",
            "text": "Microsoft announced a new acquisition.",
            "metadata": {"article_title": "Deal"},
            "config": {"provider": "local", "model": "local-hash", "generate_vectors": True},
        },
    )
    assert index.status_code == 200
    hit = client.post(
        "/api/embeddings/search",
        json={"query": "Microsoft acquisition", "config": {"provider": "local", "model": "local-hash", "top_k": 1}},
    )
    assert hit.status_code == 200
    assert hit.get_json()["results"][0]["article_title"] == "Deal"


def test_local_vectors_support_semantic_search(tmp_path):
    database = Database(tmp_path / "vectors.sqlite3")
    index_document(
        database,
        "article-1",
        "Microsoft announced a new acquisition.",
        {"article_title": "Deal"},
        {"provider": "local", "model": "local-hash", "chunk_size": 100},
    )
    results = search(
        database,
        "Microsoft acquisition",
        {"provider": "local", "model": "local-hash", "top_k": 1},
    )
    assert results[0]["article_title"] == "Deal"


def test_website_normalization_and_diff():
    assert (
        normalize_html("<nav>Menu</nav><main>Hello</main><script>x</script>") == "Hello"
    )
    assert "+new" in diff_text("old", "new")


def test_website_selector_preview_extracts_tables_safely():
    html = "<main><script>alert(1)</script><table><tr><th>Name</th><th>Price</th></tr><tr><td>Widget</td><td>10</td></tr></table></main>"
    assert "script" not in preview_html(html).lower()
    result = selector_preview(html, "table", "table")
    assert result["match_count"] == 1
    assert result["tables"][0]["rows"] == [["Widget", "10"]]


def test_website_clean_result_respects_content_selector():
    from rss_reader.fetchers import FetchResult
    from rss_reader.website import _clean_from_result

    html = "<div id='noise'>Ads</div><article><p>Main story content.</p></article>"
    result = FetchResult(
        url="https://example.com",
        html=html,
        text="",
        title="Story",
        backend="http",
        status_code=200,
        duration_ms=10,
        content_type="text/html",
    )
    text = _clean_from_result(result, {"content_selector": "article", "url": "https://example.com"})
    assert "Main story" in text
    assert "Ads" not in text


def test_json_mapping_resolves_nested_paths():
    payload = {"data": [{"name": "Widget", "price": {"usd": 10}}]}
    assert get_path(payload, "data.0.price.usd") == 10
    records = map_records(
        payload,
        {
            "item_pointer": "data",
            "fields": [
                {"schema_field": "name", "json_path": "name"},
                {"schema_field": "price", "json_path": "price.usd"},
            ],
        },
    )
    assert records == [{"name": "Widget", "price": 10}]


def test_hybrid_search_filters(tmp_path):
    database = Database(tmp_path / "hybrid_vectors.sqlite3")
    config = {"provider": "local", "model": "local-hash", "chunk_size": 100}
    index_document(
        database,
        "doc-1",
        "Microsoft acquired GitHub recently.",
        {
            "article_title": "MS GitHub",
            "source": "TechNews",
            "published": "2026-08-01",
        },
        config,
    )
    index_document(
        database,
        "doc-2",
        "Apple announced new vision pro headset.",
        {
            "article_title": "Apple Vision",
            "source": "GadgetFeed",
            "published": "2026-08-15",
        },
        config,
    )

    # Test keywords filter
    results_kw = search(database, "", config, keywords="github")
    assert len(results_kw) == 1
    assert results_kw[0]["article_title"] == "MS GitHub"

    # Test source filter
    results_src = search(database, "announced", config, source="GadgetFeed")
    assert len(results_src) == 1
    assert results_src[0]["article_title"] == "Apple Vision"

    # Test date filter
    results_date = search(database, "announced", config, date_from="2026-08-10")
    assert len(results_date) == 1
    assert results_date[0]["article_title"] == "Apple Vision"


def test_duckdb_database_info_reports_tables_and_file_stats(tmp_path):
    db_file = tmp_path / "meta.duckdb"
    duckstore.write_records(
        str(db_file),
        "articles",
        [{"title": "Hello", "url": "https://example.com"}],
        mappings=[
            {"source": "title", "target": "title", "type": "string"},
            {"source": "url", "target": "url", "type": "string"},
        ],
    )
    info = duckstore.database_info(str(db_file))
    assert info["exists"] is True
    assert info["table_count"] == 1
    assert info["total_rows"] == 1
    assert info["tables"][0]["name"] == "articles"
    assert info["tables"][0]["columns"] >= 2
    assert info["file_size_bytes"] > 0


def test_duckdb_table_preview_supports_pagination(tmp_path):
    db_file = tmp_path / "pages.duckdb"
    records = [{"title": f"Row {i}", "url": f"https://example.com/{i}"} for i in range(5)]
    duckstore.write_records(
        str(db_file),
        "items",
        records,
        mappings=[
            {"source": "title", "target": "title", "type": "string"},
            {"source": "url", "target": "url", "type": "string"},
        ],
    )
    page = duckstore.table_preview(str(db_file), "items", limit=2, offset=2)
    assert page["total_rows"] == 5
    assert page["offset"] == 2
    assert page["row_count"] == 2

    db_file = tmp_path / "test_duck.duckdb"

    # Write a test record using duckstore
    records = [
        {
            "title": "Microsoft acquisitions",
            "url": "https://example.com/ms-deal",
            "text": "Microsoft plans to acquire Tenax in a major deal.",
            "_meta": {"url": "https://example.com/ms-deal"},
        }
    ]
    mappings = [
        {"source": "title", "target": "title", "type": "string"},
        {"source": "url", "target": "url", "type": "string"},
        {"source": "text", "target": "text", "type": "string"},
    ]
    duckstore.write_records(str(db_file), "articles", records, mappings=mappings)

    # 1. Test find_record_by_url returns _database_name and _table_name
    rec = duckstore.find_record_by_url([str(db_file)], "https://example.com/ms-deal")
    assert rec is not None
    assert rec["_database_name"] == str(db_file)
    assert rec["_table_name"] == "articles"
    assert rec["title"] == "Microsoft acquisitions"

    # 2. Test search_duckdb_records
    results = duckstore.search_duckdb_records([str(db_file)], "Tenax", "acquisitions")
    assert len(results) == 1
    assert results[0]["article_title"] == "Microsoft acquisitions"
    assert results[0]["duckdb_record"]["_table_name"] == "articles"


def test_keywords_crud_and_filtering(tmp_path):
    db = Database(tmp_path / "test_kw.sqlite3")

    assert len(db.keywords()) == 0

    kw_id = db.add_keyword("Acquisition", "business")
    assert kw_id > 0

    kws = db.keywords()
    assert len(kws) == 1
    assert kws[0]["word"] == "Acquisition"
    assert kws[0]["category"] == "business"

    db.delete_keyword(kw_id)
    assert len(db.keywords()) == 0


def test_json_api_source_parsing(monkeypatch):
    class Response:
        content = b'{"items": [{"title": "API item", "url": "https://example.com/api-item", "text": "API content"}]}'
        headers = {"content-type": "application/json"}

        def raise_for_status(self):
            pass

        def json(self):
            import json

            return json.loads(self.content.decode("utf-8"))

    monkeypatch.setattr(
        "rss_reader.feeds.requests.get", lambda *args, **kwargs: Response()
    )
    from rss_reader.feeds import fetch_feed

    result = fetch_feed("https://example.com/api/v1/news")
    assert result["title"] == "JSON API"
    assert len(result["items"]) == 1
    assert result["items"][0]["title"] == "API item"
    assert result["items"][0]["url"] == "https://example.com/api-item"
    assert result["items"][0]["content"] == "API content"


def test_duckdb_search_with_column_filters(tmp_path):
    import duckdb

    db_path = tmp_path / "test_search.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute("CREATE TABLE mock_table (author VARCHAR, title VARCHAR, score INT)")
    con.execute("INSERT INTO mock_table VALUES ('Microsoft', 'Azure deal', 10)")
    con.execute("INSERT INTO mock_table VALUES ('Google', 'DeepMind alpha', 20)")
    con.close()

    # Run search with column filter
    results = duckstore.search_duckdb_records(
        [str(db_path)],
        query="",
        keywords="",
        table_name="mock_table",
        column_filters={"author": "Microsoft"},
    )
    assert len(results) == 1
    assert results[0]["duckdb_record"]["author"] == "Microsoft"
    assert results[0]["duckdb_record"]["title"] == "Azure deal"

    # Search with another filter
    results2 = duckstore.search_duckdb_records(
        [str(db_path)],
        query="",
        keywords="",
        table_name="mock_table",
        column_filters={"score": "20"},
    )
    assert len(results2) == 1
    assert results2[0]["duckdb_record"]["author"] == "Google"


def test_write_records_reconciles_columns_and_sets_ingested_at(tmp_path):
    db_path = str(tmp_path / "reconcile.duckdb")
    duckstore.write_records(
        db_path,
        "articles",
        [{"title": "First"}],
        mappings=[{"source": "title", "target": "title", "type": "string"}],
    )
    duckstore.write_records(
        db_path,
        "articles",
        [{"title": "Second", "author": "Arun"}],
        mappings=[
            {"source": "title", "target": "title", "type": "string"},
            {"source": "author", "target": "author", "type": "string"},
        ],
    )
    columns = {c["column"] for c in duckstore.table_schema(db_path, "articles")}
    assert "author" in columns
    assert "ingested_at" in columns
    assert "website_id" in columns
    preview = duckstore.table_preview(db_path, "articles", limit=50)
    payload = [dict(zip(preview["columns"], row)) for row in preview["rows"]]
    assert len(payload) == 2
    assert all(row.get("ingested_at") for row in payload)


def test_write_records_dedupe_and_reserved_guard(tmp_path):
    db_path = str(tmp_path / "dedupe.duckdb")
    mappings = [
        {"source": "url", "target": "url", "type": "string"},
        {"source": "title", "target": "title", "type": "string"},
    ]
    first = duckstore.write_records(
        db_path,
        "t",
        [
            {
                "url": "https://example.com/1",
                "title": "A",
                "_meta": {"url": "https://example.com/1"},
            }
        ],
        mappings=mappings,
        dedupe_key="url",
    )
    assert first["records"] == 1
    second = duckstore.write_records(
        db_path,
        "t",
        [
            {
                "url": "https://example.com/1",
                "title": "B",
                "_meta": {"url": "https://example.com/1"},
            }
        ],
        mappings=mappings,
        dedupe_key="url",
    )
    assert second["records"] == 0
    upsert = duckstore.write_records(
        db_path,
        "t",
        [
            {
                "url": "https://example.com/1",
                "title": "Updated",
                "_meta": {"url": "https://example.com/1"},
            }
        ],
        mappings=mappings,
        mode="upsert",
        dedupe_key="url",
    )
    preview = duckstore.table_preview(db_path, "t", limit=50)
    payload = [dict(zip(preview["columns"], row)) for row in preview["rows"]]
    assert len(payload) == 1
    assert payload[0]["title"] == "Updated"
    import pytest

    with pytest.raises(ValueError):
        duckstore.write_records(
            db_path,
            "t",
            [{"run_id": 1}],
            mappings=[{"source": "run_id", "target": "run_id", "type": "integer"}],
        )


def test_resolve_definition_fills_schema_fields_and_mappings(tmp_path):
    from rss_reader.pipeline import resolve_definition

    database = Database(tmp_path / "resolve.sqlite3")
    schema_id = database.save_schema(
        "test",
        fields=[{"name": "price", "type": "number", "required": True}],
    )
    definition = {
        "schema_id": schema_id,
        "output": {"type": "duckdb", "table": "items"},
    }
    resolved = resolve_definition(database, definition)
    assert resolved["fields"] == [{"name": "price", "type": "number", "required": True}]
    assert resolved["schema"]["properties"]["price"]["type"] == "number"
    assert resolved["output"]["mappings"] == [
        {"source": "price", "target": "price", "type": "DOUBLE"}
    ]


def test_unified_snapshots_include_name(tmp_path):
    db = Database(tmp_path / "snaps.sqlite3")
    snap_id = db.create_snapshot("Morning capture", "feed", "HN")
    db.add_snapshot_article(snap_id, {"title": "A", "url": "https://example.com", "text": "hi"})
    rows = db.unified_snapshots()
    assert rows[0]["name"] == "Morning capture"
    assert rows[0]["kind"] == "feed"
    assert rows[0]["article_count"] == 1


def test_sanitize_playwright_env_drops_missing_cache(tmp_path, monkeypatch):
    from rss_reader.fetchers import sanitize_playwright_env

    missing = tmp_path / "no-browsers"
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(missing))
    sanitize_playwright_env()
    assert "PLAYWRIGHT_BROWSERS_PATH" not in __import__("os").environ


def test_download_page_skips_browser_when_disabled(monkeypatch):
    from rss_reader.extractor import download_page

    calls = []

    def fake_fetch(url, backend="http", options=None):
        calls.append(backend)
        from rss_reader.fetchers import FetchResult

        return FetchResult(url=url, html="<html><body>ok</body></html>", backend=backend)

    monkeypatch.setattr("rss_reader.fetchers.fetch_page", fake_fetch)
    html = download_page("https://example.com", use_browser=False)
    assert "ok" in html
    assert calls == ["http"]

