"""Document search preview.

A transparent linear scan over each document's preprocessed tokens that reports
which query terms each document contains. There is no relevance score: results
are ordered by the number of distinct query terms they contain (a count shown to
the user) or by the metadata sort the user chooses.

The extractive overview quotes whole sentences verbatim from matching
documents. Sentence choice is deterministic: most distinct query terms first,
at most one sentence per document, ties broken by result order then position.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from backend.search.preprocess import split_sentences, tokenize, unique_terms

METHOD = ("Document search preview: every document is checked for your normalised query words. "
          "Results aren't ranked by relevance; they're ordered by how many query words matched, or by the sort you choose.")
OVERVIEW_METHOD = ("Extractive preview: sentences quoted verbatim from matching documents, "
                   "chosen by how many distinct query terms they contain. No generative model is used.")

MODES = {"all", "any", "phrase"}
SORTS = {"coverage", "title_asc", "title_desc", "date_desc", "date_asc"}
EXCERPT_CHARS = 280


class QueryError(ValueError):
    pass


@dataclass
class Candidate:
    doc_id: str
    title: str
    text: str
    source: str                      # "corpus" | "attachment"
    filename: str
    metadata: dict = field(default_factory=dict)
    modified: str = ""
    _tokens: list | None = None
    _token_set: set | None = None

    @property
    def tokens(self) -> list:
        if self._tokens is None:
            self._tokens = tokenize(f"{self.title}\n{self.text}")
            self._token_set = set(self._tokens)
        return self._tokens

    @property
    def token_set(self) -> set:
        self.tokens
        return self._token_set  # type: ignore[return-value]


def lead_excerpt(text: str, limit: int = EXCERPT_CHARS) -> str:
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    cut = flat.rfind(" ", 0, limit)
    return flat[: cut if cut > limit * 0.6 else limit].rstrip(",.;:") + "…"


def _contains_phrase(tokens: list, phrase: list) -> bool:
    n = len(phrase)
    if n == 0:
        return False
    first = phrase[0]
    for i, tok in enumerate(tokens):
        if tok == first and tokens[i:i + n] == phrase:
            return True
    return False


def parse_query(query: str) -> list[str]:
    if query is None or not str(query).strip():
        raise QueryError("Enter a search query.")
    if len(query) > 300:
        raise QueryError("Queries are limited to 300 characters.")
    terms = unique_terms(tokenize(query))
    if not terms:
        raise QueryError("That query has no searchable words or numbers.")
    if len(terms) > 24:
        raise QueryError("Use 24 distinct terms or fewer.")
    return terms


def match(candidates: list[Candidate], query: str, *, mode: str = "all") -> tuple[list[str], list[dict]]:
    if mode not in MODES:
        raise QueryError("Unknown matching mode.")
    terms = parse_query(query)
    phrase = tokenize(query) if mode == "phrase" else []
    hits = []
    for c in candidates:
        present = [t for t in terms if t in c.token_set]
        if mode == "all" and len(present) != len(terms):
            continue
        if mode == "any" and not present:
            continue
        if mode == "phrase" and not _contains_phrase(c.tokens, phrase):
            continue
        hits.append({"candidate": c, "matched": present, "missing": [t for t in terms if t not in present]})
    return terms, hits


def _sort_key(sort: str):
    if sort == "title_asc":
        return lambda h: h["candidate"].title.casefold()
    if sort == "title_desc":
        return lambda h: h["candidate"].title.casefold()
    if sort in {"date_desc", "date_asc"}:
        return lambda h: (h["candidate"].metadata.get("date") or h["candidate"].modified or "")
    return lambda h: (-len(h["matched"]), h["candidate"].title.casefold())


def search(candidates: list[Candidate], query: str, *, mode: str = "all", sort: str = "coverage",
           page: int = 1, per_page: int = 10, categories: list[str] | None = None) -> dict:
    if sort not in SORTS:
        raise QueryError("Unknown sort option.")
    per_page = max(5, min(int(per_page), 50))
    if categories:
        wanted = {c.casefold() for c in categories}
        candidates = [c for c in candidates if (c.metadata.get("category") or "").casefold() in wanted]
    terms, hits = match(candidates, query, mode=mode)
    hits.sort(key=_sort_key(sort), reverse=sort in {"title_desc", "date_desc"})
    total = len(hits)
    pages = max(1, math.ceil(total / per_page))
    page = max(1, min(int(page), pages))
    window = hits[(page - 1) * per_page: page * per_page]
    seen_anywhere = {t for h in hits for t in h["matched"]}
    return {
        "query": query,
        "terms": terms,
        "mode": mode,
        "sort": sort,
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "total": total,
        "searched": len(candidates),
        "terms_without_matches": [t for t in terms if t not in seen_anywhere],
        "method": METHOD,
        "results": [result_view(h) for h in window],
    }


def result_view(hit: dict) -> dict:
    c: Candidate = hit["candidate"]
    meta = c.metadata
    return {
        "doc_id": c.doc_id,
        "title": c.title,
        "source": c.source,
        "filename": c.filename,
        "category": meta.get("category"),
        "author": meta.get("author"),
        "date": meta.get("date"),
        "tags": meta.get("tags") or [],
        "excerpt": meta.get("summary") or lead_excerpt(c.text),
        "excerpt_kind": "summary" if meta.get("summary") else "opening",
        "matched_terms": hit["matched"],
        "missing_terms": hit["missing"],
        "word_count": len(c.text.split()),
    }


def overview(candidates: list[Candidate], query: str, *, mode: str = "all", max_passages: int = 3) -> dict:
    """Deterministic extractive overview with genuine references."""
    terms, hits = match(candidates, query, mode=mode)
    hits.sort(key=_sort_key("coverage"))
    passages = []
    for rank, h in enumerate(hits[:12]):
        c: Candidate = h["candidate"]
        best = None
        for pos, sentence in enumerate(split_sentences(c.text)):
            if len(sentence) < 40 or len(sentence) > 420:
                continue
            present = set(tokenize(sentence)) & set(terms)
            if not present:
                continue
            key = (-len(present), pos)
            if best is None or key < best[0]:
                best = (key, sentence, pos, [t for t in terms if t in present])
        if best:
            passages.append({
                "text": best[1],
                "doc_id": c.doc_id,
                "title": c.title,
                "source": c.source,
                "sentence_index": best[2],
                "matched_terms": best[3],
                "_order": (-len(best[3]), rank, best[2]),
            })
    passages.sort(key=lambda p: p["_order"])
    chosen = passages[:max_passages]
    for p in chosen:
        p.pop("_order", None)
    refs, seen = [], set()
    for p in chosen:
        if p["doc_id"] not in seen:
            seen.add(p["doc_id"])
            refs.append({"doc_id": p["doc_id"], "title": p["title"], "source": p["source"]})
    return {
        "query": query,
        "terms": terms,
        "mode": mode,
        "matching_documents": len(hits),
        "passages": chosen,
        "references": refs,
        "method": OVERVIEW_METHOD,
        "kind": "extractive_preview",
    }
