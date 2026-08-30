from rss_reader.pipeline import schema_from_fields, write_outputs, run_pipeline
from rss_reader.database import Database
from pathlib import Path


def test_schema_is_generated_from_manual_fields():
    schema = schema_from_fields(
        [
            {"name": "company", "type": "string", "required": True},
            {"name": "amount", "type": "number", "required": False},
        ]
    )
    assert schema["required"] == ["company"]
    assert schema["properties"]["amount"]["type"] == "number"


def test_csv_output_uses_schema_fields(tmp_path):
    result = write_outputs(
        [{"company": "Example", "amount": 10}],
        {"type": "csv", "path": str(tmp_path / "records.csv")},
        schema_from_fields([{"name": "company"}, {"name": "amount"}]),
    )
    assert result["records"] == 1
    assert "company,amount" in (tmp_path / "records.csv").read_text()


def test_pipeline_run_with_api_source(monkeypatch, tmp_path):
    def mock_fetch_feed(url):
        return {
            "title": "Mock API",
            "items": [
                {
                    "title": "Article A",
                    "url": "https://example.com/a",
                    "content": "This is content from Article A",
                    "published": "2026-08-29"
                }
            ]
        }
    monkeypatch.setattr("rss_reader.pipeline.fetch_feed", mock_fetch_feed)

    db = Database(tmp_path / "test.sqlite3")
    definition = {
        "source": {
            "type": "api",
            "url": "https://example.com/api/v1/news.json"
        },
        "fields": [
            {"name": "title", "type": "string"}
        ],
        "output": {
            "type": "sqlite",
            "path": str(tmp_path / "output.sqlite3"),
            "table": "results"
        }
    }
    
    res = run_pipeline(db, definition)
    assert len(res["records"]) == 1


def test_pipeline_transforms_chain(monkeypatch, tmp_path):
    def mock_fetch_feed(url):
        if "source-a" in url:
            return {
                "title": "API A",
                "items": [
                    {"title": "Acquisition News", "url": "https://example.com/a", "content": "Microsoft buys GitHub", "published": "2026-08-29"}
                ]
            }
        else:
            return {
                "title": "API B",
                "items": [
                    {"title": "Sports News", "url": "https://example.com/b", "content": "Arsenal wins the match", "published": "2026-08-29"}
                ]
            }
            
    monkeypatch.setattr("rss_reader.pipeline.fetch_feed", mock_fetch_feed)
    
    def mock_extract_json(endpoint, model, api_key, prompt, body, timeout):
        if "sentiment" in prompt:
            return {"sentiment": "positive"}
        return {}
        
    monkeypatch.setattr("rss_reader.pipeline.extract_json", mock_extract_json)
    
    db = Database(tmp_path / "test.sqlite3")
    definition = {
        "sources": [
            {"type": "api", "url": "https://example.com/source-a"},
            {"type": "api", "url": "https://example.com/source-b"}
        ],
        "transforms": [
            {
                "type": "keyword_filter",
                "keywords": ["GitHub", "Microsoft"]
            },
            {
                "type": "extract",
                "mode": "raw",
                "schema_id": None
            },
            {
                "type": "enrich_llm",
                "output_field": "sentiment",
                "prompt": "Evaluate the sentiment of this text.",
                "llm": {"enabled": True, "endpoint": "https://api.openai.com", "model": "gpt-4o-mini"}
            }
        ],
        "fields": [
            {"name": "title", "type": "string"},
            {"name": "sentiment", "type": "string"}
        ],
        "output": {
            "type": "sqlite",
            "path": str(tmp_path / "output.sqlite3"),
            "table": "results"
        }
    }
    
    res = run_pipeline(db, definition)
    assert len(res["records"]) == 1
    assert res["records"][0]["title"] == "Acquisition News"
    assert res["records"][0]["sentiment"] == "positive"


def test_pipeline_chunk_stream_splitting(monkeypatch, tmp_path):
    def mock_fetch_feed(url):
        return {
            "title": "Document Title",
            "items": [
                {
                    "title": "Article A",
                    "url": "https://example.com/a",
                    "content": "Paragraph one: Microsoft is a technology company.\n\nParagraph two: The weather is sunny in California.",
                    "published": "2026-08-29"
                }
            ]
        }
    monkeypatch.setattr("rss_reader.pipeline.fetch_feed", mock_fetch_feed)
    
    db = Database(tmp_path / "test.sqlite3")
    definition = {
        "sources": [
            {"type": "api", "url": "https://example.com/source"}
        ],
        "transforms": [
            {
                "type": "chunk",
                "chunk_size": 40,
                "chunk_overlap": 0,
                "strategy": "paragraph",
                "split_pipeline_stream": True,
                "generate_vectors": False
            },
            {
                "type": "keyword_filter",
                "keywords": ["Microsoft"]
            }
        ],
        "fields": [
            {"name": "title", "type": "string"},
            {"name": "text", "type": "string"}
        ],
        "output": {
            "type": "sqlite",
            "path": str(tmp_path / "output.sqlite3"),
            "table": "results"
        }
    }
    
    res = run_pipeline(db, definition)
    # The article has 2 paragraphs split by double newline.
    # Chunk 1: "Paragraph one: Microsoft is a technology company."
    # Chunk 2: "Paragraph two: The weather is sunny in California."
    # The keyword filter keeps only Chunk 1.
    assert len(res["records"]) == 1
    assert "Microsoft" in res["records"][0]["text"]
    assert "California" not in res["records"][0]["text"]
    assert res["records"][0]["title"] == "Article A (Chunk 1)"


def test_resolve_keywords_merges_saved(tmp_path):
    from rss_reader.pipeline import resolve_keywords

    db = Database(tmp_path / "kw.sqlite3")
    db.add_keyword("GitHub")
    words = resolve_keywords({"use_saved_keywords": True, "keywords_str": "AI, GitHub"}, db)
    assert words == ["ai", "github"]


def test_pipeline_chunk_extract_then_synthesize(monkeypatch, tmp_path):
    def mock_fetch_feed(url):
        return {
            "title": "Document Title",
            "items": [
                {
                    "title": "Article A",
                    "url": "https://example.com/a",
                    "content": "Paragraph one: Microsoft is a technology company.\n\nParagraph two: The weather is sunny in California.",
                    "published": "2026-08-29",
                }
            ],
        }

    monkeypatch.setattr("rss_reader.pipeline.fetch_feed", mock_fetch_feed)

    fetch_calls = []

    def mock_extract_article(item, *args, **kwargs):
        fetch_calls.append(item.get("title"))
        return {
            "title": item.get("title"),
            "url": item.get("url"),
            "text": item.get("text"),
            "source": item.get("source") or "",
            "published": item.get("published") or "",
            "links": [],
        }

    monkeypatch.setattr("rss_reader.pipeline.extract_article", mock_extract_article)

    prompts = []

    def mock_extract_json(endpoint, model, api_key, prompt, body, timeout=None):
        prompts.append(prompt)
        if "this passage" in prompt.lower():
            assert "Microsoft" in body or "California" in body
            return {"relevant": True, "excerpt": body[:40]}
        assert "passages" in body
        return {"company": "Microsoft", "summary": "combined"}

    monkeypatch.setattr("rss_reader.pipeline.extract_json", mock_extract_json)

    db = Database(tmp_path / "test.sqlite3")
    definition = {
        "sources": [{"type": "api", "url": "https://example.com/source"}],
        "transforms": [
            {"type": "extract", "role": "fetch", "mode": "raw"},
            {
                "type": "chunk",
                "chunk_size": 40,
                "chunk_overlap": 0,
                "strategy": "paragraph",
                "split_pipeline_stream": True,
                "generate_vectors": False,
                "filter_by_keywords": True,
            },
            {
                "type": "extract",
                "role": "chunk",
                "mode": "llm",
                "prompt": "Extract facts from this passage only.",
                "llm": {"enabled": True, "endpoint": "https://api.openai.com", "model": "gpt-4o-mini"},
            },
            {
                "type": "synthesize",
                "prompt": "Combine the passage extracts into one article record.",
                "llm": {"enabled": True, "endpoint": "https://api.openai.com", "model": "gpt-4o-mini"},
            },
        ],
        "fields": [
            {"name": "company", "type": "string"},
            {"name": "summary", "type": "string"},
        ],
        "output": {
            "type": "sqlite",
            "path": str(tmp_path / "output.sqlite3"),
            "table": "results",
        },
    }
    db.add_keyword("Microsoft")
    res = run_pipeline(db, definition)
    assert fetch_calls == ["Article A"]
    assert len(res["records"]) == 1
    assert res["records"][0]["company"] == "Microsoft"
    assert res["records"][0]["summary"] == "combined"
    assert len(prompts) == 2
    assert "this passage" in prompts[0].lower()
    assert "combine the passage" in prompts[1].lower()

