#!/usr/bin/env python3
"""Inspect or deliberately resolve the Owner designation. Ownership never changes automatically.

    python scripts/owner_recovery.py status
    python scripts/owner_recovery.py release --email <current-owner-email> --confirm

``status`` is read-only. ``release`` returns the named Owner account to a standard
account (all of its data is kept) so that, after restarting the server, the
verified account matching OWNER_EMAIL can be designated. Stop the server first:
it keeps data in memory and would overwrite the change.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import from_env  # noqa: E402
from backend.security import mask_email, normalize_email  # noqa: E402
from backend.services.auth import AuthService  # noqa: E402
from backend.services.common import Auditor, Notifier, now  # noqa: E402
from backend.storage import DataDirLock, Database  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="show the Owner designation (read-only)")
    rel = sub.add_parser("release", help="return the current Owner account to a standard account")
    rel.add_argument("--email", required=True, help="email of the account that currently holds the Owner role")
    rel.add_argument("--confirm", action="store_true", help="required: confirms you intend to release ownership")
    args = ap.parse_args(argv)

    cfg = from_env(quiet=True)
    db = Database(cfg.data_dir)
    auth = AuthService(cfg, db, mailer=None, notifier=Notifier(db), auditor=Auditor(db))
    users = db.users.read()
    owners = [u for u in users.values() if u["role"] == "owner"]
    state = auth.owner_state(users)

    if args.cmd == "status":
        print(f"OWNER_EMAIL:        {mask_email(auth.configured_owner) if auth.configured_owner else 'not set'}")
        if state["config_error"]:
            print(f"Configuration:      {state['config_error']}")
        print(f"Owner accounts:     {', '.join(mask_email(o['email']) for o in owners) or 'none'}")
        print(f"Conflict:           {state['conflict'] or 'none'}")
        if state["conflict"]:
            print("\nResolve by either:")
            print("  1. setting OWNER_EMAIL back to the established Owner's address and restarting, or")
            print("  2. stopping the server, running `release --email <owner> --confirm`, then restarting.")
        return 0

    target = normalize_email(args.email)
    match = [o for o in owners if o["email"] == target]
    if not match:
        print("No Owner account has that email. Nothing changed.", file=sys.stderr)
        return 2
    if not args.confirm:
        print("Add --confirm to release ownership. Nothing changed.", file=sys.stderr)
        return 2
    if DataDirLock.is_held(cfg.data_dir / "server.lock"):
        print("A Virelix server is running on this data folder. Stop it first. Nothing changed.", file=sys.stderr)
        return 3
    with db.users.update() as live:
        live[match[0]["id"]]["role"] = "user"
        live[match[0]["id"]]["updated_at"] = now()
    Auditor(db).log(None, "owner_released", match[0]["email"], reason="manual owner_recovery.py release")
    print(f"Released Owner role from {mask_email(target)}. Restart the server to designate the OWNER_EMAIL account.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
