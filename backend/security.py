"""Password hashing, token generation, validation and throttling helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
import unicodedata
from dataclasses import dataclass

# scrypt parameters (RFC 7914). n=2**14 keeps local login well under 100 ms.
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_LEN = 32

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R,
                            p=_SCRYPT_P, dklen=_SCRYPT_LEN, maxmem=64 * 1024 * 1024)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = _unb64(digest)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=_unb64(salt), n=int(n), r=int(r),
                                p=int(p), dklen=len(expected), maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# A pre-computed hash used to equalise timing when an email is unknown.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    """Tokens are stored hashed so a leaked data file cannot be replayed."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def normalize_email(email: str) -> str:
    return unicodedata.normalize("NFKC", (email or "").strip()).lower()


def valid_email(email: str) -> bool:
    return len(email) <= 254 and bool(EMAIL_RE.match(email))


def password_problems(password: str, email: str = "", name: str = "") -> list[str]:
    """Return human-readable policy violations (empty list = acceptable)."""
    problems = []
    if not isinstance(password, str) or len(password) < 10:
        problems.append("Use at least 10 characters.")
    if isinstance(password, str) and len(password) > 128:
        problems.append("Use 128 characters or fewer.")
    if isinstance(password, str):
        if not re.search(r"[A-Za-z]", password):
            problems.append("Include at least one letter.")
        if not re.search(r"\d", password):
            problems.append("Include at least one number.")
        low = password.lower()
        if email and low == email.lower():
            problems.append("Don't use your email address as your password.")
        local = email.split("@")[0].lower() if email else ""
        if local and len(local) >= 4 and local in low:
            problems.append("Avoid including your email name in the password.")
    return problems


def clean_text(value, *, max_len: int, field: str, required: bool = True) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text.")
    value = unicodedata.normalize("NFKC", value).strip()
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    if required and not value:
        raise ValueError(f"{field} is required.")
    if len(value) > max_len:
        raise ValueError(f"{field} must be {max_len} characters or fewer.")
    return value


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name: str, *, default: str = "document.txt") -> str:
    """Reduce an uploaded filename to a safe basename (no paths, no dotfiles)."""
    name = unicodedata.normalize("NFKC", name or "")
    name = name.replace("\\", "/").split("/")[-1]
    name = SAFE_NAME_RE.sub("-", name).strip(".-_")
    name = re.sub(r"-{2,}", "-", name)
    if not name:
        name = default
    if len(name) > 120:
        stem, dot, ext = name.rpartition(".")
        name = (stem[:110] + dot + ext) if dot else name[:120]
    return name


def mask_email(email: str) -> str:
    if "@" not in email:
        return "—"
    local, domain = email.split("@", 1)
    shown = local[:2] if len(local) > 2 else local[:1]
    return f"{shown}{'•' * max(1, len(local) - len(shown))}@{domain}"


@dataclass
class _Bucket:
    failures: list
    locked_until: float = 0.0


class LoginThrottle:
    """Sliding-window throttle keyed by (email, client address)."""

    def __init__(self, max_failures: int = 5, window: float = 15 * 60, lockout: float = 15 * 60):
        self.max_failures = max_failures
        self.window = window
        self.lockout = lockout
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def _key(self, email: str, addr: str) -> str:
        return f"{email}|{addr}"

    def retry_after(self, email: str, addr: str) -> int:
        with self._lock:
            b = self._buckets.get(self._key(email, addr))
            if b and b.locked_until > time.time():
                return int(b.locked_until - time.time()) + 1
            return 0

    def fail(self, email: str, addr: str) -> None:
        now = time.time()
        with self._lock:
            b = self._buckets.setdefault(self._key(email, addr), _Bucket(failures=[]))
            b.failures = [t for t in b.failures if now - t < self.window] + [now]
            if len(b.failures) >= self.max_failures:
                b.locked_until = now + self.lockout
                b.failures = []

    def succeed(self, email: str, addr: str) -> None:
        with self._lock:
            self._buckets.pop(self._key(email, addr), None)


class RateLimiter:
    """Simple fixed-window limiter for email-sending endpoints."""

    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < self.window]
            if len(hits) >= self.limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True
