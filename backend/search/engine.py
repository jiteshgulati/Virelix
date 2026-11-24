"""Query processing, posting-list retrieval and term-frequency ranking.

Pipeline for one index
----------------------
1. ``parse_query`` normalises and tokenises the query with the same pipeline used
   to index documents (``preprocess.tokenize``). Distinct terms keep first-seen
   order; the full token sequence is kept for phrase matching.
2. ``retrieve`` reads the posting lists of the query terms only, so no document
   text is scanned:
     * ``any``    union of the posting lists;
     * ``all``    intersection, starting from the rarest term (lowest df);
     * ``phrase`` intersection, then a positional check that the tokens occur
                  consecutively and in order.
3. Each candidate is scored with the term-frequency formula

        Score(d, q) = Σ_{t ∈ distinct terms of q} tf(t, d)

   Repeated query terms are scored once, so typing a word twice can't inflate
   a score. Phrase mode uses the same formula over its distinct terms.
4. ``rank`` orders hits: score descending, then normalised title, then document
   id, so equal scores always come out in the same order. Alternative sorts
   (title, date) are applied to the full result set before pagination.

A score is a count of query-term occurrences. It isn't a probability,
percentage or confidence value.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.search.preprocess import tokenize, unique_terms

MODES = ("any", "all", "phrase")
SORTS = ("relevance", "title_asc", "title_desc", "date_desc", "date_asc")
SORT_ALIASES = {"coverage": "relevance"}   # name used by earlier clients
MAX_QUERY_CHARS = 300
MAX_TERMS = 24

RANKING_METHOD = ("Ranked by term frequency: each document's score is the total number of times "
                  "the query's distinct words occur in it. Ties are ordered by title.")


class QueryError(ValueError):
    """The query can't be searched; the message is safe to show to users."""


@dataclass(frozen=True)
class ParsedQuery:
    raw: str
    mode: str
    tokens: tuple      # normalised tokens in order, duplicates kept (phrase matching)
    terms: tuple       # distinct normalised terms, first-seen order (scoring)


@dataclass
class Hit:
    doc_id: str
    source: str
    score: int
    tf: dict                       # term -> tf for matched terms, in query order
    missing: list
    title: str
    metadata: dict = field(default_factory=dict)
    modified: str = ""

    @property
    def matched(self) -> list:
        return list(self.tf)


def normalise_mode(mode: str | None, default: str = "any") -> str:
    mode = (mode or default).strip().lower()
    if mode not in MODES:
        raise QueryError("Unknown matching mode. Use any, all or phrase.")
    return mode


def normalise_sort(sort: str | None) -> str:
    sort = SORT_ALIASES.get((sort or "relevance").strip().lower(), (sort or "relevance").strip().lower())
    if sort not in SORTS:
        raise QueryError("Unknown sort option.")
    return sort


def parse_query(raw, mode: str = "any") -> ParsedQuery:
    if raw is None or not isinstance(raw, str) or not raw.strip():
        raise QueryError("Enter a search query.")
    if len(raw) > MAX_QUERY_CHARS:
        raise QueryError(f"Queries are limited to {MAX_QUERY_CHARS} characters.")
    mode = normalise_mode(mode)
    tokens = tuple(tokenize(raw))
    if not tokens:
        raise QueryError("That query has no searchable words or numbers.")
    terms = tuple(unique_terms(tokens))
    if len(terms) > MAX_TERMS:
        raise QueryError(f"Use {MAX_TERMS} distinct terms or fewer.")
    return ParsedQuery(raw=raw.strip(), mode=mode, tokens=tokens, terms=terms)


def _contains_phrase(index, doc_id: str, tokens: tuple) -> bool:
    """True if ``tokens`` occur consecutively in ``doc_id`` (positions from the index)."""
    if len(tokens) == 1:
        return True
    position_sets = [set(index.postings[t][doc_id].positions) for t in tokens]
    first = index.postings[tokens[0]][doc_id].positions
    return any(all(p + i in position_sets[i] for i in range(1, len(tokens))) for p in first)


def retrieve(index, query: ParsedQuery, source: str, categories: set | None = None) -> list[Hit]:
    """Candidate documents and their term-frequency scores, from posting lists only."""
    lists = {t: index.postings.get(t, {}) for t in query.terms}
    if query.mode == "any":
        candidates = set()
        for per in lists.values():
            candidates.update(per)
    else:
        if any(not per for per in lists.values()):
            return []                         # a required term is absent from this index
        ordered = sorted(lists.values(), key=len)
        candidates = set(ordered[0])
        for per in ordered[1:]:
            candidates.intersection_update(per)
            if not candidates:
                return []
        if query.mode == "phrase":
            candidates = {d for d in candidates if _contains_phrase(index, d, query.tokens)}

    hits = []
    for doc_id in candidates:
        record = index.documents[doc_id]
        if categories and (record.metadata.get("category") or "").casefold() not in categories:
            continue
        tf = {t: lists[t][doc_id].tf for t in query.terms if doc_id in lists[t]}
        hits.append(Hit(doc_id=doc_id, source=source, score=sum(tf.values()), tf=tf,
                        missing=[t for t in query.terms if t not in tf], title=record.title,
                        metadata=record.metadata, modified=record.modified))
    return hits


def rank(hits: list[Hit], sort: str = "relevance") -> list[Hit]:
    """Deterministic ordering over the complete result set (apply before paginating)."""
    sort = normalise_sort(sort)
    by_title = lambda h: (h.title.casefold(), h.doc_id)
    out = sorted(hits, key=by_title)                     # final tie-breakers first (stable sort)
    if sort == "relevance":
        out.sort(key=lambda h: -h.score)
    elif sort == "title_desc":
        out = sorted(hits, key=by_title, reverse=True)
    elif sort in ("date_desc", "date_asc"):
        date = lambda h: h.metadata.get("date") or h.modified or ""
        out.sort(key=date, reverse=sort == "date_desc")
    return out


def search(indexes: list, query: ParsedQuery, *, sort: str = "relevance", categories=None) -> dict:
    """Search several indexes (``[(source, index), …]``) and rank the merged hits.

    Scores from different indexes are comparable because each is a plain count
    of term occurrences in one document.
    """
    wanted = {c.casefold() for c in categories} if categories else None
    hits: list[Hit] = []
    searched = 0
    seen_terms: set = set()
    for source, index in indexes:
        if index is None:
            continue
        searched += len(index.documents)
        seen_terms.update(t for t in query.terms if index.postings.get(t))
        hits.extend(retrieve(index, query, source, wanted))
    return {
        "hits": rank(hits, sort),
        "searched": searched,
        "terms_without_matches": [t for t in query.terms if t not in seen_terms],
    }
