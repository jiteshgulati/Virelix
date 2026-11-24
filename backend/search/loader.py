"""Document loader.

Discovers ``.txt`` documents in a folder, decodes them defensively, assigns
stable identifiers and extracts titles and metadata.

Optional metadata header — lines of ``Key: value`` terminated by a line that
contains only ``---``::

    Title: Inverted Indexes in Practice
    Author: Virelix Editorial
    Category: Information Retrieval
    Tags: indexing, postings
    Date: 2024-03-11
    ---
    Body text ...

Without a header the title is the first non-empty line (when short enough),
otherwise a title derived from the filename.

Run ``python -m backend.search.loader [folder]`` for a load report.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED_EXTENSIONS = {".txt"}
MAX_FILE_BYTES = 5 * 1024 * 1024
HEADER_KEYS = {"title", "author", "category", "tags", "date", "source", "summary"}
_HEADER_LINE = re.compile(r"^([A-Za-z][A-Za-z ]{0,30}):\s*(.*)$")


class LoaderError(Exception):
    """Raised when the corpus folder itself cannot be used."""


@dataclass
class Document:
    doc_id: str
    filename: str
    title: str
    text: str
    metadata: dict = field(default_factory=dict)
    size_bytes: int = 0
    modified: str = ""
    encoding: str = "utf-8"
    warnings: list = field(default_factory=list)

    @property
    def char_count(self) -> int:
        return len(self.text)

    def summary(self) -> dict:
        """Metadata without the full text (safe for listings)."""
        data = asdict(self)
        data.pop("text")
        data["char_count"] = self.char_count
        data["word_count"] = len(self.text.split())
        return data


@dataclass
class SkippedFile:
    filename: str
    reason: str          # unsupported_type | empty | binary | too_large | unreadable | not_a_file
    detail: str = ""


@dataclass
class LoadReport:
    folder: str
    documents: list = field(default_factory=list)
    skipped: list = field(default_factory=list)
    loaded_at: str = ""

    @property
    def counts(self) -> dict:
        reasons: dict[str, int] = {}
        for s in self.skipped:
            reasons[s.reason] = reasons.get(s.reason, 0) + 1
        return {
            "discovered": len(self.documents) + len(self.skipped),
            "loaded": len(self.documents),
            "skipped": len(self.skipped),
            "skipped_by_reason": reasons,
            "total_bytes": sum(d.size_bytes for d in self.documents),
            "with_warnings": sum(1 for d in self.documents if d.warnings),
        }

    def as_dict(self) -> dict:
        return {
            "folder": self.folder,
            "loaded_at": self.loaded_at,
            "counts": self.counts,
            "documents": [d.summary() for d in self.documents],
            "skipped": [asdict(s) for s in self.skipped],
        }


def stable_doc_id(filename: str) -> str:
    """Deterministic id from the case-folded filename: same file -> same id."""
    digest = hashlib.sha1(filename.casefold().encode("utf-8")).hexdigest()[:10]
    return f"doc-{digest}"


def decode_bytes(raw: bytes) -> tuple[str, str, list[str]]:
    """Decode text bytes. Returns (text, encoding, warnings).

    Raises ``ValueError`` when the content looks binary.
    """
    warnings: list[str] = []
    if b"\x00" in raw[:4096]:
        # UTF-16 files legitimately contain NULs; accept them only with a BOM.
        if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            try:
                return raw.decode("utf-16"), "utf-16", warnings
            except UnicodeDecodeError as exc:
                raise ValueError(f"invalid UTF-16 content: {exc}") from exc
        raise ValueError("file contains NUL bytes and appears to be binary")
    try:
        return raw.decode("utf-8-sig"), "utf-8", warnings
    except UnicodeDecodeError:
        pass
    try:
        text = raw.decode("cp1252")
        warnings.append("Not valid UTF-8; decoded as Windows-1252.")
        return text, "cp1252", warnings
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
        warnings.append("Malformed byte sequences were replaced with U+FFFD.")
        return text, "utf-8-replace", warnings


def _normalize_newlines(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Drop control characters other than tab/newline.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)


def parse_document_text(text: str) -> tuple[dict, str]:
    """Split an optional metadata header from the body."""
    lines = text.split("\n")
    meta: dict = {}
    for i, line in enumerate(lines[:20]):
        stripped = line.strip()
        if stripped == "---":
            if meta:
                return meta, "\n".join(lines[i + 1:]).strip("\n")
            break
        m = _HEADER_LINE.match(stripped)
        if not m or m.group(1).strip().lower() not in HEADER_KEYS:
            break
        key = m.group(1).strip().lower()
        value = m.group(2).strip()
        meta[key] = [t.strip() for t in value.split(",") if t.strip()] if key == "tags" else value
    return {}, text.strip("\n")


def title_from_filename(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"^\d+[-_ ]+", "", stem)
    words = re.split(r"[-_ ]+", stem)
    return " ".join(w.capitalize() for w in words if w) or filename


def derive_title(meta: dict, body: str, filename: str) -> str:
    if meta.get("title"):
        return meta["title"][:200]
    for line in body.split("\n"):
        line = line.strip().lstrip("#").strip()
        if line:
            if len(line) <= 90 and not line.endswith((".", ",", ";")):
                return line
            break
    return title_from_filename(filename)


def load_file(path: Path) -> Document:
    """Load one file. Raises ``ValueError`` (with a reason prefix) if unusable."""
    filename = path.name
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError("unsupported_type:Only .txt documents are supported.")
    try:
        stat = path.stat()
    except OSError as exc:
        raise ValueError(f"unreadable:{exc.strerror or exc}") from exc
    if stat.st_size > MAX_FILE_BYTES:
        raise ValueError(f"too_large:{stat.st_size} bytes exceeds {MAX_FILE_BYTES}.")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"unreadable:{exc.strerror or exc}") from exc
    try:
        text, encoding, warnings = decode_bytes(raw)
    except ValueError as exc:
        raise ValueError(f"binary:{exc}") from exc
    text = _normalize_newlines(text)
    if not text.strip():
        raise ValueError("empty:File has no readable text.")
    meta, body = parse_document_text(text)
    if not body.strip():
        raise ValueError("empty:File has a metadata header but no body text.")
    modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
    return Document(
        doc_id=stable_doc_id(filename),
        filename=filename,
        title=derive_title(meta, body, filename),
        text=body,
        metadata=meta,
        size_bytes=stat.st_size,
        modified=modified,
        encoding=encoding,
        warnings=warnings,
    )


def load_corpus(folder: Path | str) -> LoadReport:
    """Load every supported document directly inside ``folder`` (non-recursive)."""
    folder = Path(folder)
    if not folder.exists():
        raise LoaderError(f"Corpus folder does not exist: {folder}")
    if not folder.is_dir():
        raise LoaderError(f"Corpus path is not a folder: {folder}")
    try:
        entries = sorted(os.scandir(folder), key=lambda e: e.name.casefold())
    except PermissionError as exc:
        raise LoaderError(f"Corpus folder is not accessible: {folder}") from exc

    report = LoadReport(folder=str(folder), loaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    seen_ids: dict[str, str] = {}
    for entry in entries:
        name = entry.name
        if name.startswith(".") or name.lower() in {"readme.md", "inventory.json"}:
            continue
        if not entry.is_file():
            if entry.is_dir():
                continue
            report.skipped.append(SkippedFile(name, "not_a_file"))
            continue
        try:
            doc = load_file(Path(entry.path))
        except ValueError as exc:
            reason, _, detail = str(exc).partition(":")
            report.skipped.append(SkippedFile(name, reason, detail))
            continue
        if doc.doc_id in seen_ids:  # filenames differing only by case on case-sensitive FS
            report.skipped.append(SkippedFile(name, "duplicate_id", f"collides with {seen_ids[doc.doc_id]}"))
            continue
        seen_ids[doc.doc_id] = name
        report.documents.append(doc)
    return report


def main(argv: list[str]) -> int:
    from backend.config import ROOT
    folder = Path(argv[1]) if len(argv) > 1 else ROOT / "corpus"
    try:
        report = load_corpus(folder)
    except LoaderError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if "--json" in argv:
        print(json.dumps(report.as_dict(), indent=2))
        return 0
    c = report.counts
    print(f"Folder:   {report.folder}")
    print(f"Loaded:   {c['loaded']} of {c['discovered']} files ({c['total_bytes']:,} bytes)")
    for d in report.documents:
        cat = d.metadata.get("category", "—")
        print(f"  {d.doc_id}  {d.filename:<48} {cat:<26} {len(d.text.split()):>5} words")
    for s in report.skipped:
        print(f"  skipped  {s.filename:<48} {s.reason}  {s.detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
