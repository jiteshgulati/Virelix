"""Search orchestration: shared and private indexes → ranked, filtered, paginated results.

Only the posting lists of the query terms are read to find and score candidates.
Document text is read afterwards, and only for the results on the requested page
(and for the extractive overview).
"""

from __future__ import annotations

import math
import time

from backend.search import engine
from backend.search.overview import lead_excerpt, overview

SOURCES = ("corpus", "attachments")


class SearchService:
    def __init__(self, corpus, workspace):
        self.corpus = corpus
        self.workspace = workspace

    def _indexes(self, user_id: str, sources: list) -> tuple[list, dict]:
        """``[(source, index)]`` plus a ``(source, doc_id) -> Document`` lookup, for the caller only."""
        indexes, docs = [], {}
        if "corpus" in sources:
            index, by_id = self.corpus.snapshot()
            if index is None:
                raise engine.QueryError("The search index isn't available right now. Try again shortly.")
            indexes.append(("corpus", index))
            docs["corpus"] = by_id
        if "attachments" in sources:
            index, by_id = self.workspace.private_index(user_id)
            indexes.append(("attachment", index))
            docs["attachment"] = by_id
        return indexes, docs

    def search(self, user_id: str, raw_query: str, *, mode: str, sources: list, categories: list,
               sort: str, page: int, per_page: int) -> dict:
        started = time.perf_counter()
        query = engine.parse_query(raw_query, mode)
        sort = engine.normalise_sort(sort)
        indexes, docs = self._indexes(user_id, sources)
        found = engine.search(indexes, query, sort=sort, categories=categories)
        hits = found["hits"]
        total = len(hits)
        pages = max(1, math.ceil(total / per_page))
        page = max(1, min(page, pages))
        window = hits[(page - 1) * per_page: page * per_page]
        results = [self._result_view(h, docs[h.source][h.doc_id], query) for h in window]
        return {
            "query": query.raw,
            "terms": list(query.terms),
            "mode": query.mode,
            "sort": sort,
            "page": page,
            "per_page": per_page,
            "pages": pages,
            "total": total,
            "searched": found["searched"],
            "terms_without_matches": found["terms_without_matches"],
            "ranking": "term_frequency",
            "method": engine.RANKING_METHOD,
            "results": results,
            "response_time_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    @staticmethod
    def _result_view(hit: engine.Hit, doc, query: engine.ParsedQuery) -> dict:
        meta = doc.metadata or {}
        return {
            "doc_id": hit.doc_id,
            "title": doc.title,
            "source": hit.source,
            "filename": doc.filename,
            "category": meta.get("category"),
            "author": meta.get("author"),
            "date": meta.get("date"),
            "tags": meta.get("tags") or [],
            "score": hit.score,
            "term_frequencies": dict(hit.tf),
            "matched_terms": hit.matched,
            "missing_terms": hit.missing,
            "excerpt": meta.get("summary") or lead_excerpt(doc.text),
            "excerpt_kind": "summary" if meta.get("summary") else "opening",
            "word_count": len(doc.text.split()),
        }

    def overview(self, raw_query: str, mode: str) -> dict:
        """Extractive overview over the shared corpus, using the same ranked retrieval."""
        query = engine.parse_query(raw_query, mode)
        index, by_id = self.corpus.snapshot()
        if index is None:
            raise engine.QueryError("The search index isn't available right now. Try again shortly.")
        hits = engine.search([("corpus", index)], query)["hits"]
        ranked_docs = [(h.doc_id, by_id[h.doc_id].title, "corpus", by_id[h.doc_id].text)
                       for h in hits[:20] if h.doc_id in by_id]
        return overview(ranked_docs, query.terms, query=query.raw, mode=query.mode, matching_documents=len(hits))
