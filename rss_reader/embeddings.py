from __future__ import annotations

import hashlib
import math
from functools import lru_cache
from typing import Any, Iterable

import requests

EMBEDDING_PROVIDERS: dict[str, dict[str, Any]] = {
    "local": {
        "id": "local",
        "name": "Local",
        "description": "Runs on this machine. Hash needs nothing extra; MiniLM/MPNet/BGE need sentence-transformers.",
        "default_endpoint": "",
        "needs_key": False,
        "models": [
            {
                "id": "local-hash",
                "name": "Hash vectors",
                "dims": 256,
                "notes": "No download. Fine for keyword-ish ranking, not true semantics.",
            },
            {
                "id": "all-MiniLM-L6-v2",
                "name": "MiniLM L6 v2",
                "dims": 384,
                "notes": "Fast, good default local model (sentence-transformers).",
            },
            {
                "id": "all-mpnet-base-v2",
                "name": "MPNet base v2",
                "dims": 768,
                "notes": "Stronger English quality, slower than MiniLM.",
            },
            {
                "id": "BAAI/bge-small-en-v1.5",
                "name": "BGE small English v1.5",
                "dims": 384,
                "notes": "Strong retrieval model, downloads from Hugging Face on first use.",
            },
        ],
    },
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "description": "Hosted embeddings via the OpenAI API.",
        "default_endpoint": "https://api.openai.com/v1",
        "needs_key": True,
        "models": [
            {"id": "text-embedding-3-small", "name": "text-embedding-3-small", "dims": 1536, "notes": "Best cost/quality for most use."},
            {"id": "text-embedding-3-large", "name": "text-embedding-3-large", "dims": 3072, "notes": "Highest quality OpenAI embedding."},
            {"id": "text-embedding-ada-002", "name": "text-embedding-ada-002", "dims": 1536, "notes": "Legacy model."},
        ],
    },
    "ollama": {
        "id": "ollama",
        "name": "Ollama",
        "description": "Local Ollama embedding models (`ollama pull nomic-embed-text`).",
        "default_endpoint": "http://localhost:11434/v1",
        "needs_key": False,
        "models": [
            {"id": "nomic-embed-text", "name": "nomic-embed-text", "dims": 768, "notes": "Strong general local embedder."},
            {"id": "mxbai-embed-large", "name": "mxbai-embed-large", "dims": 1024, "notes": "Larger local retrieval model."},
            {"id": "all-minilm", "name": "all-minilm", "dims": 384, "notes": "Small and fast."},
            {"id": "bge-m3", "name": "bge-m3", "dims": 1024, "notes": "Multilingual retrieval."},
            {"id": "snowflake-arctic-embed", "name": "snowflake-arctic-embed", "dims": 1024, "notes": "Good for search."},
        ],
    },
    "lmstudio": {
        "id": "lmstudio",
        "name": "LM Studio",
        "description": "Any embedding model loaded in LM Studio’s local server.",
        "default_endpoint": "http://localhost:1234/v1",
        "needs_key": False,
        "models": [
            {"id": "text-embedding-nomic-embed-text-v1.5", "name": "Nomic embed (typical LM Studio id)", "dims": 768, "notes": "Use the model id shown in LM Studio."},
        ],
    },
    "gemini": {
        "id": "gemini",
        "name": "Gemini",
        "description": "Google embeddings through the OpenAI-compatible Gemini endpoint.",
        "default_endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "needs_key": True,
        "models": [
            {"id": "text-embedding-004", "name": "text-embedding-004", "dims": 768, "notes": "Current Gemini embedding model."},
            {"id": "gemini-embedding-001", "name": "gemini-embedding-001", "dims": 3072, "notes": "Newer Gemini embedding."},
        ],
    },
}

_ST_ALIASES = {
    "local-hash": None,
    "hash": None,
    "bert": "all-MiniLM-L6-v2",
    "local-bert": "all-MiniLM-L6-v2",
    "minilm": "all-MiniLM-L6-v2",
    "all-minilm-l6-v2": "all-MiniLM-L6-v2",
    "mpnet": "all-mpnet-base-v2",
    "bge-small": "BAAI/bge-small-en-v1.5",
    "bge-small-en-v1.5": "BAAI/bge-small-en-v1.5",
}

DEFAULT_CONFIG: dict[str, Any] = {
    "provider": "local",
    "model": "all-MiniLM-L6-v2",
    "endpoint": "",
    "api_key": "",
    "chunk_size": 800,
    "chunk_overlap": 120,
    "strategy": "paragraph",
    "top_k": 5,
}


def catalog() -> dict[str, Any]:
    return {
        "providers": list(EMBEDDING_PROVIDERS.values()),
        "default": dict(DEFAULT_CONFIG),
    }


def provider_defaults(provider: str) -> dict[str, Any]:
    info = EMBEDDING_PROVIDERS.get(provider) or EMBEDDING_PROVIDERS["local"]
    models = info.get("models") or []
    return {
        "provider": info["id"],
        "endpoint": info.get("default_endpoint") or "",
        "model": models[0]["id"] if models else "",
        "needs_key": bool(info.get("needs_key")),
    }


def normalize_endpoint(endpoint: str) -> str:
    endpoint = (endpoint or "").strip().rstrip("/")
    if not endpoint:
        return ""
    if endpoint.endswith("/embeddings"):
        return endpoint
    if endpoint.endswith("/v1"):
        return endpoint + "/embeddings"
    if endpoint.endswith("/openai"):
        return endpoint + "/embeddings"
    return endpoint + "/embeddings"


def _local_embedding(text: str, dimensions: int = 256) -> list[float]:
    values = [0.0] * dimensions
    for token in text.lower().split():
        digest = hashlib.sha256(token.encode("utf-8", "ignore")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        values[index] += 1.0 if digest[4] & 1 else -1.0
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return [value / norm for value in values]


def _sentence_transformer_id(model: str) -> str | None:
    raw = (model or "").strip()
    if not raw:
        return None
    if raw in _ST_ALIASES:
        return _ST_ALIASES[raw]
    lowered = raw.lower()
    if lowered in _ST_ALIASES:
        return _ST_ALIASES[lowered]
    return raw


@lru_cache(maxsize=8)
def _load_sentence_transformer(model_id: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_id)


def embed_texts(
    texts: Iterable[str],
    provider: str = "local",
    endpoint: str = "",
    model: str = "",
    api_key: str = "",
    timeout: float = 60,
) -> list[list[float]]:
    values = list(texts)
    if not values:
        return []
    provider = (provider or "local").strip().lower()
    model = (model or "").strip()
    if provider == "local":
        st_id = _sentence_transformer_id(model)
        if st_id is None:
            return [_local_embedding(text) for text in values]
        try:
            encoder = _load_sentence_transformer(st_id)
            embeddings = encoder.encode(values, show_progress_bar=False)
            return [vec.tolist() for vec in embeddings]
        except Exception as exc:
            if model in {"", "local-hash", "hash"}:
                return [_local_embedding(text) for text in values]
            raise ValueError(
                f"Local model '{model}' needs sentence-transformers. "
                f"Install with: pip install sentence-transformers  ({exc})"
            ) from exc

    url = normalize_endpoint(endpoint or str(provider_defaults(provider).get("endpoint") or ""))
    if not url:
        raise ValueError(f"Embedding endpoint is required for provider {provider}")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload: dict[str, Any] = {"model": model or provider_defaults(provider)["model"], "input": values}
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()
    data = response.json().get("data") or []
    data.sort(key=lambda item: item.get("index", 0))
    embeddings = [item.get("embedding", []) for item in data]
    if len(embeddings) != len(values) or not all(isinstance(item, list) for item in embeddings):
        raise ValueError("Embedding response did not contain one vector per input")
    return embeddings


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    return dot / (norm_left * norm_right or 1.0)
