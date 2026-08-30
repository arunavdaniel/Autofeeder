from rss_reader.database import Database
from rss_reader.extractor import extract_article, html_to_text
from rss_reader.feeds import fetch_feed
from rss_reader.web import create_app
import requests


def test_html_to_text_removes_markup():
    assert (
        html_to_text("<script>ignore</script><p>Hello <b>world</b></p>")
        == "Hello\nworld"
    )


def test_article_includes_all_page_links(monkeypatch):
    monkeypatch.setattr(
        "rss_reader.extractor.download_page",
        lambda url, use_browser=True: (
            '<html><body><h1>Story</h1><p>Full page text.</p><a href="/more">More</a></body></html>'
        ),
    )
    article = extract_article({"title": "Story", "url": "https://example.com/story"})
    assert "Full page text." in article["text"]
    assert "https://example.com/more" in article["text"]


def test_article_uses_rendered_browser_html(monkeypatch):
    monkeypatch.setattr(
        "rss_reader.extractor.download_page",
        lambda url, use_browser=True: "<html><body><p>Rendered by browser</p></body></html>",
    )
    article = extract_article({"title": "Dynamic", "url": "https://example.com"})
    assert "Rendered by browser" in article["text"]


def test_article_without_feed_or_page_text_has_useful_fallback(monkeypatch):
    monkeypatch.setattr(
        "rss_reader.extractor.download_page",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            requests.RequestException("offline")
        ),
    )
    article = extract_article({"title": "Announcement", "url": "https://example.com"})
    assert "Announcement" in article["text"]
    assert "https://example.com" in article["text"]


def test_feed_parser_reads_local_http_feed(monkeypatch):
    class Response:
        content = b"<rss version='2.0'><channel><title>Example</title><item><title>Story</title><link>https://example.com/story</link><description>Hello</description></item></channel></rss>"

        def raise_for_status(self):
            pass

    monkeypatch.setattr(
        "rss_reader.feeds.requests.get", lambda *args, **kwargs: Response()
    )
    result = fetch_feed("https://example.com/feed.xml")
    assert result["title"] == "Example"
    assert result["items"][0]["title"] == "Story"


def test_database_folder_and_saved_article(tmp_path):
    db = Database(tmp_path / "reader.sqlite3")
    folder_id = db.add_folder("News")
    db.save_article(
        folder_id, {"title": "Story", "url": "https://example.com", "text": "Text"}
    )
    assert db.saved_articles(folder_id)[0]["title"] == "Story"
    db.close()


def test_web_app_folder_api(tmp_path):
    client = create_app(tmp_path / "web.sqlite3").test_client()
    response = client.post("/api/folders", json={"name": "Research"})
    assert response.status_code == 201
    assert client.get("/api/folders").get_json()[0]["name"] == "Research"
