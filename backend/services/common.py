from __future__ import annotations

import time
from datetime import datetime, timezone

from backend.web import HttpError

ROLES = ("user", "admin", "owner")
ROLE_RANK = {"user": 0, "admin": 1, "owner": 2}


def now() -> float:
    return time.time()


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def has_role(user: dict, minimum: str) -> bool:
    return ROLE_RANK.get(user.get("role", "user"), 0) >= ROLE_RANK[minimum]


def forbidden(message: str = "You don't have permission to do that.") -> HttpError:
    return HttpError(403, "forbidden", message)


def not_found(message: str = "Not found.") -> HttpError:
    return HttpError(404, "not_found", message)


def conflict(message: str, code: str = "conflict") -> HttpError:
    return HttpError(409, code, message)


def public_user(user: dict, *, include_private: bool = False) -> dict:
    out = {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "status": user["status"],
        "email_verified": user.get("email_verified", False),
        "created_at": iso(user.get("created_at")),
        "last_login_at": iso(user.get("last_login_at")),
    }
    if include_private:
        out["prefs"] = user.get("prefs", {})
        out["password_changed_at"] = iso(user.get("password_changed_at"))
    return out


class Notifier:
    """In-app notifications (no email/push delivery is implemented)."""

    MAX = 100

    def __init__(self, db):
        self.db = db

    PREF_FOR_KIND = {"security": "notify_security", "role": "notify_roles", "corpus": "notify_corpus"}

    def push(self, user_id: str, kind: str, title: str, body: str = "", link: str | None = None) -> None:
        from backend.security import new_id
        pref = self.PREF_FOR_KIND.get(kind)
        if pref:
            user = self.db.users.read().get(user_id) or {}
            if not (user.get("prefs") or {}).get(pref, True):
                return  # the user opted out of this kind of in-app notice
        with self.db.notifications.update() as data:
            items = data.setdefault(user_id, [])
            items.insert(0, {"id": new_id("ntf"), "kind": kind, "title": title, "body": body,
                             "link": link, "created_at": iso(now()), "read": False})
            del items[self.MAX:]

    def list(self, user_id: str) -> list:
        return self.db.notifications.read().get(user_id, [])

    def mark_read(self, user_id: str, ids: list[str] | None = None) -> int:
        count = 0
        with self.db.notifications.update() as data:
            for item in data.get(user_id, []):
                if not item["read"] and (ids is None or item["id"] in ids):
                    item["read"] = True
                    count += 1
        return count

    def clear(self, user_id: str) -> None:
        with self.db.notifications.update() as data:
            data[user_id] = []


class Auditor:
    """Append-only log of privileged actions."""

    def __init__(self, db):
        self.db = db

    def log(self, actor: dict | None, action: str, target: str = "", **details) -> None:
        self.db.append_audit({
            "at": iso(now()),
            "actor_id": actor["id"] if actor else None,
            "actor_email": actor["email"] if actor else "system",
            "actor_role": actor["role"] if actor else "system",
            "action": action,
            "target": target,
            "details": details,
        })
