"""Accounts, sessions, email verification and password recovery."""

from __future__ import annotations

from backend import security as sec
from backend.services.common import Auditor, Notifier, conflict, iso, now
from backend.web import HttpError, bad_request

DEFAULT_PREFS = {
    "theme": "light",             # light | dark | oled | system (light is the default for new accounts)
    "accent": "viridian",
    "text_size": "md",            # sm | md | lg
    "density": "comfortable",     # comfortable | compact
    "sidebar": "expanded",        # expanded | collapsed
    "motion": "system",           # system | reduce | full
    "save_history": True,
    "default_mode": "any",        # any | all | phrase; any = a document matches if it contains at least one query term
    "per_page": 10,
    "default_sources": ["corpus", "attachments"],
    "show_excerpts": True,
    "show_matched_terms": True,
    "notify_security": True,
    "notify_roles": True,
    "notify_corpus": True,
}

GENERIC_LOGIN_ERROR = "That email and password combination didn't match an account."


class AuthService:
    def __init__(self, cfg, db, mailer, notifier: Notifier, auditor: Auditor):
        self.cfg = cfg
        self.db = db
        self.mailer = mailer
        self.notifier = notifier
        self.audit = auditor
        self.throttle = sec.LoginThrottle()
        self.mail_limiter = sec.RateLimiter(limit=5, window=15 * 60)
        self.password_throttle = sec.LoginThrottle(max_failures=5, window=15 * 60, lockout=15 * 60)
        configured = sec.normalize_email(cfg.owner_email or "")
        self.owner_config_error: str | None = None
        if configured and not sec.valid_email(configured):
            self.owner_config_error = "OWNER_EMAIL is not a valid email address; no Owner can be designated."
            configured = ""
        self.configured_owner = configured
        self.register_limiter = sec.RateLimiter(limit=cfg.register_rate_limit, window=3600)

    # -- lookups ------------------------------------------------------------
    def find_by_email(self, email: str) -> dict | None:
        email = sec.normalize_email(email)
        for user in self.db.users.read().values():
            if user["email"] == email:
                return user
        return None

    def get(self, user_id: str) -> dict | None:
        return self.db.users.read().get(user_id)

    # -- owner bootstrap ----------------------------------------------------
    # Owner governance -------------------------------------------------------
    # Exactly one designated Owner per installation. The Owner role is only ever
    # *granted* automatically when no Owner exists yet and the verified, active
    # account matches OWNER_EMAIL. It is never transferred or revoked
    # automatically: a stored Owner that no longer matches the configuration is
    # a *conflict*, which locks Owner-only governance (the account keeps Admin
    # capabilities and all of its data) until an operator resolves it.

    def owner_state(self, users: dict | None = None) -> dict:
        users = users if users is not None else self.db.users.read()
        owners = [u for u in users.values() if u["role"] == "owner"]
        conflict = None
        if len(owners) > 1:
            conflict = "multiple_owners"
        elif owners and not self.configured_owner:
            conflict = "owner_without_configuration"
        elif owners and owners[0]["email"] != self.configured_owner:
            conflict = "configuration_mismatch"
        elif owners and not owners[0].get("email_verified"):
            conflict = "owner_unverified"
        return {
            "configured": bool(self.configured_owner),
            "config_error": self.owner_config_error,
            "owner_established": bool(owners),
            "owner_account_registered": any(u["email"] == self.configured_owner for u in users.values())
                                        if self.configured_owner else False,
            "conflict": conflict,
        }

    def _grant_owner_locked(self, users: dict, user: dict) -> bool:
        """Grant Owner to ``user`` (inside the users lock) only if no Owner exists yet."""
        if not self.configured_owner or user["email"] != self.configured_owner:
            return False
        if not user.get("email_verified") or user["status"] != "active" or user["role"] == "owner":
            return False
        if any(u["role"] == "owner" for u in users.values()):
            return False  # never a second Owner
        user["role"] = "owner"
        user["updated_at"] = now()
        return True

    def reconcile_owner(self) -> dict:
        """Run at start-up. Grants the designated Owner if eligible; never revokes or transfers."""
        granted = None
        with self.db.users.update() as users:
            if not any(u["role"] == "owner" for u in users.values()):
                for user in users.values():
                    if self._grant_owner_locked(users, user):
                        granted = dict(user)
                        break
        if granted:
            self.audit.log(None, "owner_granted", granted["email"], reason="verified account matches OWNER_EMAIL")
        state = self.owner_state()
        if state["conflict"]:
            self.audit.log(None, "owner_conflict_detected", "governance", conflict=state["conflict"])
        return state

    def effective_user(self, user: dict) -> dict:
        """The account as the request sees it: Owner governance is locked during a conflict."""
        if user.get("role") == "owner" and self.owner_state()["conflict"]:
            return dict(user, role="admin", owner_locked=True)
        return user

    # -- registration & verification ---------------------------------------
    def register(self, data: dict, client: str) -> dict:
        fields = {}
        try:
            name = sec.clean_text(data.get("name"), max_len=80, field="Full name")
            if len(name) < 2:
                fields["name"] = "Enter your full name."
        except ValueError as exc:
            name, fields["name"] = "", str(exc)
        try:
            email = sec.normalize_email(sec.clean_text(data.get("email"), max_len=254, field="Email"))
            if not sec.valid_email(email):
                fields["email"] = "Enter a valid email address."
        except ValueError as exc:
            email, fields["email"] = "", str(exc)
        password = data.get("password") or ""
        problems = sec.password_problems(password, email, name)
        if problems:
            fields["password"] = " ".join(problems)
        if password != (data.get("confirm_password") or ""):
            fields["confirm_password"] = "Passwords don't match."
        if data.get("accept_terms") is not True:
            fields["accept_terms"] = "Accept the terms to create an account."
        if fields:
            raise bad_request("Please correct the highlighted fields.", "validation_error", fields=fields)
        # Any role-like input is ignored by design: public registration is always "user".
        if not self.register_limiter.allow(client):
            raise HttpError(429, "rate_limited", "Too many sign-up attempts. Try again in a few minutes.", retry_after=900)
        user = {
            "id": sec.new_id("usr"),
            "name": name,
            "email": email,
            "password_hash": sec.hash_password(password),
            "role": "user",
            "status": "active",
            "email_verified": False,
            "created_at": now(),
            "updated_at": now(),
            "last_login_at": None,
            "password_changed_at": now(),
            "prefs": dict(DEFAULT_PREFS),
        }
        with self.db.users.update() as users:
            if any(u["email"] == email for u in users.values()):
                raise conflict("An account with this email already exists. Sign in instead.", "email_taken")
            users[user["id"]] = user
        self._send_verification(user)
        return user

    def _issue_token(self, kind: str, user: dict, ttl_seconds: float) -> str:
        token = sec.new_token()
        with self.db.tokens.update() as tokens:
            for rec in tokens.values():  # one live token per kind per user
                if rec["user_id"] == user["id"] and rec["kind"] == kind and rec.get("used_at") is None:
                    rec["used_at"] = now()
                    rec["superseded"] = True
            tokens[sec.token_hash(token)] = {"kind": kind, "user_id": user["id"], "email": user["email"],
                                             "created_at": now(), "expires_at": now() + ttl_seconds, "used_at": None}
        return token

    @staticmethod
    def _check_token(rec: dict | None, kind: str) -> None:
        if not rec or rec["kind"] != kind:
            raise bad_request("This link is invalid.", "token_invalid")
        if rec.get("used_at") is not None:
            raise bad_request("This link has already been used.", "token_used")
        if rec["expires_at"] < now():
            raise bad_request("This link has expired. Request a new one.", "token_expired")

    def peek_token(self, kind: str, token: str) -> dict:
        """Validate a token without consuming it."""
        if not isinstance(token, str) or not 20 <= len(token) <= 100:
            raise bad_request("This link is invalid.", "token_invalid")
        rec = self.db.tokens.read().get(sec.token_hash(token))
        self._check_token(rec, kind)
        return rec  # type: ignore[return-value]

    def _consume_token(self, kind: str, token: str) -> dict:
        if not isinstance(token, str) or not 20 <= len(token) <= 100:
            raise bad_request("This link is invalid.", "token_invalid")
        with self.db.tokens.update() as tokens:
            rec = tokens.get(sec.token_hash(token))
            self._check_token(rec, kind)
            rec["used_at"] = now()
            return dict(rec)

    def _send_verification(self, user: dict) -> None:
        token = self._issue_token("verify", user, self.cfg.verify_token_hours * 3600)
        link = f"{self.cfg.base_url}/verify-email?token={token}"
        self.mailer.send(user["email"], "Verify your Virelix email",
                         f"Hello {user['name']},\n\nConfirm your email address to activate Virelix:\n{link}\n\n"
                         f"This link expires in {self.cfg.verify_token_hours} hours and can be used once.",
                         link=link, kind="verify")

    def verify_email(self, token: str) -> dict:
        rec = self._consume_token("verify", token)
        granted = False
        with self.db.users.update() as users:
            user = users.get(rec["user_id"])
            if not user or user["email"] != rec["email"]:
                raise bad_request("This link is invalid.", "token_invalid")
            user["email_verified"] = True
            user["verified_at"] = now()
            granted = self._grant_owner_locked(users, user)
            result = dict(user)
        self.notifier.push(result["id"], "account", "Email verified", "Your Virelix account is active.")
        if granted:
            self.audit.log(result, "owner_granted", result["email"], reason="verified OWNER_EMAIL account")
            self.notifier.push(result["id"], "role", "Owner access granted",
                               "This account matches the configured platform owner.", "/owner/admins")
        return result

    def resend_verification(self, email: str, client: str) -> None:
        email = sec.normalize_email(email or "")
        if not sec.valid_email(email):
            raise bad_request("Enter a valid email address.", "validation_error", fields={"email": "Enter a valid email address."})
        if not self.mail_limiter.allow(f"verify|{email}") or not self.mail_limiter.allow(f"verify-ip|{client}"):
            raise HttpError(429, "rate_limited", "Too many requests. Try again later.", retry_after=900)
        user = self.find_by_email(email)
        if user and not user.get("email_verified") and user["status"] == "active":
            self._send_verification(user)

    # -- login / sessions ---------------------------------------------------
    def login(self, data: dict, client: str, user_agent: str) -> tuple[str, dict, bool]:
        email = sec.normalize_email(data.get("email") or "")
        password = data.get("password") or ""
        remember = data.get("remember") is True
        fields = {}
        if not sec.valid_email(email):
            fields["email"] = "Enter a valid email address."
        if not password:
            fields["password"] = "Enter your password."
        if fields:
            raise bad_request("Please correct the highlighted fields.", "validation_error", fields=fields)
        wait = self.throttle.retry_after(email, client)
        if wait:
            raise HttpError(429, "too_many_attempts",
                            f"Too many failed attempts. Try again in {max(1, wait // 60)} minute(s).", retry_after=wait)
        user = self.find_by_email(email)
        ok = sec.verify_password(password, user["password_hash"] if user else sec.DUMMY_HASH)
        if not user or not ok:
            self.throttle.fail(email, client)
            raise HttpError(401, "invalid_credentials", GENERIC_LOGIN_ERROR)
        self.throttle.succeed(email, client)
        if user["status"] != "active":
            raise HttpError(403, "account_suspended", "This account is suspended. Contact a Virelix administrator.")
        if not user.get("email_verified"):
            raise HttpError(403, "email_unverified", "Verify your email before signing in.", email=user["email"])
        token = self.create_session(user, remember, client, user_agent)
        with self.db.users.update() as users:
            users[user["id"]]["last_login_at"] = now()
            fresh = dict(users[user["id"]])
        return token, self.effective_user(fresh), remember

    def create_session(self, user: dict, remember: bool, client: str, user_agent: str) -> str:
        token = sec.new_token()
        ttl = self.cfg.remember_days * 86400 if remember else self.cfg.session_hours * 3600
        with self.db.sessions.update() as sessions:
            self._prune(sessions)
            sessions[sec.token_hash(token)] = {
                "id": sec.new_id("ses"), "user_id": user["id"], "created_at": now(), "last_seen": now(),
                "expires_at": now() + ttl, "remember": remember, "ip": client, "user_agent": (user_agent or "")[:200],
            }
        return token

    @staticmethod
    def _prune(sessions: dict) -> None:
        t = now()
        for key in [k for k, s in sessions.items() if s["expires_at"] < t]:
            del sessions[key]

    def resolve(self, token: str | None) -> tuple[dict, dict] | tuple[None, None]:
        if not token or len(token) > 100:
            return None, None
        h = sec.token_hash(token)
        session = self.db.sessions.read().get(h)
        if not session or session["expires_at"] < now():
            return None, None
        user = self.get(session["user_id"])
        if not user or user["status"] != "active" or not user.get("email_verified"):
            return None, None
        if now() - session.get("last_seen", 0) > 120:
            with self.db.sessions.update() as sessions:
                if h in sessions:
                    sessions[h]["last_seen"] = now()
        session = dict(session, token_hash=h)
        return session, self.effective_user(user)

    def logout(self, token_hash_value: str) -> None:
        with self.db.sessions.update() as sessions:
            sessions.pop(token_hash_value, None)

    def revoke_sessions(self, user_id: str, *, keep: str | None = None) -> int:
        with self.db.sessions.update() as sessions:
            doomed = [k for k, s in sessions.items() if s["user_id"] == user_id and k != keep]
            for k in doomed:
                del sessions[k]
        return len(doomed)

    def list_sessions(self, user_id: str, current_hash: str) -> list[dict]:
        out = []
        for k, s in self.db.sessions.read().items():
            if s["user_id"] == user_id and s["expires_at"] > now():
                out.append({"id": s["id"], "created_at": iso(s["created_at"]), "last_seen": iso(s.get("last_seen")),
                            "expires_at": iso(s["expires_at"]), "remember": s["remember"],
                            "user_agent": s.get("user_agent", ""), "current": k == current_hash})
        out.sort(key=lambda s: s["last_seen"] or "", reverse=True)
        return out

    def revoke_session_by_id(self, user_id: str, session_id: str, current_hash: str) -> None:
        with self.db.sessions.update() as sessions:
            for k, s in list(sessions.items()):
                if s["id"] == session_id and s["user_id"] == user_id:
                    if k == current_hash:
                        raise bad_request("Use Sign out to end the current session.")
                    del sessions[k]
                    return
        raise HttpError(404, "not_found", "Session not found.")

    # -- password recovery --------------------------------------------------
    def forgot_password(self, email: str, client: str) -> None:
        email = sec.normalize_email(email or "")
        if not sec.valid_email(email):
            raise bad_request("Enter a valid email address.", "validation_error", fields={"email": "Enter a valid email address."})
        if not self.mail_limiter.allow(f"reset|{email}") or not self.mail_limiter.allow(f"reset-ip|{client}"):
            raise HttpError(429, "rate_limited", "Too many requests. Try again later.", retry_after=900)
        user = self.find_by_email(email)
        if not user or user["status"] != "active":
            return  # identical response: don't reveal which emails exist
        token = self._issue_token("reset", user, self.cfg.reset_token_minutes * 60)
        link = f"{self.cfg.base_url}/reset-password?token={token}"
        self.mailer.send(user["email"], "Reset your Virelix password",
                         f"Hello {user['name']},\n\nUse this link to choose a new password:\n{link}\n\n"
                         f"It expires in {self.cfg.reset_token_minutes} minutes and can be used once. "
                         "If you didn't ask for this, you can ignore this message.", link=link, kind="reset")

    def reset_password(self, data: dict) -> dict:
        password = data.get("password") or ""
        token = data.get("token") or ""
        # Check the link first (without using it up) so a weak password can be retried.
        rec = self.peek_token("reset", token)
        fields = {}
        problems = sec.password_problems(password, rec["email"])
        if problems:
            fields["password"] = " ".join(problems)
        if password != (data.get("confirm_password") or ""):
            fields["confirm_password"] = "Passwords don't match."
        if fields:
            raise bad_request("Please correct the highlighted fields.", "validation_error", fields=fields)
        rec = self._consume_token("reset", token)
        with self.db.users.update() as users:
            user = users.get(rec["user_id"])
            if not user:
                raise bad_request("This link is invalid.", "token_invalid")
            user["password_hash"] = sec.hash_password(password)
            user["password_changed_at"] = now()
            user["updated_at"] = now()
            result = dict(user)
        self.revoke_sessions(result["id"])
        with self.db.tokens.update() as tokens:
            for t in tokens.values():
                if t["user_id"] == result["id"] and t["kind"] == "reset" and t.get("used_at") is None:
                    t["used_at"] = now()
        self.notifier.push(result["id"], "security", "Password reset",
                           "Your password was reset and all sessions were signed out.")
        return result

    def change_password(self, user: dict, data: dict, keep_hash: str) -> None:
        wait = self.password_throttle.retry_after(user["id"], "password-change")
        if wait:
            raise HttpError(429, "too_many_attempts",
                            f"Too many incorrect attempts. Try again in {max(1, wait // 60)} minute(s).", retry_after=wait)
        if not sec.verify_password(data.get("current_password") or "", user["password_hash"]):
            self.password_throttle.fail(user["id"], "password-change")
            raise bad_request("Your current password is incorrect.", "validation_error",
                              fields={"current_password": "Current password is incorrect."})
        self.password_throttle.succeed(user["id"], "password-change")
        password = data.get("new_password") or ""
        fields = {}
        problems = sec.password_problems(password, user["email"], user["name"])
        if problems:
            fields["new_password"] = " ".join(problems)
        if password != (data.get("confirm_password") or ""):
            fields["confirm_password"] = "Passwords don't match."
        if sec.verify_password(password, user["password_hash"]):
            fields["new_password"] = "Choose a password different from your current one."
        if fields:
            raise bad_request("Please correct the highlighted fields.", "validation_error", fields=fields)
        with self.db.users.update() as users:
            u = users[user["id"]]
            u["password_hash"] = sec.hash_password(password)
            u["password_changed_at"] = now()
            u["updated_at"] = now()
        revoked = self.revoke_sessions(user["id"], keep=keep_hash)
        self.notifier.push(user["id"], "security", "Password changed",
                           f"Signed out {revoked} other session(s)." if revoked else "Your password was changed.")

    def update_profile(self, user: dict, data: dict) -> dict:
        try:
            name = sec.clean_text(data.get("name"), max_len=80, field="Full name")
        except ValueError as exc:
            raise bad_request(str(exc), "validation_error", fields={"name": str(exc)})
        if len(name) < 2:
            raise bad_request("Enter your full name.", "validation_error", fields={"name": "Enter your full name."})
        with self.db.users.update() as users:
            users[user["id"]]["name"] = name
            users[user["id"]]["updated_at"] = now()
            return dict(users[user["id"]])
