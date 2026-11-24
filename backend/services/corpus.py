"""Shared document corpus and its inverted index.

Index lifecycle
---------------
* Start-up: load ``data/index/shared-index.json``. If it's missing, unreadable,
  an older format, internally inconsistent or built from a different corpus
  (signature mismatch), rebuild it from the loaded documents.
* Corpus changes (upload, removal, reload from disk): the index is rebuilt
  immediately, so search always reflects the current corpus.
* Rebuilds build a complete new index, validate it, write it atomically and only
  then swap it in. If a rebuild fails, the previous index stays in service.
* Searches read an immutable snapshot (index and documents together) and never
  trigger a rebuild.
"""

from __future__ import annotations

import hashlib
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from backend import security as sec
from backend.search.index import InvertedIndex, build_index
from backend.search.loader import (SUPPORTED_EXTENSIONS, LoaderError, decode_bytes, load_corpus,
                                   parse_document_text)
from backend.search.preprocess import normalize_text
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
        self.index_event: dict = {}            # last lifecycle event, for the admin status page
        self._by_id: dict = {}
        self.index_path = db.index_dir / "shared-index.json"
        self.reload(rebuild=False)
        self._load_or_rebuild_index()

    # -- corpus -------------------------------------------------------------
    def reload(self, *, rebuild: bool = True) -> None:
        """Re-scan the corpus folder; rebuild the index if the corpus changed."""
        with self._lock:
            try:
                self.report = load_corpus(self.cfg.corpus_dir)
                self.error = None
            except LoaderError as exc:
                self.report = None
                self.error = str(exc)
            docs = self.report.documents if self.report else []
            self._by_id = {d.doc_id: d for d in docs}
            if rebuild and self.report is not None and (
                    self.index is None or self.index.settings.get("corpus_signature") != self.signature()):
                try:
                    self._rebuild_locked(reason="corpus changed")
                except (OSError, ValueError) as exc:
                    self.index_error = f"Index rebuild failed; the previous index is still in use: {exc}"

    def signature(self) -> str:
        docs = self.report.documents if self.report else []
        raw = "|".join(f"{d.doc_id}:{d.size_bytes}:{d.modified}" for d in sorted(docs, key=lambda d: d.doc_id))
        return hashlib.sha1(raw.encode()).hexdigest()

    def snapshot(self) -> tuple:
        """``(index, documents_by_id)`` captured together, consistent for one search."""
        with self._lock:
            return self.index, self._by_id

    def document_count(self) -> int:
        return len(self._by_id)

    def get(self, doc_id: str):
        with self._lock:
            return self._by_id.get(doc_id)

    def categories(self) -> list[dict]:
        counts: dict[str, int] = {}
        for c in list(self._by_id.values()):
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

    # -- index lifecycle ----------------------------------------------------
    def _load_or_rebuild_index(self) -> None:
        reason = None
        if self.index_path.is_file():
            try:
                idx = InvertedIndex.load(self.index_path)
                problems = idx.validate()
                if problems:
                    reason = "stored index failed validation"
                elif idx.settings.get("corpus_signature") != self.signature():
                    reason = "stored index was built from a different corpus"
                else:
                    self.index = idx
                    self.index_event = {"event": "loaded", "reason": "stored index is current"}
                    return
            except (ValueError, KeyError, TypeError, OSError) as exc:
                reason = f"stored index unreadable ({type(exc).__name__})"
        else:
            reason = "no stored index"
        if self.report is None:
            self.index_error = self.error
            return
        try:
            with self._lock:
                self._rebuild_locked(reason=reason)
        except (OSError, ValueError) as exc:
            self.index_error = f"Index could not be built: {exc}"

    def _rebuild_locked(self, *, reason: str, remove_stopwords: bool = False) -> InvertedIndex:
        """Build, validate, persist atomically, then swap. Caller holds ``self._lock``."""
        docs = list(self.report.documents) if self.report else []
        idx = build_index(docs, remove_stopwords=remove_stopwords)
        problems = idx.validate()
        if problems:
            raise ValueError("new index failed validation: " + "; ".join(problems[:3]))
        previous = self.index.settings.get("generation", 0) if self.index else 0
        idx.settings["corpus_signature"] = self.signature()
        idx.settings["generation"] = previous + 1
        idx.save(self.index_path)              # temp file + fsync + os.replace
        self.index = idx
        self.index_error = None
        self.index_event = {"event": "rebuilt", "reason": reason}
        return idx

    def index_status(self) -> dict:
        idx = self.index
        if idx is None:
            state = "unavailable"
        elif idx.settings.get("corpus_signature") != self.signature():
            state = "stale"
        else:
            state = "current"
        return {"state": state, "error": self.index_error, "stats": idx.stats() if idx else None,
                "generation": idx.settings.get("generation") if idx else None,
                "last_event": self.index_event, "corpus_documents": len(self._by_id),
                "retrieval_enabled": idx is not None,
                "ranking": "term_frequency",
                "note": "Search retrieves candidates from this index's posting lists and ranks them by term frequency."}

    def rebuild_index(self, actor: dict, remove_stopwords: bool = False) -> dict:
        if self.error:
            raise HttpError(503, "corpus_unavailable", self.error)
        if remove_stopwords:
            raise bad_request("Stop words are kept so that every query word can be matched.", "unsupported_option")
        with self._lock:
            try:
                idx = self._rebuild_locked(reason="requested by an administrator")
            except (OSError, ValueError) as exc:
                self.index_error = f"Index rebuild failed; the previous index is still in use: {exc}"
                raise HttpError(500, "index_rebuild_failed", "The index couldn't be rebuilt. The previous index is still in use.")
        self.audit.log(actor, "index_rebuilt", "shared-index", documents=len(idx.documents),
                       vocabulary=len(idx.postings), build_ms=idx.build_ms, generation=idx.settings["generation"])
        return self.index_status()

    def vocabulary(self, q: str = "", sort: str = "term", page: int = 1, per_page: int = 50) -> dict:
        if not self.index:
            raise HttpError(503, "index_unavailable", "The search index isn't available.")
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
            raise HttpError(503, "index_unavailable", "The search index isn't available.")
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
