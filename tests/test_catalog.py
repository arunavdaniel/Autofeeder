from rss_reader import catalog
from rss_reader.database import Database
from rss_reader.web import create_app

FIXTURE_CATALOG = {
    "feeds": [
        {
            "id": "tidings:hn-front",
            "title": "Hacker News",
            "url": "https://hnrss.org/frontpage",
            "category": "Technology",
            "description": "Top stories",
            "catalog_source": "tidings",
        }
    ],
    "apis": [
        {
            "id": "agent-api:cataas",
            "name": "Cataas",
            "url": "https://cataas.com/api/cats?tags=cute",
            "category": "Animals",
            "description": "Cat pictures",
            "fields": [{"schema_field": "id", "json_path": "id"}],
            "catalog_source": "agent-public-apis",
        }
    ],
    "websites": [
        {
            "id": "feedseek:reuters",
            "name": "Reuters",
            "url": "https://www.reuters.com/",
            "category": "News & Media",
            "description": "Reuters homepage",
            "fetch_method": "http",
            "frequency": "6h",
            "catalog_source": "feedseek",
        }
    ],
}


def _mock_catalog(*, refresh: bool = False):
    del refresh
    return FIXTURE_CATALOG


def _mock_load_kind(kind: str):
    return FIXTURE_CATALOG[kind]


def test_catalog_loads_and_filters(monkeypatch):
    monkeypatch.setattr(catalog, "load_kind", _mock_load_kind)

    data = catalog.load_catalog()
    assert len(data["feeds"]) == 1
    assert len(data["apis"]) == 1
    assert len(data["websites"]) == 1

    items, _total = catalog.search_catalog("feeds", category="Technology")
    assert items
    assert all(item.get("category") == "Technology" for item in items)

    hits, _ = catalog.search_catalog("feeds", query="hacker")
    assert any("Hacker" in str(item.get("title")) for item in hits)


def test_catalog_install_feeds_skips_duplicates(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "load_kind", _mock_load_kind)
    database = Database(tmp_path / "catalog.sqlite3")

    first = catalog.install_catalog_items(database, "feeds", ["tidings:hn-front"])
    second = catalog.install_catalog_items(database, "feeds", ["tidings:hn-front"])

    assert first["added"] == 1
    assert second["skipped"] == 1
    assert database.connection.execute("SELECT COUNT(*) FROM feeds").fetchone()[0] == 1


def test_catalog_install_api_and_website(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "load_kind", _mock_load_kind)
    database = Database(tmp_path / "catalog.sqlite3")

    api_result = catalog.install_catalog_items(database, "apis", ["agent-api:cataas"])
    site_result = catalog.install_catalog_items(database, "websites", ["feedseek:reuters"])

    assert api_result["added"] == 1
    assert site_result["added"] == 1
    assert database.connection.execute("SELECT COUNT(*) FROM api_sources").fetchone()[0] == 1
    assert database.connection.execute("SELECT COUNT(*) FROM websites").fetchone()[0] == 1


def test_catalog_annotate_installed(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "load_kind", _mock_load_kind)
    database = Database(tmp_path / "catalog.sqlite3")
    items, _ = catalog.search_catalog("apis")
    item = items[0]
    catalog.install_catalog_items(database, "apis", [item["id"]])

    annotated = catalog.annotate_installed(database, "apis", [item])
    assert annotated[0]["installed"] is True


def test_catalog_api_endpoints(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "load_kind", _mock_load_kind)
    client = create_app(tmp_path / "web.sqlite3").test_client()

    summary = client.get("/api/catalog/summary")
    assert summary.status_code == 200
    body = summary.get_json()
    assert body["feeds"] == 1

    listing = client.get("/api/catalog?kind=feeds&q=tech")
    assert listing.status_code == 200
    assert listing.get_json()["count"] >= 1

    install = client.post(
        "/api/catalog/install",
        json={"kind": "feeds", "ids": ["tidings:hn-front"]},
    )
    assert install.status_code == 201
    assert install.get_json()["added"] == 1


def test_catalog_providers_normalize_tidings():
    from rss_reader import catalog_providers

    payload = {
        "feeds": [
            {
                "id": "abc",
                "title": "Example",
                "feed_url": "https://example.com/feed.xml",
                "site_url": "https://example.com",
                "category": "Technology",
                "description": "Demo",
            },
            {
                "id": "xyz",
                "title": "Other",
                "feed_url": "https://example.com/other.xml",
                "category": "Technology",
                "description": "Technology 订阅源",
            },
        ]
    }
    items = catalog_providers._normalize_tidings_feeds(payload)
    assert items[0]["id"] == "tidings:abc"
    assert items[0]["url"] == "https://example.com/feed.xml"
    assert items[1]["description"] == "Technology source"


def test_plenary_opml_parse_and_merge():
    from rss_reader import catalog_providers

    opml = """<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline type="rss" xmlUrl="https://example.com/rss.xml" title="Example RSS" description="A feed"/>
    </outline>
  </body>
</opml>
"""
    items = catalog_providers._parse_opml_outlines(opml, "Tech")
    assert len(items) == 1
    assert items[0]["url"] == "https://example.com/rss.xml"
    assert items[0]["category"] == "Tech"
    assert items[0]["id"].startswith("plenary:")
    assert items[0]["catalog_source"] == "plenary"

    merged = catalog_providers._merge_feed_catalogs(
        [{"url": "https://example.com/rss.xml", "title": "Tidings copy", "catalog_source": "tidings"}],
        items,
    )
    assert len(merged) == 1
    assert merged[0]["catalog_source"] == "tidings"


def test_catalog_sources_includes_plenary(monkeypatch):
    monkeypatch.setattr(catalog, "load_kind", _mock_load_kind)
    sources = catalog.catalog_sources()
    ids = {row["id"] for row in sources["feed_catalogs"]}
    assert "plenary" in ids
    assert "tidings" in ids
    assert sources["feeds"]["id"] == "tidings-plenary"
