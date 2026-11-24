"""Shared fixtures: an isolated Virelix server on a random port with temp data."""

from __future__ import annotations

import http.client
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import quote

from backend.config import ROOT, Config
from backend.server import create_server

OWNER_EMAIL = "owner@virelix.test"
DEV_KEY = "test-developer-key"
PASSWORD = "Correct-horse-42"


class Client:
    def __init__(self, port: int):
        self.port = port
        self.cookies: dict[str, str] = {}

    def request(self, method: str, path: str, body=None, *, raw: bytes | None = None, headers: dict | None = None,
                csrf: bool = True, origin: str | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = {"Host": f"127.0.0.1:{self.port}"}
        if self.cookies:
            hdrs["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        payload = None
        if raw is not None:
            payload = raw
            hdrs["Content-Type"] = "text/plain"
        elif body is not None:
            payload = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        if csrf and method not in {"GET", "HEAD"} and "vx_csrf" in self.cookies:
            hdrs["X-CSRF-Token"] = self.cookies["vx_csrf"]
        if origin:
            hdrs["Origin"] = origin
        hdrs.update(headers or {})
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        for header, value in resp.getheaders():
            if header.lower() == "set-cookie":
                pair = value.split(";", 1)[0]
                name, _, val = pair.partition("=")
                if "Max-Age=0" in value:
                    self.cookies.pop(name, None)
                else:
                    self.cookies[name] = val
        conn.close()
        ctype = resp.getheader("Content-Type", "")
        parsed = json.loads(data) if "json" in ctype and data else data
        return resp.status, parsed, resp

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        if "vx_csrf" not in self.cookies:
            self.get("/api/auth/session")
        return self.request("POST", path, body if body is not None else {}, **kw)

    def patch(self, path, body=None, **kw):
        return self.request("PATCH", path, body or {}, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)

    def upload(self, path, filename: str, data: bytes):
        if "vx_csrf" not in self.cookies:
            self.get("/api/auth/session")
        return self.request("POST", path, raw=data, headers={"X-Filename": quote(filename)})


class ServerTestCase(unittest.TestCase):
    """Starts one server per test class with a private copy of the corpus."""

    corpus_files: list[str] | None = None  # None = full sample corpus

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="virelix-test-"))
        corpus = cls.tmp / "corpus"
        corpus.mkdir()
        for f in sorted((ROOT / "corpus").glob("*.txt")):
            if cls.corpus_files is None or f.name in cls.corpus_files:
                shutil.copy(f, corpus / f.name)
        cls.cfg = Config(host="127.0.0.1", port=0, env="development", owner_email=OWNER_EMAIL,
                         secret_key="test", corpus_dir=corpus, data_dir=cls.tmp / "data",
                         frontend_dir=ROOT / "frontend", dev_mailbox=True, quiet=True, register_rate_limit=10_000, dev_mailbox_key=DEV_KEY)
        cls.server, cls.app = create_server(cls.cfg)
        cls.port = cls.server.server_address[1]
        cls.cfg.port = cls.port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def client(self) -> Client:
        return Client(self.port)

    def last_link(self, email: str, kind: str) -> str:
        for msg in self.app.mailer.list():
            if msg["to"] == email and msg["kind"] == kind:
                return msg["link"]
        raise AssertionError(f"no {kind} message for {email}")

    def token_from(self, email: str, kind: str) -> str:
        return self.last_link(email, kind).split("token=", 1)[1]

    def register(self, c: Client, email: str, name: str = "Test Person", password: str = PASSWORD, **extra):
        body = {"name": name, "email": email, "password": password, "confirm_password": password,
                "accept_terms": True, **extra}
        return c.post("/api/auth/register", body)

    def signup(self, email: str, name: str = "Test Person", password: str = PASSWORD) -> Client:
        """Register, verify and sign in. Returns an authenticated client."""
        c = self.client()
        status, data, _ = self.register(c, email, name, password)
        assert status == 201, data
        status, data, _ = c.post("/api/auth/verify-email", {"token": self.token_from(email, "verify")})
        assert status == 200, data
        status, data, _ = c.post("/api/auth/login", {"email": email, "password": password})
        assert status == 200, data
        return c

    def owner(self) -> Client:
        if not getattr(type(self), "_owner_ready", False):
            if self.app.auth.find_by_email(OWNER_EMAIL):
                c = self.client()
                status, data, _ = c.post("/api/auth/login", {"email": OWNER_EMAIL, "password": PASSWORD})
                assert status == 200, data
                type(self)._owner_client = c
            else:
                type(self)._owner_client = self.signup(OWNER_EMAIL, "Platform Owner")
            type(self)._owner_ready = True
        return type(self)._owner_client

    def make_admin(self, email: str) -> Client:
        owner = self.owner()
        c = self.signup(email, "Admin Person")
        status, data, _ = owner.post("/api/owner/invitations", {"email": email})
        assert status == 201, data
        status, data, _ = c.post("/api/invitations/accept", {"token": self.token_from(email, "invite")})
        assert status == 200, data
        return c
