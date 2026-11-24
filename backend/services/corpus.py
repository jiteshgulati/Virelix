"""Shared document corpus and its inverted index."""

from __future__ import annotations

import hashlib
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from backend import security as sec
from backend.search.index import InvertedIndex, initialize_foundation
from backend.search.loader import (SUPPORTED_EXTENSIONS, LoaderError, decode_bytes, load_corpus,
                                   parse_document_text)
from backend.search.preprocess import normalize_text
from backend.search.preview import Candidate
from backend.services.common import Auditor, conflict, not_found
from backend.storage import atomic_write_bytes
from backend.web import HttpError, bad_request


class CorpusService:
    def __init__(self, cfg, db, auditor: Auditor):
        self.cfg = cfg
        self.db = db
        self.audit = auditor
        self._lock = threading.RLock()
        self.report = None
        self.error: str | None = None
        self.index: InvertedIndex | None = None
        self.index_error: str | None = None
        self._candidates: list[Candidate] = []
        self.index_path = db.index_dir / "foundation.json"
        self.reload()
        self._load_index()

    # -- corpus -------------------------------------------------------------
    def reload(self) -> None:
        with self._lock:
            try:
                self.report = load_corpus(self.cfg.corpus_dir)
                self.error = None
            except LoaderError as exc:
                self.report = None
                self.error = str(exc)
            docs = self.report.documents if self.report else []
            self._by_id = {d.doc_id: d for d in docs}
            self._candidates = [Candidate(d.doc_id, d.title, d.text, "corpus", d.filename, d.metadata, d.modified)
                                for d in docs]

    def signature(self) -> str:
        docs = self.report.documents if self.report else []
        raw = "|".join(f"{d.doc_id}:{d.size_bytes}:{d.modified}" for d in sorted(docs, key=lambda d: d.doc_id))
        return hashlib.sha1(raw.encode()).hexdigest()

    def candidates(self) -> list[Candidate]:
        with self._lock:
            return list(self._candidates)

    def get(self, doc_id: str):
        with self._lock:
            return self._by_id.get(doc_id)

    def categories(self) -> list[dict]:
        counts: dict[str, int] = {}
        for c in self.candidates():
            cat = c.metadata.get("category")
            if cat:
                counts[cat] = counts.get(cat, 0) + 1
        return [{"name": k, "count": v} for k, v in sorted(counts.items())]

    def list_documents(self, q: str = "", category: str = "", sort: str = "title_asc") -> list[dict]:
        docs = self.report.documents if self.report else []
        rows = [d.summary() for d in docs]
        if q:
            needle = normalize_text(q)
            rows = [r for r in rows if needle in normalize_text(f"{r['title']} {r['filename']} {' '.join(r['metadata'].get('tags', []))}")]
        if category:
            rows = [r for r in rows if (r["metadata"].get("category") or "") == category]
        keyfuncs = {
            "title_asc": (lambda r: r["title"].casefold(), False),
            "title_desc": (lambda r: r["title"].casefold(), True),
            "size_desc": (lambda r: r["size_bytes"], True),
            "size_asc": (lambda r: r["size_bytes"], False),
            "modified_desc": (lambda r: r["modified"], True),
            "words_desc": (lambda r: r["word_count"], True),
        }
        key, rev = keyfuncs.get(sort, keyfuncs["title_asc"])
        rows.sort(key=key, reverse=rev)
        return rows

    def overview(self) -> dict:
        report = self.report
        counts = report.counts if report else {"discovered": 0, "loaded": 0, "skipped": 0, "skipped_by_reason": {},
                                               "total_bytes": 0, "with_warnings": 0}
        return {
            "folder_ok": report is not None,
            "error": self.error,
            "counts": counts,
            "loaded_at": report.loaded_at if report else None,
            "skipped": [vars(s) for s in report.skipped] if report else [],
            "warnings": [{"filename": d.filename, "warnings": d.warnings} for d in report.documents if d.warnings] if report else [],
            "categories": self.categories(),
        }

    def upload(self, actor: dict, filename: str, raw: bytes) -> dict:
        name = sec.safe_filename(filename)
        if Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise HttpError(415, "unsupported_type", "Only .txt documents can be added to the shared corpus.")
        if len(raw) == 0:
            raise bad_request("The file is empty.", "empty_file")
        if len(raw) > self.cfg.max_upload_bytes:
            raise HttpError(413, "file_too_large", f"Files must be {self.cfg.max_upload_bytes // 1024} KB or smaller.")
        try:
            text, encoding, warnings = decode_bytes(raw)
        except ValueError:
            raise HttpError(415, "binary_file", "That file isn't plain text.")
        meta, body = parse_document_text(text.replace("\r\n", "\n"))
        if not body.strip():
            raise bad_request("The file has no readable text.", "empty_file")
        if self.error:
            raise HttpError(503, "corpus_unavailable", self.error)
        with self._lock:
            target = self.cfg.corpus_dir / name
            if target.exists() or any(d.filename.casefold() == name.casefold() for d in (self.report.documents if self.report else [])):
                raise conflict(f"A document named {name} already exists. Rename the file or remove the existing one.",
                               "duplicate_filename")
            atomic_write_bytes(target, raw)
            self.reload()
            doc = next((d for d in self.report.documents if d.filename == name), None)
        if doc is None:
            target.unlink(missing_ok=True)
            self.reload()
            raise bad_request("The file couldn't be loaded as a document.", "invalid_document")
        self.audit.log(actor, "document_uploaded", name, doc_id=doc.doc_id, bytes=len(raw), encoding=encoding)
        return doc.summary()

    def remove(self, actor: dict, doc_ids: list[str]) -> list[dict]:
        if not doc_ids or not isinstance(doc_ids, list) or len(doc_ids) > 100:
            raise bad_request("Choose between 1 and 100 documents to remove.")
        removed = []
        with self._lock:
            for doc_id in doc_ids:
                doc = self._by_id.get(doc_id) if isinstance(doc_id, str) else None
                if not doc:
                    raise not_found(f"Document {doc_id} not found. Nothing was removed.")
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
            self.db.removed_dir.mkdir(parents=True, exist_ok=True)
            for doc_id in doc_ids:
                doc = self._by_id[doc_id]
                src = self.cfg.corpus_dir / doc.filename
                shutil.move(str(src), str(self.db.removed_dir / f"{stamp}-{doc.filename}"))
                removed.append({"doc_id": doc_id, "filename": doc.filename, "title": doc.title})
            self.reload()
        for r in removed:
            self.audit.log(actor, "document_removed", r["filename"], doc_id=r["doc_id"])
        return removed

    # -- index foundation -------------------------------------------------
    def _load_index(self) -> None:
        if self.index_path.is_file():
            try:
                self.index = InvertedIndex.load(self.index_path)
                self.index_error = None
            except (ValueError, KeyError, TypeError, OSError) as exc:
                self.index = None
                self.index_error = f"Stored index could not be read: {exc}"

    def index_status(self) -> dict:
        idx = self.index
        if idx is None:
            state = "not_initialized"
        elif idx.settings.get("corpus_signature") != self.signature():
            state = "stale"
        else:
            state = "current"
        return {"state": state, "error": self.index_error, "stats": idx.stats() if idx else None,
                "corpus_documents": len(self._candidates),
                "retrieval_enabled": False,
                "note": "The index is available for inspection. Search results are not ranked using it yet."}

    def rebuild_index(self, actor: dict, remove_stopwords: bool = False) -> dict:
        if self.error:
            raise HttpError(503, "corpus_unavailable", self.error)
        with self._lock:
            docs = list(self.report.documents)
            if not docs:
                raise bad_request("The shared corpus has no loadable documents.", "empty_corpus")
            idx = initialize_foundation(docs, remove_stopwords=bool(remove_stopwords))
            idx.settings["corpus_signature"] = self.signature()
            idx.save(self.index_path)
            self.index = idx
            self.index_error = None
        self.audit.log(actor, "index_initialized", "foundation", documents=len(docs),
                       vocabulary=len(idx.postings), build_ms=idx.build_ms)
        return self.index_status()

    def vocabulary(self, q: str = "", sort: str = "term", page: int = 1, per_page: int = 50) -> dict:
        if not self.index:
            raise HttpError(409, "index_not_initialized", "Initialize the index foundation first.")
        rows = self.index.vocabulary()
        if q:
            needle = normalize_text(q).replace(" ", "")
            rows = [r for r in rows if needle in r["term"]]
        if sort == "df":
            rows.sort(key=lambda r: (-r["df"], r["term"]))
        elif sort == "cf":
            rows.sort(key=lambda r: (-r["cf"], r["term"]))
        total = len(rows)
        pages = max(1, -(-total // per_page))
        page = max(1, min(page, pages))
        return {"total": total, "page": page, "pages": pages, "per_page": per_page,
                "terms": rows[(page - 1) * per_page: page * per_page]}

    def postings(self, term: str) -> dict:
        if not self.index:
            raise HttpError(409, "index_not_initialized", "Initialize the index foundation first.")
        norm = normalize_text(term)
        if not norm or " " in norm:
            raise bad_request("Enter a single term.")
        plist = self.index.postings_for(norm)
        docs = self.index.documents
        return {"term": norm, "df": len(plist), "cf": sum(p.tf for p in plist),
                "postings": [{"doc_id": p.doc_id, "title": docs[p.doc_id].title if p.doc_id in docs else "—",
                              "tf": p.tf, "positions": p.positions[:20], "positions_total": len(p.positions)}
                             for p in plist]}

    def index_documents(self) -> list[dict]:
        if not self.index:
            return []
        return sorted(({"doc_id": d.doc_id, "title": d.title, "filename": d.filename, "length": d.length,
                        "unique_terms": d.unique_terms, "category": d.metadata.get("category")}
                       for d in self.index.documents.values()), key=lambda r: r["title"].casefold())
