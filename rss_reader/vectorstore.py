from __future__ import annotations

import json

from .chunker import chunk_text
from .database import Database
from .embeddings import cosine_similarity, embed_texts


def index_document(
    database: Database,
    document_id: str,
    text: str,
    metadata: dict,
    config: dict,
    api_key: str = "",
    generate_vectors: bool = True,
) -> int:
    chunks = chunk_text(
        text,
        config.get("chunk_size", 800),
        config.get("chunk_overlap", 120),
        config.get("strategy", "paragraph"),
    )
    should_embed = bool(generate_vectors)
    if should_embed:
        vectors = embed_texts(
            chunks,
            config.get("provider", "local"),
            config.get("endpoint", ""),
            config.get("model", "local-hash"),
            api_key,
        )
    else:
        vectors = [[] for _ in chunks]

    rows = []
    for index, (chunk, vector) in enumerate(zip(chunks, vectors)):
        rows.append(
            {
                "chunk_id": f"{document_id}:{index}",
                "chunk_text": chunk,
                "chunk_index": index,
                "embedding_model": config.get("model", "local-hash") if should_embed else "none",
                "embedding_dimension": len(vector),
                "embedding": vector,
                **metadata,
            }
        )
    database.replace_chunks(document_id, rows)
    return len(rows)


def search(
    database: Database,
    query: str,
    config: dict,
    api_key: str = "",
    top_k: int | None = None,
    keywords: str = "",
    source: str = "",
    date_from: str = "",
    date_to: str = "",
) -> list[dict]:
    has_query = bool((query or "").strip())
    if has_query:
        query_vector = embed_texts(
            [query],
            config.get("provider", "local"),
            config.get("endpoint", ""),
            config.get("model", "local-hash"),
            api_key,
        )[0]
    else:
        query_vector = None

    results = []
    for row in database.document_chunks():
        if source and source.lower() not in (row["source"] or "").lower():
            continue

        pub = row["published"] or ""
        if date_from and pub < date_from:
            continue
        if date_to and pub > date_to:
            continue

        kw_list = [k.strip().lower() for k in (keywords or "").split(",") if k.strip()]
        chunk_lower = (row["chunk_text"] or "").lower()
        title_lower = (row["article_title"] or "").lower()
        if kw_list:
            if not any(kw in chunk_lower or kw in title_lower for kw in kw_list):
                continue
            match_count = sum(
                1 for kw in kw_list if kw in chunk_lower or kw in title_lower
            )
            kw_relevance = match_count / len(kw_list)
        else:
            kw_relevance = 1.0

        if has_query and query_vector:
            vector = json.loads(row["embedding"] or "[]")
            if len(vector) != len(query_vector):
                continue
            sem_relevance = cosine_similarity(query_vector, vector)
            relevance = (
                (0.7 * sem_relevance + 0.3 * kw_relevance) if kw_list else sem_relevance
            )
        else:
            relevance = kw_relevance

        results.append({**dict(row), "relevance": relevance})

    results.sort(key=lambda item: item["relevance"], reverse=True)
    return results[: int(top_k or config.get("top_k", 5) or 5)]
