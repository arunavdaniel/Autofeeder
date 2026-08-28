from rss_reader.llm import extract_json


def test_openai_compatible_response_is_json(monkeypatch):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "choices": [{"message": {"content": '```json\n{"topic": "rss"}\n```'}}]
            }

    monkeypatch.setattr(
        "rss_reader.llm.requests.post", lambda *args, **kwargs: Response()
    )
    assert extract_json(
        "http://localhost/v1/chat/completions",
        "local-model",
        "",
        "Extract topic",
        "RSS text",
    ) == {"topic": "rss"}
