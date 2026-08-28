from __future__ import annotations

import json

import requests


def extract_json(
    endpoint: str, model: str, api_key: str, prompt: str, snapshot: str
) -> object:
    if not endpoint or not model or not prompt or not snapshot:
        raise ValueError("Endpoint, model, prompt, and snapshot are required.")
    endpoint = normalize_endpoint(endpoint)
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": "Return only valid JSON. Do not include Markdown fences or commentary.",
            },
            {"role": "user", "content": f"{prompt}\n\nSNAPSHOT:\n{snapshot}"},
        ],
    }
    response = requests.post(endpoint, headers=headers, json=payload, timeout=180)
    response.raise_for_status()
    body = response.json()
    try:
        content = body["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(
            "The LLM response did not contain chat completion content."
        ) from exc
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("The LLM returned text that was not valid JSON.") from exc


def normalize_endpoint(endpoint: str) -> str:
    endpoint = endpoint.strip()
    if endpoint.rstrip("/").endswith(("/openai", "/v1", "/v1beta")):
        return endpoint.rstrip("/") + "/chat/completions"
    return endpoint


def generate_schema(endpoint: str, model: str, api_key: str, prompt: str) -> dict:
    result = extract_json(
        endpoint,
        model,
        api_key,
        "Create a JSON Schema for this extraction request. Return only a JSON object with "
        "type=object and properties. Use only string, number, integer, boolean, array, or object types.\n\n"
        + prompt,
        "The schema must describe the fields to extract.",
    )
    if (
        not isinstance(result, dict)
        or result.get("type") != "object"
        or not isinstance(result.get("properties"), dict)
    ):
        raise ValueError("The model did not return an object JSON Schema.")
    allowed = {"string", "number", "integer", "boolean", "array", "object"}
    for name, definition in result["properties"].items():
        if (
            not isinstance(name, str)
            or not isinstance(definition, dict)
            or definition.get("type") not in allowed
        ):
            raise ValueError(f"Invalid schema field: {name}")
    return result
