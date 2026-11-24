"""HTTP server: API dispatch, whitelisted static assets and SPA fallback."""

from __future__ import annotations

import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend import __version__
from backend.app import MAX_RAW_UPLOAD, App
from backend.storage import DataDirInUse, DataDirLock
from backend.web import HttpError, Request, Response, error_response

SECURITY_HEADERS = {
    "Content-Security-Policy": ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                                "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; "
                                "form-action 'self'; frame-ancestors 'none'"),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
STATIC_TYPES = {".css", ".js", ".woff2", ".svg", ".png", ".ico", ".txt", ".webmanifest", ".json"}
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("image/svg+xml", ".svg")


def make_handler(app: App):
    frontend = app.cfg.frontend_dir.resolve()
    index_html = frontend / "index.html"

    class Handler(BaseHTTPRequestHandler):
        server_version = "Virelix"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quieter, single-line logs
            if not app.cfg.quiet:
                sys.stderr.write(f"[virelix] {self.address_string()} {fmt % args}\n")

        def _send(self, resp: Response, head_only: bool = False) -> None:
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.content_type)
            self.send_header("Content-Length", str(len(resp.body)))
            for k, v in {**SECURITY_HEADERS, **resp.headers}.items():
                self.send_header(k, v)
            for cookie in resp.cookies:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            if not head_only:
                self.wfile.write(resp.body)

        def _body(self) -> bytes:
            length = self.headers.get("Content-Length")
            if not length:
                return b""
            try:
                n = int(length)
            except ValueError:
                raise HttpError(400, "invalid_request", "Invalid Content-Length.")
            if n < 0 or n > MAX_RAW_UPLOAD:
                raise HttpError(413, "payload_too_large", "Request body is too large.")
            return self.rfile.read(n)

        def _dispatch(self, method: str) -> None:
            path = self.path.split("?", 1)[0]
            if path.startswith("/api/"):
                try:
                    body = self._body()
                except HttpError as err:
                    self.close_connection = True
                    self._send(error_response(err))
                    return
                req = Request.build(method, self.path, dict(self.headers.items()), body, self.client_address[0])
                self._send(app.handle(req), head_only=method == "HEAD")
                return
            if method not in {"GET", "HEAD"}:
                self._send(error_response(HttpError(405, "method_not_allowed", "Method not allowed.")))
                return
            self._static(path, head_only=method == "HEAD")

        def _static(self, path: str, head_only: bool) -> None:
            from urllib.parse import unquote
            rel = unquote(path).lstrip("/")
            target = None
            if rel.startswith("assets/") or rel in {"favicon.svg", "robots.txt"}:
                candidate = (frontend / rel).resolve()
                if candidate.is_relative_to(frontend) and candidate.is_file() and candidate.suffix in STATIC_TYPES:
                    target = candidate
                else:
                    self._send(Response(404, b"Not found", "text/plain; charset=utf-8"), head_only)
                    return
            else:
                if "." in rel.rsplit("/", 1)[-1]:   # unknown file request outside assets
                    self._send(Response(404, b"Not found", "text/plain; charset=utf-8"), head_only)
                    return
                target = index_html                 # client-side route
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in {"application/json", "image/svg+xml"}:
                ctype += "; charset=utf-8"
            body = target.read_bytes()
            cache = "no-cache" if target == index_html or app.cfg.is_development else "public, max-age=3600"
            self._send(Response(200, body, ctype, {"Cache-Control": cache}), head_only)

        def do_GET(self):
            self._dispatch("GET")

        def do_HEAD(self):
            self._dispatch("HEAD")

        def do_POST(self):
            self._dispatch("POST")

        def do_PATCH(self):
            self._dispatch("PATCH")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_DELETE(self):
            self._dispatch("DELETE")

    return Handler


class VirelixServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # Browsers routinely abort in-flight requests when navigating; that isn't a server fault.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


def create_server(cfg) -> tuple[VirelixServer, App]:
    app = App(cfg)
    server = VirelixServer((cfg.host, cfg.port), make_handler(app))
    return server, app


OWNER_CONFLICTS = {
    "multiple_owners": "more than one account holds the Owner role",
    "owner_without_configuration": "an Owner account exists but OWNER_EMAIL is not set",
    "configuration_mismatch": "the established Owner account doesn't match OWNER_EMAIL",
    "owner_unverified": "the Owner account isn't verified",
}


def owner_status_lines(app) -> list[str]:
    state = app.auth.owner_state()
    if state["config_error"]:
        return [f"  ! owner:  {state['config_error']}"]
    if state["conflict"]:
        return [
            f"  ! owner:  GOVERNANCE LOCKED: {OWNER_CONFLICTS[state['conflict']]}.",
            "            No privileges were changed and no data was modified. Owner-only pages are",
            "            disabled; the existing Owner keeps Admin access until this is resolved.",
            "            Fix: restore OWNER_EMAIL to the established Owner's address and restart, or",
            "            run  python scripts/owner_recovery.py status  for a deliberate, manual handover.",
        ]
    if not state["configured"]:
        return ["  ▸ owner:  OWNER_EMAIL not set; no Owner can be designated"]
    if state["owner_established"]:
        return ["  ▸ owner:  established (matches OWNER_EMAIL)"]
    if state["owner_account_registered"]:
        return ["  ▸ owner:  OWNER_EMAIL account registered; becomes Owner once its email is verified"]
    return ["  ▸ owner:  OWNER_EMAIL configured; register and verify that address to become Owner"]


def serve(cfg) -> None:
    try:
        lock = DataDirLock(Path(cfg.data_dir) / "server.lock").acquire()  # one server per data folder
    except DataDirInUse as exc:
        raise SystemExit(str(exc))
    server, app = create_server(cfg)
    host, port = server.server_address[:2]
    shown = "localhost" if host in ("127.0.0.1", "0.0.0.0", "::1") else host
    c = app.corpus.overview()["counts"]
    print(f"\n  Virelix {__version__} · {app.cfg.env}")
    print(f"  ▸ open:   http://{shown}:{port}")
    print(f"  ▸ corpus: {c['loaded']} documents loaded, {c['skipped']} skipped")
    print(f"  ▸ data:   {cfg.data_dir}")
    for line in owner_status_lines(app):
        print(line)
    if cfg.dev_mailbox:
        print("  ▸ email:  not delivered. Verification, reset and invitation links print below.")
        print(f"            Developer mailbox (this machine only): http://{shown}:{port}/dev/mailbox#key={cfg.dev_mailbox_key}")
    if host not in ("127.0.0.1", "::1", "localhost"):
        print(f"  ! bound to {host}: other devices on the network can reach this server.")
    print("  Press Ctrl+C to stop.\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopping Virelix.")
    finally:
        server.server_close()
        lock.release()
