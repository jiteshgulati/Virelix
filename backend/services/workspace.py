"""Per-user workspace: search history, saved results, collections, private attachments, preferences."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path

from backend import security as sec
from backend.search.loader import decode_bytes, derive_title, parse_document_text
from backend.search.index import build_index
from backend.search.loader import Document
from backend.services.auth import DEFAULT_PREFS
from backend.services.common import conflict, iso, not_found, now
from backend.web import HttpError, bad_request

ACCENTS = {"viridian", "lapis", "oxblood", "ochre", "plum", "graphite"}
PREF_CHOICES = {
    "theme": {"light", "dark", "oled", "system"},
    "accent": ACCENTS,
    "text_size": {"sm", "md", "lg"},
    "density": {"comfortable", "compact"},
    "sidebar": {"expanded", "collapsed"},
    "motion": {"system", "reduce", "full"},
    "default_mode": {"all", "any", "phrase"},
}
PREF_BOOLS = {"save_history", "show_excerpts", "show_matched_terms", "notify_security", "notify_roles", "notify_corpus"}
SOURCES = {"corpus", "attachments"}
MAX_HISTORY = 300
MAX_SAVED = 500
MAX_COLLECTIONS = 100
MAX_COLLECTION_ITEMS = 500


def _empty() -> dict:
    return {"history": [], "saved": [], "collections": [], "attachments": []}


class WorkspaceService:
    def __init__(self, cfg, db, corpus):
        self.cfg = cfg
        self.db = db
        self.corpus = corpus
        self._att_lock = threading.Lock()
        self._private_lock = threading.Lock()
        self._private_cache: dict = {}   # user_id -> (signature, index, documents_by_id)

    def _ws(self, data: dict, user_id: str) -> dict:
        ws = data.setdefault(user_id, _empty())
        for k, v in _empty().items():
            ws.setdefault(k, v)
        return ws

    def read(self, user_id: str) -> dict:
        return self.db.workspace.read().get(user_id) or _empty()

    # -- preferences --------------------------------------------------------
    def update_prefs(self, user: dict, changes: dict) -> dict:
        if not isinstance(changes, dict) or not changes:
            raise bad_request("No preferences supplied.")
        clean = {}
        for key, value in changes.items():
            if key in PREF_CHOICES:
                if value not in PREF_CHOICES[key]:
                    raise bad_request(f"Invalid value for {key}.", "validation_error")
                clean[key] = value
            elif key in PREF_BOOLS:
                if not isinstance(value, bool):
                    raise bad_request(f"{key} must be true or false.", "validation_error")
                clean[key] = value
            elif key == "per_page":
                if value not in (10, 20, 30):
                    raise bad_request("Results per page must be 10, 20 or 30.", "validation_error")
                clean[key] = value
            elif key == "default_sources":
                if not isinstance(value, list) or not value or not set(value) <= SOURCES:
                    raise bad_request("Choose at least one valid source.", "validation_error")
                clean[key] = sorted(set(value))
            else:
                raise bad_request(f"Unknown preference: {key}.", "validation_error")
        with self.db.users.update() as users:
            prefs = users[user["id"]].setdefault("prefs", dict(DEFAULT_PREFS))
            prefs.update(clean)
            return {**DEFAULT_PREFS, **prefs}

    # -- history ------------------------------------------------------------
    def record_search(self, user: dict, entry: dict) -> None:
        if not user.get("prefs", {}).get("save_history", True):
            return
        item = {"id": sec.new_id("hst"), "at": iso(now()), **entry}
        sig = lambda h: (h.get("query"), h.get("mode"), tuple(h.get("sources") or ()), tuple(h.get("categories") or ()))
        with self.db.workspace.update() as data:
            hist = self._ws(data, user["id"])["history"]
            if hist and sig(hist[0]) == sig(item):
                # Re-running the same search back-to-back refreshes the entry instead of duplicating it.
                hist[0].update(at=item["at"], result_count=item.get("result_count"), sort=item.get("sort"))
                return
            hist.insert(0, item)
            del hist[MAX_HISTORY:]

    def delete_history(self, user_id: str, entry_id: str) -> None:
        with self.db.workspace.update() as data:
            hist = self._ws(data, user_id)["history"]
            before = len(hist)
            hist[:] = [h for h in hist if h["id"] != entry_id]
            if len(hist) == before:
                raise not_found("History entry not found.")

    def clear_history(self, user_id: str) -> int:
        with self.db.workspace.update() as data:
            hist = self._ws(data, user_id)["history"]
            n = len(hist)
            hist.clear()
        return n

    # -- saved results ------------------------------------------------------
    def _doc_snapshot(self, doc_id: str) -> dict:
        doc = self.corpus.get(doc_id) if isinstance(doc_id, str) else None
        if not doc:
            raise not_found("That document is no longer in the shared corpus.")
        from backend.search.overview import lead_excerpt
        return {"doc_id": doc.doc_id, "title": doc.title, "source": "corpus", "filename": doc.filename,
                "category": doc.metadata.get("category"),
                "excerpt": doc.metadata.get("summary") or lead_excerpt(doc.text, 220)}

    def list_saved(self, user_id: str) -> list[dict]:
        out = []
        for item in self.read(user_id)["saved"]:
            view = dict(item)
            view["available"] = item["kind"] != "document" or self.corpus.get(item["doc_id"]) is not None
            out.append(view)
        return out

    def save_document(self, user_id: str, doc_id: str, query: str = "") -> dict:
        snap = self._doc_snapshot(doc_id)
        with self.db.workspace.update() as data:
            saved = self._ws(data, user_id)["saved"]
            if any(s["kind"] == "document" and s.get("doc_id") == doc_id for s in saved):
                raise conflict("This document is already in Saved Results.", "already_saved")
            if len(saved) >= MAX_SAVED:
                raise conflict("Saved Results is full. Remove some items first.", "limit_reached")
            item = {"id": sec.new_id("sav"), "kind": "document", "saved_at": iso(now()),
                    "query": (query or "")[:300], **snap}
            saved.insert(0, item)
        return item

    def save_overview(self, user_id: str, query: str, mode: str, result: dict) -> dict:
        """Save an extractive overview computed by the server (never from client-supplied passages)."""
        if not result["passages"]:
            raise bad_request("There is no overview content to save for this query.", "nothing_to_save")
        with self.db.workspace.update() as data:
            saved = self._ws(data, user_id)["saved"]
            if len(saved) >= MAX_SAVED:
                raise conflict("Saved Results is full. Remove some items first.", "limit_reached")
            item = {"id": sec.new_id("sav"), "kind": "overview", "saved_at": iso(now()), "query": query[:300],
                    "mode": mode, "title": f"Extractive preview · “{query[:80]}”",
                    "passages": result["passages"], "references": result["references"], "source": "corpus"}
            saved.insert(0, item)
        return item

    def unsave(self, user_id: str, saved_id: str | None = None, doc_id: str | None = None) -> None:
        with self.db.workspace.update() as data:
            saved = self._ws(data, user_id)["saved"]
            before = len(saved)
            if saved_id:
                saved[:] = [s for s in saved if s["id"] != saved_id]
            elif doc_id:
                saved[:] = [s for s in saved if not (s["kind"] == "document" and s.get("doc_id") == doc_id)]
            if len(saved) == before:
                raise not_found("That item isn't in Saved Results.")

    def saved_doc_ids(self, user_id: str) -> set:
        return {s["doc_id"] for s in self.read(user_id)["saved"] if s["kind"] == "document"}

    # -- collections --------------------------------------------------------
    def _name(self, value) -> str:
        try:
            name = sec.clean_text(value, max_len=60, field="Collection name")
        except ValueError as exc:
            raise bad_request(str(exc), "validation_error", fields={"name": str(exc)})
        return name

    def _collection_view(self, col: dict, with_items: bool = False) -> dict:
        view = {k: v for k, v in col.items() if k != "items"}
        view["item_count"] = len(col["items"])
        if with_items:
            view["items"] = [dict(i, available=self.corpus.get(i["doc_id"]) is not None) for i in col["items"]]
        return view

    def list_collections(self, user_id: str) -> list[dict]:
        return [self._collection_view(c) for c in self.read(user_id)["collections"]]

    def get_collection(self, user_id: str, col_id: str) -> dict:
        for c in self.read(user_id)["collections"]:
            if c["id"] == col_id:
                return self._collection_view(c, with_items=True)
        raise not_found("Collection not found.")

    def create_collection(self, user_id: str, data: dict) -> dict:
        name = self._name(data.get("name"))
        try:
            desc = sec.clean_text(data.get("description"), max_len=200, field="Description", required=False)
        except ValueError as exc:
            raise bad_request(str(exc), "validation_error", fields={"description": str(exc)})
        with self.db.workspace.update() as db:
            cols = self._ws(db, user_id)["collections"]
            if any(c["name"].casefold() == name.casefold() for c in cols):
                raise conflict("You already have a collection with that name.", "duplicate_name")
            if len(cols) >= MAX_COLLECTIONS:
                raise conflict("You've reached the collection limit.", "limit_reached")
            col = {"id": sec.new_id("col"), "name": name, "description": desc, "created_at": iso(now()),
                   "updated_at": iso(now()), "items": []}
            cols.insert(0, col)
        initial = data.get("doc_id")
        if initial:
            self.add_to_collection(user_id, col["id"], initial)
            return self.get_collection(user_id, col["id"])
        return self._collection_view(col, with_items=True)

    def rename_collection(self, user_id: str, col_id: str, data: dict) -> dict:
        name = self._name(data.get("name"))
        with self.db.workspace.update() as db:
            cols = self._ws(db, user_id)["collections"]
            col = next((c for c in cols if c["id"] == col_id), None)
            if not col:
                raise not_found("Collection not found.")
            if any(c["id"] != col_id and c["name"].casefold() == name.casefold() for c in cols):
                raise conflict("You already have a collection with that name.", "duplicate_name")
            col["name"] = name
            if "description" in data:
                try:
                    col["description"] = sec.clean_text(data.get("description"), max_len=200, field="Description", required=False)
                except ValueError as exc:
                    raise bad_request(str(exc), "validation_error")
            col["updated_at"] = iso(now())
            return self._collection_view(col)

    def delete_collection(self, user_id: str, col_id: str) -> None:
        with self.db.workspace.update() as db:
            cols = self._ws(db, user_id)["collections"]
            before = len(cols)
            cols[:] = [c for c in cols if c["id"] != col_id]
            if len(cols) == before:
                raise not_found("Collection not found.")

    def add_to_collection(self, user_id: str, col_id: str, doc_id: str) -> dict:
        snap = self._doc_snapshot(doc_id)
        with self.db.workspace.update() as db:
            col = next((c for c in self._ws(db, user_id)["collections"] if c["id"] == col_id), None)
            if not col:
                raise not_found("Collection not found.")
            if any(i["doc_id"] == doc_id for i in col["items"]):
                raise conflict(f"Already in “{col['name']}”.", "duplicate_item")
            if len(col["items"]) >= MAX_COLLECTION_ITEMS:
                raise conflict("This collection is full.", "limit_reached")
            col["items"].insert(0, {"doc_id": doc_id, "title": snap["title"], "category": snap["category"],
                                    "excerpt": snap["excerpt"], "added_at": iso(now())})
            col["updated_at"] = iso(now())
            return self._collection_view(col)

    def remove_from_collection(self, user_id: str, col_id: str, doc_id: str) -> None:
        with self.db.workspace.update() as db:
            col = next((c for c in self._ws(db, user_id)["collections"] if c["id"] == col_id), None)
            if not col:
                raise not_found("Collection not found.")
            before = len(col["items"])
            col["items"] = [i for i in col["items"] if i["doc_id"] != doc_id]
            if len(col["items"]) == before:
                raise not_found("That document isn't in this collection.")
            col["updated_at"] = iso(now())

    def collections_containing(self, user_id: str, doc_id: str) -> list[str]:
        return [c["id"] for c in self.read(user_id)["collections"] if any(i["doc_id"] == doc_id for i in c["items"])]

    # -- private attachments -----------------------------------------------
    def _att_dir(self, user_id: str) -> Path:
        safe = sec.safe_filename(user_id, default="unknown")
        return self.db.attachments_dir / safe

    def _purge_expired(self, user_id: str) -> None:
        t = now()
        with self.db.workspace.update() as db:
            atts = self._ws(db, user_id)["attachments"]
            expired = [a for a in atts if a["expires_ts"] < t]
            if not expired:
                return
            atts[:] = [a for a in atts if a["expires_ts"] >= t]
        for a in expired:
            (self._att_dir(user_id) / f"{a['id']}.txt").unlink(missing_ok=True)

    def list_attachments(self, user_id: str) -> list[dict]:
        self._purge_expired(user_id)
        return [{k: v for k, v in a.items() if k != "expires_ts"} for a in self.read(user_id)["attachments"]]

    def add_attachment(self, user_id: str, filename: str, raw: bytes) -> dict:
        self._purge_expired(user_id)
        name = sec.safe_filename(filename, default="attachment.txt")
        if Path(name).suffix.lower() != ".txt":
            raise HttpError(415, "unsupported_type",
                            "Only .txt files can be attached. PDF, Word and image files aren't supported yet.")
        if not raw:
            raise bad_request("The file is empty.", "empty_file")
        if len(raw) > self.cfg.max_attachment_bytes:
            raise HttpError(413, "file_too_large", f"Attachments must be {self.cfg.max_attachment_bytes // 1024} KB or smaller.")
        try:
            text, encoding, warnings = decode_bytes(raw)
        except ValueError:
            raise HttpError(415, "binary_file", "That file isn't plain text.")
        meta, body = parse_document_text(text.replace("\r\n", "\n").replace("\r", "\n"))
        if not body.strip():
            raise bad_request("The file has no readable text.", "empty_file")
        att_id = sec.new_id("att")
        with self._att_lock:
            current = self.read(user_id)["attachments"]
            if len(current) >= self.cfg.max_attachments:
                raise conflict(f"You can attach up to {self.cfg.max_attachments} files at a time. Remove one first.",
                               "limit_reached")
            folder = self._att_dir(user_id)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{att_id}.txt").write_text(body, encoding="utf-8")
            ttl = self.cfg.attachment_ttl_hours * 3600
            att = {"id": att_id, "filename": name, "title": derive_title(meta, body, name), "size_bytes": len(raw),
                   "words": len(body.split()), "encoding": encoding, "warnings": warnings,
                   "uploaded_at": iso(now()), "expires_at": iso(now() + ttl), "expires_ts": now() + ttl,
                   "metadata": meta}
            with self.db.workspace.update() as db:
                self._ws(db, user_id)["attachments"].insert(0, att)
        return {k: v for k, v in att.items() if k != "expires_ts"}

    def remove_attachment(self, user_id: str, att_id: str) -> None:
        with self.db.workspace.update() as db:
            atts = self._ws(db, user_id)["attachments"]
            before = len(atts)
            atts[:] = [a for a in atts if a["id"] != att_id]
            if len(atts) == before:
                raise not_found("Attachment not found.")
        (self._att_dir(user_id) / f"{sec.safe_filename(att_id)}.txt").unlink(missing_ok=True)

    def clear_attachments(self, user_id: str) -> int:
        with self.db.workspace.update() as db:
            atts = self._ws(db, user_id)["attachments"]
            n = len(atts)
            atts.clear()
        shutil.rmtree(self._att_dir(user_id), ignore_errors=True)
        return n

    def attachment_text(self, user_id: str, att_id: str) -> tuple[dict, str]:
        self._purge_expired(user_id)
        att = next((a for a in self.read(user_id)["attachments"] if a["id"] == att_id), None)
        if not att:
            raise not_found("Attachment not found or it has expired.")
        path = self._att_dir(user_id) / f"{att['id']}.txt"
        try:
            return att, path.read_text(encoding="utf-8")
        except OSError:
            raise not_found("Attachment file is missing.")

    def private_index(self, user_id: str) -> tuple:
        """``(index, documents_by_id)`` over this user's current attachments only.

        Built in memory from the user's own files and cached until their set of
        attachments changes (upload, removal, clearing or expiry). It's never merged
        into the shared index, persisted, or exposed through administration APIs.
        """
        current = self.list_attachments(user_id)          # also purges expired attachments
        signature = tuple((a["id"], a["uploaded_at"]) for a in current)
        with self._private_lock:
            cached = self._private_cache.get(user_id)
            if cached and cached[0] == signature:
                return cached[1], cached[2]
        docs = {}
        for a in current:
            try:
                _, text = self.attachment_text(user_id, a["id"])
            except HttpError:
                continue
            docs[a["id"]] = Document(doc_id=a["id"], filename=a["filename"], title=a["title"], text=text,
                                     metadata=a.get("metadata") or {}, size_bytes=a["size_bytes"],
                                     modified=a["uploaded_at"], encoding=a.get("encoding", "utf-8"))
        index = build_index(list(docs.values()))
        with self._private_lock:
            self._private_cache[user_id] = (signature, index, docs)
        return index, docs
