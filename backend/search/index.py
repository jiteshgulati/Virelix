"""Inverted index: the data structure behind ranked search.

Structures
----------
``Posting``         one (document, term) pair: term frequency and token positions.
``DocumentRecord``  per-document metadata needed for filtering, sorting and display.
``InvertedIndex``   ``dict[term, dict[doc_id, Posting]]`` plus document records and
                    vocabulary statistics.

Definitions
-----------
* **Term frequency** ``tf(t, d)``: occurrences of term ``t`` in document ``d``
  (title tokens followed by body tokens).
* **Document frequency** ``df(t)``: number of distinct documents containing ``t``.
* **Positions**: token offsets, used for exact-phrase matching.

Lifecycle
---------
``build_index`` constructs an index from loaded documents; ``validate`` checks
internal consistency; ``save``/``load`` persist it as versioned JSON (written
atomically). Query processing and ranking live in ``engine.py``.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

FORMAT_VERSION = 2  # v2: document records carry ``modified`` for date sorting


@dataclass
class Posting:
    doc_id: str
    tf: int = 0                      # raw term frequency within the document
    positions: list = field(default_factory=list)  # token offsets, for phrase matching


@dataclass
class DocumentRecord:
    doc_id: str
    title: str
    filename: str
    length: int                      # number of tokens after preprocessing
    unique_terms: int
    metadata: dict = field(default_factory=dict)
    modified: str = ""


class InvertedIndex:
    def __init__(self) -> None:
        self.postings: dict[str, dict[str, Posting]] = {}
        self.documents: dict[str, DocumentRecord] = {}
        self.built_at: str | None = None
        self.build_ms: float | None = None
        self.settings: dict = {"remove_stopwords": False}

    # -- population ---------------------------------------------------------
    def add_document(self, record: DocumentRecord, tokens: Iterable[str]) -> None:
        if record.doc_id in self.documents:
            self.remove_document(record.doc_id)
        tokens = list(tokens)
        for position, term in enumerate(tokens):
            per_term = self.postings.setdefault(term, {})
            posting = per_term.get(record.doc_id)
            if posting is None:
                posting = per_term[record.doc_id] = Posting(record.doc_id)
            posting.tf += 1
            posting.positions.append(position)
        record.length = len(tokens)
        record.unique_terms = len(set(tokens))
        self.documents[record.doc_id] = record

    def remove_document(self, doc_id: str) -> bool:
        if doc_id not in self.documents:
            return False
        empty = []
        for term, per_term in self.postings.items():
            if per_term.pop(doc_id, None) is not None and not per_term:
                empty.append(term)
        for term in empty:
            del self.postings[term]
        del self.documents[doc_id]
        return True

    # -- inspection ---------------------------------------------------------
    def document_frequency(self, term: str) -> int:
        return len(self.postings.get(term, {}))

    def collection_frequency(self, term: str) -> int:
        return sum(p.tf for p in self.postings.get(term, {}).values())

    def postings_for(self, term: str) -> list[Posting]:
        """Postings for a single, already-normalised term, ordered by doc id."""
        return [self.postings[term][d] for d in sorted(self.postings.get(term, {}))]

    def vocabulary(self) -> list[dict]:
        rows = [
            {"term": t, "df": len(per), "cf": sum(p.tf for p in per.values())}
            for t, per in self.postings.items()
        ]
        rows.sort(key=lambda r: r["term"])
        return rows

    def stats(self) -> dict:
        total_tokens = sum(d.length for d in self.documents.values())
        n_docs = len(self.documents)
        return {
            "documents": n_docs,
            "vocabulary_size": len(self.postings),
            "total_tokens": total_tokens,
            "postings": sum(len(per) for per in self.postings.values()),
            "average_document_length": round(total_tokens / n_docs, 1) if n_docs else 0,
            "hapax_terms": sum(1 for per in self.postings.values()
                               if len(per) == 1 and next(iter(per.values())).tf == 1),
            "built_at": self.built_at,
            "build_ms": self.build_ms,
            "settings": dict(self.settings),
            "format_version": FORMAT_VERSION,
        }

    # -- serialisation ------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "format_version": FORMAT_VERSION,
            "built_at": self.built_at,
            "build_ms": self.build_ms,
            "settings": self.settings,
            "documents": {k: asdict(v) for k, v in self.documents.items()},
            "postings": {t: {d: [p.tf, p.positions] for d, p in per.items()} for t, per in self.postings.items()},
        }

    def validate(self) -> list[str]:
        """Return consistency problems (an empty list means the index is sound)."""
        problems = []
        lengths: dict[str, int] = {d: 0 for d in self.documents}
        for term, per in self.postings.items():
            if not term or not per:
                problems.append(f"empty term or posting list: {term!r}")
                continue
            for doc_id, p in per.items():
                if doc_id not in self.documents:
                    problems.append(f"posting for unknown document {doc_id} under {term!r}")
                    continue
                if p.tf != len(p.positions) or p.tf < 1:
                    problems.append(f"tf/positions mismatch for {term!r} in {doc_id}")
                if p.positions != sorted(set(p.positions)):
                    problems.append(f"unordered positions for {term!r} in {doc_id}")
                lengths[doc_id] += p.tf
        for doc_id, rec in self.documents.items():
            if lengths.get(doc_id, 0) != rec.length:
                problems.append(f"length mismatch for {doc_id}")
        return problems[:20]

    @classmethod
    def from_dict(cls, data: dict) -> "InvertedIndex":
        if data.get("format_version") != FORMAT_VERSION:
            raise ValueError("Unsupported index format version.")
        idx = cls()
        idx.built_at = data.get("built_at")
        idx.build_ms = data.get("build_ms")
        idx.settings = data.get("settings", idx.settings)
        idx.documents = {k: DocumentRecord(**v) for k, v in data.get("documents", {}).items()}
        for term, per in data.get("postings", {}).items():
            idx.postings[term] = {d: Posting(d, tf, list(pos)) for d, (tf, pos) in per.items()}
        return idx

    def save(self, path: Path) -> None:
        from backend.storage import atomic_write_text
        atomic_write_text(path, json.dumps(self.to_dict(), separators=(",", ":")))

    @classmethod
    def load(cls, path: Path) -> "InvertedIndex":
        return cls.from_dict(json.loads(path.read_text(encoding="utf-8")))


def indexable_text(doc) -> str:
    """Title then body, without indexing the same line twice.

    A document without a metadata header takes its title from its first line;
    that line is already part of the body, so it isn't prepended again
    (otherwise its words would count double in term frequencies).
    """
    first_line = next((ln.strip().lstrip("#").strip() for ln in doc.text.split("\n") if ln.strip()), "")
    if doc.title and doc.title != first_line:
        return f"{doc.title}\n{doc.text}"
    return doc.text


def build_index(documents, *, remove_stopwords: bool = False) -> InvertedIndex:
    """Build an index from loaded ``Document`` objects (title and body tokens)."""
    from backend.search.preprocess import tokenize
    started = time.perf_counter()
    idx = InvertedIndex()
    idx.settings = {"remove_stopwords": remove_stopwords}
    for doc in documents:
        tokens = tokenize(indexable_text(doc), remove_stopwords=remove_stopwords)
        idx.add_document(DocumentRecord(doc.doc_id, doc.title, doc.filename, 0, 0,
                                        {k: v for k, v in doc.metadata.items() if k != "summary"},
                                        doc.modified), tokens)
    idx.build_ms = round((time.perf_counter() - started) * 1000, 2)
    idx.built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return idx
