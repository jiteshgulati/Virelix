"""Application wiring: services, API routes, authentication and CSRF enforcement."""

from __future__ import annotations

import hmac
import os
import platform
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit

from backend import __version__
from backend import security as sec
from backend.search.engine import QueryError
from backend.services.auth import DEFAULT_PREFS, AuthService
from backend.services.common import Auditor, Notifier, forbidden, has_role, iso, now, public_user
from backend.services.corpus import CorpusService
from backend.services.governance import Governance
from backend.services.search import SearchService
from backend.services.mailer import DevMailbox
from backend.services.workspace import WorkspaceService
from backend.storage import Database
from backend.web import HttpError, Request, Response, Router, bad_request, error_response, json_response

SESSION_COOKIE = "vx_session"
CSRF_COOKIE = "vx_csrf"
CSRF_HEADER = "x-csrf-token"
MAX_RAW_UPLOAD = 2 * 1024 * 1024
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


@dataclass
class Ctx:
    req: Request
    params: dict
    user: dict | None = None
    session: dict | None = None
    cookies: list = field(default_factory=list)   # (name, value, kwargs)

    @property
    def uid(self) -> str:
        return self.user["id"]  # type: ignore[index]


class App:
    def __init__(self, cfg):
        self.cfg = cfg
        self.started_at = now()
        self.db = Database(cfg.data_dir)
        self.notifier = Notifier(self.db)
        self.audit = Auditor(self.db)
        self.mailer = DevMailbox(self.db, enabled=cfg.dev_mailbox, quiet=cfg.quiet)
        if not cfg.dev_mailbox_key:
            cfg.dev_mailbox_key = sec.new_token(18)  # printed only to the local server console
        self.auth = AuthService(cfg, self.db, self.mailer, self.notifier, self.audit)
        self.gov = Governance(cfg, self.db, self.auth, self.mailer, self.notifier, self.audit)
        self.corpus = CorpusService(cfg, self.db, self.audit)
        self.ws = WorkspaceService(cfg, self.db, self.corpus)
        self.search = SearchService(self.corpus, self.ws)
        self.owner_state = self.auth.reconcile_owner()
        self.router = Router()
        self._routes()

    # ------------------------------------------------------------------ core
    def handle(self, req: Request) -> Response:
        ctx = Ctx(req=req, params={})
        try:
            route, params = self.router.match(req.method, req.path)
            ctx.params = params
            session, user = self.auth.resolve(req.cookies.get(SESSION_COOKIE))
            ctx.session, ctx.user = session, user
            if route.csrf:
                self._check_csrf(req)
            if route.auth:
                if not user:
                    raise HttpError(401, "unauthenticated", "Sign in to continue.")
                if not has_role(user, route.auth):
                    raise forbidden()
            resp = route.handler(ctx)
            if not isinstance(resp, Response):
                resp = json_response(resp if resp is not None else {"ok": True})
        except HttpError as err:
            resp = error_response(err)
            if err.status == 401 and req.cookies.get(SESSION_COOKIE) and not ctx.user:
                resp.clear_cookie(SESSION_COOKIE, secure=self.cfg.secure_cookies)
        except Exception as exc:  # never leak internals
            print(f"[virelix] unhandled error on {req.method} {req.path}: {exc!r}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            resp = error_response(HttpError(500, "server_error", "Something went wrong on our side. Please try again."))
        for name, value, kwargs in ctx.cookies:
            resp.set_cookie(name, value, secure=self.cfg.secure_cookies, **kwargs)
        if CSRF_COOKIE not in req.cookies and not any(c[0] == CSRF_COOKIE for c in ctx.cookies):
            resp.set_cookie(CSRF_COOKIE, sec.new_token(24), http_only=False, secure=self.cfg.secure_cookies)
        return resp

    def _check_csrf(self, req: Request) -> None:
        origin = req.headers.get("origin")
        host = req.headers.get("host", "")
        if origin and origin != "null":
            if urlsplit(origin).netloc != host:
                raise HttpError(403, "bad_origin", "Cross-origin request rejected.")
        cookie = req.cookies.get(CSRF_COOKIE, "")
        header = req.headers.get(CSRF_HEADER, "")
        if not cookie or not header or not hmac.compare_digest(cookie, header):
            raise HttpError(403, "csrf_failed", "Your session security token is missing or stale. Reload the page and try again.")

    # ---------------------------------------------------------------- routes
    def _routes(self) -> None:
        r = self.router.add
        # public
        r("GET", "/api/health", self.h_health, auth=None)
        r("GET", "/api/auth/session", self.h_session, auth=None)
        r("POST", "/api/auth/register", self.h_register, auth=None)
        r("POST", "/api/auth/login", self.h_login, auth=None)
        r("POST", "/api/auth/verify-email", self.h_verify, auth=None)
        r("POST", "/api/auth/resend-verification", self.h_resend, auth=None)
        r("POST", "/api/auth/forgot-password", self.h_forgot, auth=None)
        r("POST", "/api/auth/reset-password", self.h_reset, auth=None)
        r("POST", "/api/auth/reset-password/check", self.h_reset_check, auth=None)
        r("GET", "/api/invitations/peek", self.h_invite_peek, auth=None)
        r("GET", "/api/dev/mailbox", self.h_mailbox, auth=None)
        r("DELETE", "/api/dev/mailbox", self.h_mailbox_clear, auth=None)
        # account
        r("POST", "/api/auth/logout", self.h_logout)
        r("GET", "/api/me", self.h_me)
        r("PATCH", "/api/me", self.h_me_update)
        r("POST", "/api/me/password", self.h_me_password)
        r("PATCH", "/api/me/prefs", self.h_me_prefs)
        r("GET", "/api/me/sessions", self.h_sessions)
        r("DELETE", "/api/me/sessions/{sid}", self.h_session_revoke)
        r("POST", "/api/me/sessions/revoke-others", self.h_sessions_revoke_others)
        r("GET", "/api/notifications", self.h_notifications)
        r("POST", "/api/notifications/read", self.h_notifications_read)
        r("DELETE", "/api/notifications", self.h_notifications_clear)
        # search & documents
        r("GET", "/api/search", self.h_search)
        r("GET", "/api/search/overview", self.h_overview)
        r("GET", "/api/search/facets", self.h_facets)
        r("GET", "/api/documents/{doc_id}", self.h_document)
        # workspace
        r("GET", "/api/attachments", self.h_att_list)
        r("POST", "/api/attachments", self.h_att_add)
        r("DELETE", "/api/attachments", self.h_att_clear)
        r("GET", "/api/attachments/{att_id}", self.h_att_get)
        r("DELETE", "/api/attachments/{att_id}", self.h_att_remove)
        r("GET", "/api/history", self.h_history)
        r("DELETE", "/api/history", self.h_history_clear)
        r("DELETE", "/api/history/{hid}", self.h_history_delete)
        r("GET", "/api/saved", self.h_saved)
        r("POST", "/api/saved", self.h_save)
        r("POST", "/api/saved/overview", self.h_save_overview)
        r("DELETE", "/api/saved/by-doc/{doc_id}", self.h_unsave_doc)
        r("DELETE", "/api/saved/{sid}", self.h_unsave)
        r("GET", "/api/collections", self.h_cols)
        r("POST", "/api/collections", self.h_col_create)
        r("GET", "/api/collections/{cid}", self.h_col_get)
        r("PATCH", "/api/collections/{cid}", self.h_col_rename)
        r("DELETE", "/api/collections/{cid}", self.h_col_delete)
        r("POST", "/api/collections/{cid}/items", self.h_col_add)
        r("DELETE", "/api/collections/{cid}/items/{doc_id}", self.h_col_remove)
        r("POST", "/api/invitations/accept", self.h_invite_accept)
        # admin
        r("GET", "/api/admin/overview", self.h_admin_overview, auth="admin")
        r("GET", "/api/admin/documents", self.h_admin_docs, auth="admin")
        r("POST", "/api/admin/documents", self.h_admin_upload, auth="admin")
        r("POST", "/api/admin/documents/remove", self.h_admin_remove, auth="admin")
        r("GET", "/api/admin/documents/{doc_id}", self.h_admin_doc, auth="admin")
        r("POST", "/api/admin/corpus/reload", self.h_admin_reload, auth="admin")
        r("GET", "/api/admin/index", self.h_index, auth="admin")
        r("POST", "/api/admin/index/rebuild", self.h_index_rebuild, auth="admin")
        r("GET", "/api/admin/index/vocabulary", self.h_index_vocab, auth="admin")
        r("GET", "/api/admin/index/postings", self.h_index_postings, auth="admin")
        r("GET", "/api/admin/index/documents", self.h_index_docs, auth="admin")
        r("GET", "/api/admin/users", self.h_users, auth="admin")
        r("GET", "/api/admin/users/{uid}", self.h_user, auth="admin")
        r("POST", "/api/admin/users/{uid}/suspend", self.h_user_suspend, auth="admin")
        r("POST", "/api/admin/users/{uid}/reactivate", self.h_user_reactivate, auth="admin")
        r("GET", "/api/admin/system", self.h_system, auth="admin")
        # owner
        r("GET", "/api/owner/invitations", self.h_invites, auth="owner")
        r("POST", "/api/owner/invitations", self.h_invite, auth="owner")
        r("POST", "/api/owner/invitations/{iid}/resend", self.h_invite_resend, auth="owner")
        r("POST", "/api/owner/invitations/{iid}/revoke", self.h_invite_revoke, auth="owner")
        r("GET", "/api/owner/admins", self.h_admins, auth="owner")
        r("POST", "/api/owner/admins/{uid}/remove", self.h_admin_demote, auth="owner")
        r("GET", "/api/owner/platform", self.h_platform, auth="owner")
        r("GET", "/api/owner/audit", self.h_audit, auth="owner")

    # --------------------------------------------------------------- helpers
    def _me(self, ctx: Ctx) -> dict:
        user = public_user(ctx.user, include_private=True)
        user["prefs"] = {**DEFAULT_PREFS, **(ctx.user.get("prefs") or {})}
        user["unread_notifications"] = sum(1 for n in self.notifier.list(ctx.uid) if not n["read"])
        return user

    def _set_session_cookie(self, ctx: Ctx, token: str, remember: bool) -> None:
        max_age = self.cfg.remember_days * 86400 if remember else None
        ctx.cookies.append((SESSION_COOKIE, token, {"max_age": max_age}))
        ctx.cookies.append((CSRF_COOKIE, sec.new_token(24), {"http_only": False}))

    @staticmethod
    def _raw_upload(ctx: Ctx) -> tuple[str, bytes]:
        name = unquote(ctx.req.headers.get("x-filename", "")).strip()
        if not name:
            raise bad_request("Missing file name.")
        ctype = ctx.req.headers.get("content-type", "")
        if not (ctype.startswith("text/plain") or ctype.startswith("application/octet-stream")):
            raise HttpError(415, "unsupported_media_type", "Upload the raw file bytes as text/plain or application/octet-stream.")
        return name, ctx.req.body

    def _dev_mailbox_allowed(self, ctx: Ctx) -> None:
        """Development-only. Requires all three: development mode, a loopback *socket* address
        (forwarded headers and Host are deliberately ignored) and the developer key printed to the
        local server console. Knowing the URL is not enough."""
        if not (self.cfg.is_development and self.cfg.dev_mailbox):
            raise HttpError(404, "not_found", "No such API endpoint.")
        if ctx.req.client_addr not in LOOPBACK:
            raise forbidden("The development mailbox is only available from this machine.")
        key = ctx.req.headers.get("x-dev-mailbox-key", "")
        if not key or not hmac.compare_digest(key.encode(), self.cfg.dev_mailbox_key.encode()):
            raise HttpError(403, "dev_key_required", "Enter the developer key printed in the server console.")

    # ---------------------------------------------------------------- public
    def h_health(self, ctx):
        return {"status": "ok", "version": __version__, "time": iso(now())}

    def h_session(self, ctx):
        if not ctx.user:
            return {"authenticated": False, "dev_mailbox": self.cfg.is_development and self.cfg.dev_mailbox}
        return {"authenticated": True, "user": self._me(ctx), "dev_mailbox": self.cfg.is_development and self.cfg.dev_mailbox}

    def h_register(self, ctx):
        user = self.auth.register(ctx.req.json(), ctx.req.client_addr)
        return json_response({"ok": True, "email": user["email"], "verification": self._delivery_note()}, 201)

    def _delivery_note(self) -> dict:
        if self.cfg.dev_mailbox:
            return {"provider": "development-mailbox", "delivered": False,
                    "message": "Email isn't delivered by this installation. The link is printed in the server console "
                               "for the server operator; nothing was sent to a real inbox."}
        return {"provider": None, "delivered": False,
                "message": "No email provider is configured, so the link could not be sent."}

    def h_login(self, ctx):
        token, user, remember = self.auth.login(ctx.req.json(), ctx.req.client_addr, ctx.req.headers.get("user-agent", ""))
        self._set_session_cookie(ctx, token, remember)
        ctx.user = user
        return {"ok": True, "user": self._me(ctx)}

    def h_verify(self, ctx):
        user = self.auth.verify_email(ctx.req.json().get("token"))
        return {"ok": True, "email": user["email"], "role": user["role"]}

    def h_resend(self, ctx):
        self.auth.resend_verification(ctx.req.json().get("email"), ctx.req.client_addr)
        return {"ok": True, "message": "If that account is waiting for verification, a new link has been issued.",
                "verification": self._delivery_note()}

    def h_forgot(self, ctx):
        self.auth.forgot_password(ctx.req.json().get("email"), ctx.req.client_addr)
        return {"ok": True, "message": "If an active account uses that email, a reset link has been issued.",
                "delivery": self._delivery_note()}

    def h_reset_check(self, ctx):
        rec = self.auth.peek_token("reset", ctx.req.json().get("token"))
        return {"ok": True, "email": sec.mask_email(rec["email"]), "expires_at": iso(rec["expires_at"])}

    def h_reset(self, ctx):
        self.auth.reset_password(ctx.req.json())
        resp = json_response({"ok": True})
        resp.clear_cookie(SESSION_COOKIE, secure=self.cfg.secure_cookies)
        return resp

    def h_invite_peek(self, ctx):
        info = self.gov.peek(ctx.req.query.get("token", ""))
        if not ctx.user or ctx.user["email"] != info["email"]:
            info["email"] = sec.mask_email(info["email"])
        return info

    def h_mailbox(self, ctx):
        self._dev_mailbox_allowed(ctx)
        return {"provider": "development-mailbox", "delivers_to_real_inboxes": False, "messages": self.mailer.list()}

    def h_mailbox_clear(self, ctx):
        self._dev_mailbox_allowed(ctx)
        self.mailer.clear()
        return {"ok": True}

    # --------------------------------------------------------------- account
    def h_logout(self, ctx):
        self.auth.logout(ctx.session["token_hash"])
        resp = json_response({"ok": True})
        resp.clear_cookie(SESSION_COOKIE, secure=self.cfg.secure_cookies)
        return resp

    def h_me(self, ctx):
        return self._me(ctx)

    def h_me_update(self, ctx):
        ctx.user = self.auth.update_profile(ctx.user, ctx.req.json())
        return self._me(ctx)

    def h_me_password(self, ctx):
        self.auth.change_password(ctx.user, ctx.req.json(), ctx.session["token_hash"])
        return {"ok": True}

    def h_me_prefs(self, ctx):
        prefs = self.ws.update_prefs(ctx.user, ctx.req.json())
        return {"prefs": prefs}

    def h_sessions(self, ctx):
        return {"sessions": self.auth.list_sessions(ctx.uid, ctx.session["token_hash"])}

    def h_session_revoke(self, ctx):
        self.auth.revoke_session_by_id(ctx.uid, ctx.params["sid"], ctx.session["token_hash"])
        return {"ok": True}

    def h_sessions_revoke_others(self, ctx):
        n = self.auth.revoke_sessions(ctx.uid, keep=ctx.session["token_hash"])
        return {"ok": True, "revoked": n}

    def h_notifications(self, ctx):
        items = self.notifier.list(ctx.uid)
        return {"items": items, "unread": sum(1 for n in items if not n["read"]), "delivery": "in_app_only"}

    def h_notifications_read(self, ctx):
        ids = ctx.req.json().get("ids")
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids)):
            raise bad_request("ids must be a list of notification ids.")
        return {"ok": True, "marked": self.notifier.mark_read(ctx.uid, ids)}

    def h_notifications_clear(self, ctx):
        self.notifier.clear(ctx.uid)
        return {"ok": True}

    # ------------------------------------------------------- search/document
    @staticmethod
    def _list_param(value: str | None, allowed: set | None = None) -> list[str]:
        items = [v.strip() for v in (value or "").split(",") if v.strip()]
        if allowed is not None and not set(items) <= allowed:
            raise bad_request("Unknown filter value.")
        return items

    def h_search(self, ctx):
        q = ctx.req.query
        prefs = {**DEFAULT_PREFS, **(ctx.user.get("prefs") or {})}
        sources = self._list_param(q.get("sources"), {"corpus", "attachments"}) or prefs["default_sources"]
        categories = self._list_param(q.get("categories"))
        mode = q.get("mode") or prefs["default_mode"]
        sort = q.get("sort") or "relevance"
        per_page = ctx.req.int_query("per_page", prefs["per_page"], 5, 50)
        page = ctx.req.int_query("page", 1, 1, 10000)
        try:
            result = self.search.search(ctx.uid, q.get("q", ""), mode=mode, sources=sources, categories=categories,
                                        sort=sort, page=page, per_page=per_page)
        except QueryError as exc:
            raise bad_request(str(exc), "invalid_query")
        saved = self.ws.saved_doc_ids(ctx.uid)
        for item in result["results"]:
            item["saved"] = item["source"] == "corpus" and item["doc_id"] in saved
        result["sources"] = sources
        result["categories"] = categories
        if q.get("record") == "1":
            self.ws.record_search(ctx.user, {"query": result["query"], "mode": result["mode"], "sort": result["sort"], "sources": sources,
                                             "categories": categories, "category_tab": (q.get("tab") or "all")[:20],
                                             "result_count": result["total"]})
        return result

    def h_overview(self, ctx):
        q = ctx.req.query
        try:
            return self.search.overview(q.get("q", ""), q.get("mode") or "any")
        except QueryError as exc:
            raise bad_request(str(exc), "invalid_query")

    def h_facets(self, ctx):
        return {"categories": self.corpus.categories(),
                "sources": [{"id": "corpus", "label": "Shared corpus", "count": self.corpus.document_count()},
                            {"id": "attachments", "label": "My attachments", "count": len(self.ws.list_attachments(ctx.uid))}],
                "document_types": [{"id": "txt", "label": "Plain text (.txt)", "supported": True},
                                   {"id": "pdf", "label": "PDF", "supported": False},
                                   {"id": "docx", "label": "Word (.docx)", "supported": False}]}

    def h_document(self, ctx):
        doc = self.corpus.get(ctx.params["doc_id"])
        if not doc:
            raise HttpError(404, "document_not_found", "This document isn't in the shared corpus. It may have been removed.")
        saved = doc.doc_id in self.ws.saved_doc_ids(ctx.uid)
        return {"doc_id": doc.doc_id, "title": doc.title, "filename": doc.filename, "metadata": doc.metadata,
                "text": doc.text, "size_bytes": doc.size_bytes, "modified": doc.modified, "encoding": doc.encoding,
                "warnings": doc.warnings, "word_count": len(doc.text.split()), "source": "corpus", "saved": saved,
                "collections": self.ws.collections_containing(ctx.uid, doc.doc_id)}

    # ------------------------------------------------------------- workspace
    def h_att_list(self, ctx):
        return {"items": self.ws.list_attachments(ctx.uid), "limits": {
            "max_bytes": self.cfg.max_attachment_bytes, "max_files": self.cfg.max_attachments,
            "ttl_hours": self.cfg.attachment_ttl_hours, "types": [".txt"]}}

    def h_att_add(self, ctx):
        name, raw = self._raw_upload(ctx)
        return json_response(self.ws.add_attachment(ctx.uid, name, raw), 201)

    def h_att_get(self, ctx):
        att, text = self.ws.attachment_text(ctx.uid, ctx.params["att_id"])
        return {**{k: v for k, v in att.items() if k != "expires_ts"}, "text": text, "source": "attachment"}

    def h_att_remove(self, ctx):
        self.ws.remove_attachment(ctx.uid, ctx.params["att_id"])
        return {"ok": True}

    def h_att_clear(self, ctx):
        return {"ok": True, "removed": self.ws.clear_attachments(ctx.uid)}

    def h_history(self, ctx):
        return {"items": self.ws.read(ctx.uid)["history"],
                "recording": bool((ctx.user.get("prefs") or {}).get("save_history", True))}

    def h_history_delete(self, ctx):
        self.ws.delete_history(ctx.uid, ctx.params["hid"])
        return {"ok": True}

    def h_history_clear(self, ctx):
        return {"ok": True, "removed": self.ws.clear_history(ctx.uid)}

    def h_saved(self, ctx):
        return {"items": self.ws.list_saved(ctx.uid)}

    def h_save(self, ctx):
        body = ctx.req.json()
        return json_response(self.ws.save_document(ctx.uid, body.get("doc_id"), body.get("query") or ""), 201)

    def h_save_overview(self, ctx):
        body = ctx.req.json()
        query, mode = body.get("query") or "", body.get("mode") or "any"
        try:
            result = self.search.overview(query, mode)      # recomputed server-side; client passages ignored
        except QueryError as exc:
            raise bad_request(str(exc))
        return json_response(self.ws.save_overview(ctx.uid, query, result["mode"], result), 201)

    def h_unsave(self, ctx):
        self.ws.unsave(ctx.uid, saved_id=ctx.params["sid"])
        return {"ok": True}

    def h_unsave_doc(self, ctx):
        self.ws.unsave(ctx.uid, doc_id=ctx.params["doc_id"])
        return {"ok": True}

    def h_cols(self, ctx):
        return {"items": self.ws.list_collections(ctx.uid)}

    def h_col_create(self, ctx):
        return json_response(self.ws.create_collection(ctx.uid, ctx.req.json()), 201)

    def h_col_get(self, ctx):
        return self.ws.get_collection(ctx.uid, ctx.params["cid"])

    def h_col_rename(self, ctx):
        return self.ws.rename_collection(ctx.uid, ctx.params["cid"], ctx.req.json())

    def h_col_delete(self, ctx):
        self.ws.delete_collection(ctx.uid, ctx.params["cid"])
        return {"ok": True}

    def h_col_add(self, ctx):
        return json_response(self.ws.add_to_collection(ctx.uid, ctx.params["cid"], ctx.req.json().get("doc_id")), 201)

    def h_col_remove(self, ctx):
        self.ws.remove_from_collection(ctx.uid, ctx.params["cid"], ctx.params["doc_id"])
        return {"ok": True}

    def h_invite_accept(self, ctx):
        user = self.gov.accept(ctx.user, ctx.req.json().get("token"))
        ctx.user = user
        return {"ok": True, "user": self._me(ctx)}

    # ----------------------------------------------------------------- admin
    def h_admin_overview(self, ctx):
        users = self.db.users.read().values()
        by_role = {"user": 0, "admin": 0, "owner": 0}
        by_status = {"active": 0, "suspended": 0, "unverified": 0}
        for u in users:
            by_role[u["role"]] += 1
            by_status[u["status"]] += 1
            if not u.get("email_verified"):
                by_status["unverified"] += 1
        return {"corpus": self.corpus.overview(), "index": self.corpus.index_status(),
                "users": {"total": len(users), "by_role": by_role, "by_status": by_status}}

    def h_admin_docs(self, ctx):
        q = ctx.req.query
        return {"items": self.corpus.list_documents(q.get("q", ""), q.get("category", ""), q.get("sort", "title_asc")),
                "categories": self.corpus.categories(), "overview": self.corpus.overview(),
                "limits": {"max_bytes": self.cfg.max_upload_bytes, "types": [".txt"]}}

    def _notify_admins(self, actor: dict, title: str, body: str) -> None:
        for u in self.db.users.read().values():
            if u["id"] != actor["id"] and u["role"] in {"admin", "owner"} and u["status"] == "active":
                self.notifier.push(u["id"], "corpus", title, body, "/admin/documents")

    def h_admin_upload(self, ctx):
        name, raw = self._raw_upload(ctx)
        doc = self.corpus.upload(ctx.user, name, raw)
        self._notify_admins(ctx.user, "Document added to the corpus", f"{ctx.user['name']} added “{doc['title']}”.")
        return json_response(doc, 201)

    def h_admin_remove(self, ctx):
        removed = self.corpus.remove(ctx.user, ctx.req.json().get("doc_ids"))
        titles = ", ".join(f"“{r['title']}”" for r in removed[:3]) + (f" and {len(removed) - 3} more" if len(removed) > 3 else "")
        self._notify_admins(ctx.user, "Documents removed from the corpus", f"{ctx.user['name']} removed {titles}.")
        return {"ok": True, "removed": removed}

    def h_admin_doc(self, ctx):
        doc = self.corpus.get(ctx.params["doc_id"])
        if not doc:
            raise HttpError(404, "document_not_found", "Document not found.")
        return {**doc.summary(), "text": doc.text}

    def h_admin_reload(self, ctx):
        self.corpus.reload()
        self.audit.log(ctx.user, "corpus_reloaded", "corpus")
        return self.corpus.overview()

    def h_index(self, ctx):
        return self.corpus.index_status()

    def h_index_rebuild(self, ctx):
        return self.corpus.rebuild_index(ctx.user, ctx.req.json().get("remove_stopwords", False))

    def h_index_vocab(self, ctx):
        q = ctx.req.query
        return self.corpus.vocabulary(q.get("q", ""), q.get("sort", "term"), ctx.req.int_query("page", 1, 1, 100000),
                                      ctx.req.int_query("per_page", 50, 10, 200))

    def h_index_postings(self, ctx):
        return self.corpus.postings(ctx.req.query.get("term", ""))

    def h_index_docs(self, ctx):
        return {"items": self.corpus.index_documents()}

    def h_users(self, ctx):
        q = ctx.req.query
        role = q.get("role", "")
        status = q.get("status", "")
        if role and role not in {"user", "admin", "owner"}:
            raise bad_request("Unknown role filter.")
        if status and status not in {"active", "suspended", "unverified"}:
            raise bad_request("Unknown status filter.")
        return {"items": self.gov.list_users(ctx.user, q.get("q", ""), role, status)}

    def h_user(self, ctx):
        return self.gov.user_detail(ctx.user, ctx.params["uid"])

    def h_user_suspend(self, ctx):
        return self.gov.set_status(ctx.user, ctx.params["uid"], "suspended", ctx.req.json().get("reason", ""))

    def h_user_reactivate(self, ctx):
        return self.gov.set_status(ctx.user, ctx.params["uid"], "active")

    def h_system(self, ctx):
        def writable(path):
            try:
                path.mkdir(parents=True, exist_ok=True)
                probe = path / ".write-probe"
                probe.write_text("ok", encoding="utf-8")
                probe.unlink()
                return True
            except OSError:
                return False
        t0 = time.perf_counter()
        self.db.users.read()
        read_ms = round((time.perf_counter() - t0) * 1000, 2)
        sessions = self.db.sessions.read().values()
        return {
            "checked_at": iso(now()),
            "process": {"pid": os.getpid(), "started_at": iso(self.started_at),
                        "running_seconds": int(now() - self.started_at), "python": platform.python_version(),
                        "platform": platform.platform(terse=True), "version": __version__, "environment": self.cfg.env},
            "storage": {"data_dir_writable": writable(self.cfg.data_dir), "corpus_dir_exists": self.cfg.corpus_dir.is_dir(),
                        "user_store_read_ms": read_ms,
                        "index_file_bytes": self.corpus.index_path.stat().st_size if self.corpus.index_path.is_file() else None},
            "corpus": self.corpus.overview()["counts"],
            "index": {"state": self.corpus.index_status()["state"]},
            "sessions_active": sum(1 for s in sessions if s["expires_at"] > now()),
            "email": {"provider": "development-mailbox" if self.cfg.dev_mailbox else None, "delivers": False},
            "governance": {"owner_configured": bool(self.auth.configured_owner),
                           "owner_conflict": bool(self.auth.owner_state()["conflict"])},
        }

    # ----------------------------------------------------------------- owner
    def h_invites(self, ctx):
        return {"items": self.gov.list_invitations(ctx.user), "ttl_hours": self.cfg.invite_hours}

    def h_invite(self, ctx):
        inv = self.gov.invite(ctx.user, ctx.req.json().get("email"))
        return json_response({"invitation": inv, "delivery": self._delivery_note()}, 201)

    def h_invite_resend(self, ctx):
        return {"invitation": self.gov.resend(ctx.user, ctx.params["iid"]), "delivery": self._delivery_note()}

    def h_invite_revoke(self, ctx):
        return {"invitation": self.gov.revoke(ctx.user, ctx.params["iid"])}

    def h_admins(self, ctx):
        return {"items": self.gov.list_admins(ctx.user)}

    def h_admin_demote(self, ctx):
        return {"user": self.gov.remove_admin(ctx.user, ctx.params["uid"])}

    def h_platform(self, ctx):
        users = list(self.db.users.read().values())
        return {
            "product": "Virelix", "version": __version__,
            "environment": self.cfg.env,
            "owner": {"configured": bool(self.auth.configured_owner),
                      "email_masked": sec.mask_email(self.auth.configured_owner) if self.auth.configured_owner else None,
                      "source": "OWNER_EMAIL environment variable", "account": public_user(ctx.user),
                      "state": self.auth.owner_state()},
            "counts": {"users": len(users), "admins": sum(1 for u in users if u["role"] == "admin"),
                       "suspended": sum(1 for u in users if u["status"] == "suspended")},
            "security": {
                "password_hashing": "scrypt (n=16384, r=8, p=1)",
                "session_cookie": {"http_only": True, "same_site": "Strict", "secure": self.cfg.secure_cookies},
                "csrf": "Double-submit token + Origin check on every state-changing request",
                "secret_key": "Not used yet: session, CSRF, verification, reset and invitation tokens are random and stored only as SHA-256 hashes",
                "login_throttle": "5 failures / 15 min per email + address",
                "email_delivery": "development mailbox (not delivered)" if self.cfg.dev_mailbox else "not configured",
            },
            "capabilities": [
                {"name": "Ranked search", "available": True,
                 "detail": "Inverted-index retrieval ranked by term frequency (sum of query-term occurrences)."},
                {"name": "Extractive overview", "available": True, "detail": "Quotes sentences from matching documents with references."},
                {"name": "Document index", "available": True, "detail": "Built automatically, rebuilt on every corpus change, inspectable by administrators."},
                {"name": "Search analytics", "available": False, "detail": "No aggregate query data is collected."},
                {"name": "Search evaluation", "available": False, "detail": "No relevance judgments exist."},
                {"name": "Email delivery", "available": False,
                 "detail": "Development mailbox only (local server console)." if self.cfg.dev_mailbox else "No provider configured."},
                {"name": "AI Answers and Research Mode", "available": False, "detail": "No generative model is connected."},
            ],
        }

    def h_audit(self, ctx):
        return {"items": self.db.read_audit(ctx.req.int_query("limit", 200, 1, 1000))}
