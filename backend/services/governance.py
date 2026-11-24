"""Owner-only Admin invitations and Admin/Owner user management."""

from __future__ import annotations

from backend import security as sec
from backend.services.common import (Auditor, Notifier, conflict, forbidden, has_role, iso, not_found, now,
                                     public_user)
from backend.web import HttpError, bad_request


def invitation_status(inv: dict) -> str:
    if inv["status"] == "pending" and inv["expires_at"] < now():
        return "expired"
    return inv["status"]


def invitation_view(inv: dict) -> dict:
    return {
        "id": inv["id"], "email": inv["email"], "status": invitation_status(inv),
        "created_at": iso(inv["created_at"]), "expires_at": iso(inv["expires_at"]),
        "last_sent_at": iso(inv.get("last_sent_at")), "sent_count": inv.get("sent_count", 1),
        "invited_by": inv.get("invited_by_email"), "accepted_at": iso(inv.get("accepted_at")),
        "revoked_at": iso(inv.get("revoked_at")),
    }


class Governance:
    def __init__(self, cfg, db, auth, mailer, notifier: Notifier, auditor: Auditor):
        self.cfg = cfg
        self.db = db
        self.auth = auth
        self.mailer = mailer
        self.notifier = notifier
        self.audit = auditor

    # -- invitations (Owner only; enforced again here, not just in routing) --
    @staticmethod
    def _require_owner(actor: dict) -> None:
        if actor.get("role") != "owner":
            raise forbidden("Only the platform Owner can manage Admin invitations.")

    def list_invitations(self, actor: dict) -> list[dict]:
        self._require_owner(actor)
        items = [invitation_view(i) for i in self.db.invitations.read().values()]
        items.sort(key=lambda i: i["created_at"], reverse=True)
        return items

    def _send_invite(self, inv: dict, token: str) -> None:
        link = f"{self.cfg.base_url}/invite?token={token}"
        hours = self.cfg.invite_hours
        self.mailer.send(inv["email"], "You're invited to administer Virelix",
                         f"You have been invited to become a Virelix Admin.\n\nSign in (or create an account) with "
                         f"{inv['email']}, then open:\n{link}\n\nThe invitation expires in {hours} hours, works once "
                         "and only for this email address.", link=link, kind="invite")

    def invite(self, actor: dict, email: str) -> dict:
        self._require_owner(actor)
        email = sec.normalize_email(email or "")
        if not sec.valid_email(email):
            raise bad_request("Enter a valid email address.", "validation_error", fields={"email": "Enter a valid email address."})
        if email == actor["email"] or email == self.auth.configured_owner:
            raise bad_request("That address is the designated Owner and can't be invited as an Admin.", "validation_error",
                              fields={"email": "That's the Owner's address."})
        existing = self.auth.find_by_email(email)
        if existing and existing["role"] in {"admin", "owner"}:
            raise conflict("That account already has administrative access.", "already_admin")
        if existing and existing["status"] != "active":
            raise conflict("That account is suspended. Reactivate it before inviting.", "account_suspended")
        token = sec.new_token()
        inv = {"id": sec.new_id("inv"), "email": email, "token_hash": sec.token_hash(token), "status": "pending",
               "created_at": now(), "expires_at": now() + self.cfg.invite_hours * 3600, "last_sent_at": now(),
               "sent_count": 1, "invited_by": actor["id"], "invited_by_email": actor["email"]}
        with self.db.invitations.update() as invs:
            for other in invs.values():
                if other["email"] == email and invitation_status(other) == "pending":
                    raise conflict("A pending invitation already exists for this email. Resend it instead.", "invite_pending")
            invs[inv["id"]] = inv
        self._send_invite(inv, token)
        self.audit.log(actor, "admin_invited", email, invitation=inv["id"])
        return invitation_view(inv)

    def resend(self, actor: dict, inv_id: str) -> dict:
        self._require_owner(actor)
        token = sec.new_token()
        with self.db.invitations.update() as invs:
            inv = invs.get(inv_id)
            if not inv:
                raise not_found("Invitation not found.")
            if invitation_status(inv) not in {"pending", "expired"}:
                raise conflict(f"An {invitation_status(inv)} invitation can't be resent.", "invite_closed")
            inv["token_hash"] = sec.token_hash(token)   # the previous link stops working
            inv["status"] = "pending"
            inv["expires_at"] = now() + self.cfg.invite_hours * 3600
            inv["last_sent_at"] = now()
            inv["sent_count"] = inv.get("sent_count", 1) + 1
            result = dict(inv)
        self._send_invite(result, token)
        self.audit.log(actor, "admin_invite_resent", result["email"], invitation=inv_id)
        return invitation_view(result)

    def revoke(self, actor: dict, inv_id: str) -> dict:
        self._require_owner(actor)
        with self.db.invitations.update() as invs:
            inv = invs.get(inv_id)
            if not inv:
                raise not_found("Invitation not found.")
            if invitation_status(inv) not in {"pending", "expired"}:
                raise conflict(f"An {invitation_status(inv)} invitation can't be revoked.", "invite_closed")
            inv["status"] = "revoked"
            inv["revoked_at"] = now()
            result = dict(inv)
        self.audit.log(actor, "admin_invite_revoked", result["email"], invitation=inv_id)
        return invitation_view(result)

    def _find_by_token(self, token: str) -> dict | None:
        if not isinstance(token, str) or not 20 <= len(token) <= 100:
            return None
        h = sec.token_hash(token)
        for inv in self.db.invitations.read().values():
            if inv["token_hash"] == h:
                return inv
        return None

    def peek(self, token: str) -> dict:
        inv = self._find_by_token(token)
        if not inv:
            raise bad_request("This invitation link is invalid or has been replaced by a newer one.", "invite_invalid")
        return {"email": inv["email"], "status": invitation_status(inv), "expires_at": iso(inv["expires_at"])}

    def accept(self, user: dict, token: str) -> dict:
        inv = self._find_by_token(token)
        if not inv:
            raise bad_request("This invitation link is invalid or has been replaced by a newer one.", "invite_invalid")
        status = invitation_status(inv)
        if status != "pending":
            raise bad_request(f"This invitation is {status} and can no longer be used.", f"invite_{status}")
        if user["email"] != inv["email"]:
            raise forbidden("This invitation was issued to a different email address. Sign in with that account.")
        if user["role"] != "user":
            raise conflict("Your account already has administrative access.", "already_admin")
        with self.db.invitations.update() as invs:
            live = invs[inv["id"]]
            if invitation_status(live) != "pending" or live["token_hash"] != inv["token_hash"]:
                raise bad_request("This invitation can no longer be used.", "invite_invalid")
            live["status"] = "accepted"
            live["accepted_at"] = now()
            live["accepted_by"] = user["id"]
        with self.db.users.update() as users:
            users[user["id"]]["role"] = "admin"
            users[user["id"]]["updated_at"] = now()
            fresh = dict(users[user["id"]])
        self.audit.log(fresh, "admin_invite_accepted", fresh["email"], invitation=inv["id"])
        self.notifier.push(fresh["id"], "role", "Admin access granted",
                           "You can now manage the shared corpus, the search index and users.", "/admin")
        owner = self.db.users.read().get(inv["invited_by"])
        if owner:
            self.notifier.push(owner["id"], "role", "Invitation accepted",
                               f"{fresh['name']} ({fresh['email']}) is now an Admin.", "/owner/admins")
        return fresh

    def list_admins(self, actor: dict) -> list[dict]:
        self._require_owner(actor)
        return sorted((public_user(u) for u in self.db.users.read().values() if u["role"] == "admin"),
                      key=lambda u: u["name"].casefold())

    def remove_admin(self, actor: dict, user_id: str) -> dict:
        self._require_owner(actor)
        with self.db.users.update() as users:
            target = users.get(user_id)
            if not target:
                raise not_found("User not found.")
            if target["role"] != "admin":
                raise conflict("That account is not an Admin.", "not_admin")
            target["role"] = "user"
            target["updated_at"] = now()
            fresh = dict(target)
        self.audit.log(actor, "admin_removed", fresh["email"])
        self.notifier.push(fresh["id"], "role", "Admin access removed",
                           "Your account now has standard access.")
        return public_user(fresh)

    # -- user management (Admin and Owner) ---------------------------------
    def list_users(self, actor: dict, q: str = "", role: str = "", status: str = "") -> list[dict]:
        if not has_role(actor, "admin"):
            raise forbidden()
        q = (q or "").strip().casefold()
        sessions = self.db.sessions.read().values()
        active = {}
        for s in sessions:
            if s["expires_at"] > now():
                active[s["user_id"]] = active.get(s["user_id"], 0) + 1
        out = []
        for u in self.db.users.read().values():
            if q and q not in u["name"].casefold() and q not in u["email"]:
                continue
            if role and u["role"] != role:
                continue
            if status and u["status"] != status and not (status == "unverified" and not u.get("email_verified")):
                continue
            view = public_user(u)
            view["active_sessions"] = active.get(u["id"], 0)
            view["manageable"] = self._can_moderate(actor, u)
            out.append(view)
        out.sort(key=lambda u: (-{"owner": 2, "admin": 1, "user": 0}[u["role"]], u["name"].casefold()))
        return out

    @staticmethod
    def _can_moderate(actor: dict, target: dict) -> bool:
        return has_role(actor, "admin") and target["role"] == "user" and target["id"] != actor["id"]

    def user_detail(self, actor: dict, user_id: str) -> dict:
        if not has_role(actor, "admin"):
            raise forbidden()
        u = self.db.users.read().get(user_id)
        if not u:
            raise not_found("User not found.")
        view = public_user(u)
        view["verified_at"] = iso(u.get("verified_at"))
        view["suspended_at"] = iso(u.get("suspended_at"))
        view["suspension_reason"] = u.get("suspension_reason")
        view["active_sessions"] = sum(1 for s in self.db.sessions.read().values()
                                      if s["user_id"] == user_id and s["expires_at"] > now())
        view["manageable"] = self._can_moderate(actor, u)
        return view

    def set_status(self, actor: dict, user_id: str, status: str, reason: str = "") -> dict:
        if status not in {"active", "suspended"}:
            raise bad_request("Unknown status.")
        if not has_role(actor, "admin"):
            raise forbidden()
        try:
            reason = sec.clean_text(reason, max_len=200, field="Reason", required=False)
        except ValueError as exc:
            raise bad_request(str(exc))
        with self.db.users.update() as users:
            target = users.get(user_id)
            if not target:
                raise not_found("User not found.")
            if not self._can_moderate(actor, target):
                raise forbidden("Only standard user accounts other than your own can be suspended or reactivated.")
            if target["status"] == status:
                raise conflict(f"That account is already {status}.", "no_change")
            target["status"] = status
            target["updated_at"] = now()
            if status == "suspended":
                target["suspended_at"] = now()
                target["suspension_reason"] = reason or None
            else:
                target.pop("suspended_at", None)
                target.pop("suspension_reason", None)
            fresh = dict(target)
        if status == "suspended":
            self.auth.revoke_sessions(user_id)
        self.audit.log(actor, "user_suspended" if status == "suspended" else "user_reactivated", fresh["email"],
                       reason=reason or None)
        return self.user_detail(actor, user_id)
