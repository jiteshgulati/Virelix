"""Extractive overview and opening excerpts.

The overview quotes whole sentences verbatim from the highest-ranked matching
documents. Nothing is generated or paraphrased. Selection is deterministic:
from each of the top-ranked documents, take the sentence containing the most
distinct query terms (earliest wins ties), then order passages by distinct
terms, then document rank, then position, and keep at most three.
"""

from __future__ import annotations

from backend.search.preprocess import split_sentences, tokenize

OVERVIEW_METHOD = ("Extractive preview: sentences quoted verbatim from the highest-ranked matching documents, "
                   "chosen by how many distinct query terms they contain. No generative model is used.")
EXCERPT_CHARS = 280
OVERVIEW_DOCUMENTS = 12


def lead_excerpt(text: str, limit: int = EXCERPT_CHARS) -> str:
    """The opening of a document, cut at a word boundary."""
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    cut = flat.rfind(" ", 0, limit)
    return flat[: cut if cut > limit * 0.6 else limit].rstrip(",.;:") + "…"


def overview(ranked_docs: list, terms, *, query: str, mode: str, matching_documents: int,
             max_passages: int = 3) -> dict:
    """Build an extractive overview.

    ``ranked_docs`` is a list of ``(doc_id, title, source, text)`` in ranking order,
    as produced by the search engine.
    """
    terms = list(terms)
    wanted = set(terms)
    passages = []
    for rank, (doc_id, title, source, text) in enumerate(ranked_docs[:OVERVIEW_DOCUMENTS]):
        best = None
        for pos, sentence in enumerate(split_sentences(text)):
            if len(sentence) < 40 or len(sentence) > 420:
                continue
            present = set(tokenize(sentence)) & wanted
            if not present:
                continue
            key = (-len(present), pos)
            if best is None or key < best[0]:
                best = (key, sentence, pos, [t for t in terms if t in present])
        if best:
            passages.append({"text": best[1], "doc_id": doc_id, "title": title, "source": source,
                             "sentence_index": best[2], "matched_terms": best[3],
                             "_order": (-len(best[3]), rank, best[2])})
    passages.sort(key=lambda p: p["_order"])
    chosen = passages[:max_passages]
    for p in chosen:
        p.pop("_order", None)
    refs, seen = [], set()
    for p in chosen:
        if p["doc_id"] not in seen:
            seen.add(p["doc_id"])
            refs.append({"doc_id": p["doc_id"], "title": p["title"], "source": p["source"]})
    return {"query": query, "terms": terms, "mode": mode, "matching_documents": matching_documents,
            "passages": chosen, "references": refs, "method": OVERVIEW_METHOD, "kind": "extractive_preview"}
