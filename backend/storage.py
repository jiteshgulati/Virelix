"""JSON filesystem persistence with atomic writes.

Each collection is one JSON file guarded by a re-entrant lock. Writes go to a
temporary file in the same directory followed by ``os.replace`` so a crash
never leaves a half-written file behind.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        # Cloud-synced folders (e.g. OneDrive) can briefly lock the target.
        for attempt in range(6):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(0.05 * (attempt + 1))
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


class DataDirInUse(RuntimeError):
    """Another Virelix server holds the data-folder lock."""

    def __init__(self, path: Path, pid: int | None):
        self.pid = pid
        super().__init__(f"Another Virelix server{f' (pid {pid})' if pid else ''} is using {path.parent}. Stop it first.")


class DataDirLock:
    """Exclusive, crash-safe lock on a data folder (``server.lock``), portable across Windows, Linux and macOS.

    The JSON stores are cached in memory, so two servers on one folder would overwrite each other. The
    lock is an OS-level byte-range lock (``msvcrt.locking`` on Windows, ``fcntl.flock`` elsewhere) held on
    an open file for the life of the process, so the operating system releases it if the server crashes:
    there are no stale lock files and no process-signalling. The first byte is the locked region; the
    holder's pid follows it so others can name it without reading the locked byte.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._fh = None

    def acquire(self) -> "DataDirLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(self.path, "a+b")
        try:
            self._lock(fh)
        except OSError:
            fh.close()
            raise DataDirInUse(self.path, self.holder_pid()) from None
        fh.seek(0)
        fh.truncate()
        fh.write(b"L" + str(os.getpid()).encode("ascii"))
        fh.flush()
        self._fh = fh
        return self

    def holder_pid(self) -> int | None:
        try:
            with open(self.path, "rb") as fh:
                fh.seek(1)
                return int(fh.read(16).decode("ascii") or 0) or None
        except (OSError, ValueError):
            return None

    def release(self) -> None:
        fh, self._fh = self._fh, None
        if fh is None:
            return
        try:
            self._unlock(fh)
        finally:
            fh.close()
            try:
                self.path.unlink()
            except OSError:
                pass  # another server may already be starting; the lock file is harmless

    def __enter__(self) -> "DataDirLock":
        return self.acquire()

    def __exit__(self, *exc) -> None:
        self.release()

    @staticmethod
    def _lock(fh) -> None:
        if sys.platform == "win32":
            import msvcrt
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    @staticmethod
    def _unlock(fh) -> None:
        if sys.platform == "win32":
            import msvcrt
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)

    @classmethod
    def is_held(cls, path: Path) -> bool:
        """True if another process currently holds the lock (read-only probe for tooling)."""
        probe = cls(path)
        try:
            probe.acquire()
        except DataDirInUse:
            return True
        probe.release()
        return False


class JsonStore:
    """A small typed-by-convention JSON document store."""

    def __init__(self, path: Path, default: Callable[[], Any]):
        self.path = path
        self._default = default
        self._lock = threading.RLock()
        self._data: Any = None

    def _load(self) -> Any:
        if self._data is None:
            if self.path.is_file():
                with self.path.open("r", encoding="utf-8") as fh:
                    self._data = json.load(fh)
            else:
                self._data = self._default()
        return self._data

    def read(self) -> Any:
        """Return a deep copy so callers cannot mutate state without ``update``."""
        with self._lock:
            return copy.deepcopy(self._load())

    @contextmanager
    def update(self):
        """Yield the live data; persist atomically on clean exit."""
        with self._lock:
            data = self._load()
            snapshot = copy.deepcopy(data)
            try:
                yield data
            except BaseException:
                self._data = snapshot
                raise
            atomic_write_text(self.path, json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True))


class Database:
    """All persistent collections used by the application."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        data_dir.mkdir(parents=True, exist_ok=True)
        self.users = JsonStore(data_dir / "users.json", dict)              # id -> user
        self.sessions = JsonStore(data_dir / "sessions.json", dict)        # token_hash -> session
        self.tokens = JsonStore(data_dir / "tokens.json", dict)            # token_hash -> token record
        self.invitations = JsonStore(data_dir / "invitations.json", dict)  # id -> invitation
        self.workspace = JsonStore(data_dir / "workspace.json", dict)      # user_id -> workspace
        self.notifications = JsonStore(data_dir / "notifications.json", dict)  # user_id -> [..]
        self.outbox = JsonStore(data_dir / "dev_outbox.json", list)        # development mail only
        self.attachments_dir = data_dir / "attachments"
        self.index_dir = data_dir / "index"
        self.removed_dir = data_dir / "removed_documents"
        self.audit_path = data_dir / "audit.log.jsonl"
        self._audit_lock = threading.Lock()

    def append_audit(self, entry: dict) -> None:
        line = json.dumps(entry, ensure_ascii=False, sort_keys=True)
        with self._audit_lock:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)
            with self.audit_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")

    def read_audit(self, limit: int = 200) -> list[dict]:
        if not self.audit_path.is_file():
            return []
        with self._audit_lock:
            lines = self.audit_path.read_text(encoding="utf-8").splitlines()
        out = []
        for line in reversed(lines[-limit:]):
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out
