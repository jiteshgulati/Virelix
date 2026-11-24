"""Outbound email.

Only a *development* mailbox is implemented: messages are written to
``data/dev_outbox.json`` and printed to the server console. They are never
delivered to a real inbox, and the UI says so. Production delivery (SMTP or a
provider API) is a documented integration point.
"""

from __future__ import annotations

import sys

from backend.security import new_id
from backend.services.common import iso, now


class DevMailbox:
    provider = "development-mailbox"
    delivers = False
    MAX = 200

    def __init__(self, db, *, enabled: bool, quiet: bool = False):
        self.db = db
        self.enabled = enabled
        self.quiet = quiet

    def send(self, to: str, subject: str, text: str, link: str | None = None, kind: str = "general") -> dict:
        message = {"id": new_id("msg"), "to": to, "subject": subject, "text": text, "link": link,
                   "kind": kind, "created_at": iso(now()), "provider": self.provider}
        if not self.enabled:
            # No delivery provider configured: record nothing that could leak tokens.
            if not self.quiet:
                print(f"[virelix] email NOT sent (no provider configured): {kind} -> {to}", file=sys.stderr)
            return {**message, "link": None, "text": "", "status": "not_sent"}
        with self.db.outbox.update() as box:
            box.insert(0, message)
            del box[self.MAX:]
        if not self.quiet:
            print(f"\n[virelix dev mailbox] {subject}\n  to:   {to}\n  link: {link or '—'}\n", file=sys.stderr)
        return {**message, "status": "stored_in_dev_mailbox"}

    def list(self) -> list:
        return self.db.outbox.read()

    def clear(self) -> None:
        with self.db.outbox.update() as box:
            box.clear()
