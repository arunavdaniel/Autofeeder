from rss_reader.pipeline import schema_from_fields, write_outputs


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
