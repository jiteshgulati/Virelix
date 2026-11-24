"""Regression tests for configuration, Owner governance, mailbox exposure, live privilege changes,
cross-account isolation, credential exposure, startup and product terminology."""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

from backend.app import App
from backend.config import ROOT, Config, from_env, load_dotenv
from backend.server import create_server
from backend.web import Request
from tests.backend.helpers import DEV_KEY, OWNER_EMAIL, PASSWORD, Client, ServerTestCase


def _cfg(tmp: Path, owner: str, **kw) -> Config:
    corpus = tmp / "corpus"
    if not corpus.exists():
        corpus.mkdir()
        shutil.copy(ROOT / "corpus" / "01-inverted-index-fundamentals.txt", corpus)
    cfg = Config(host="127.0.0.1", port=0, env="development", owner_email=owner, corpus_dir=corpus,
                 data_dir=tmp / "data", frontend_dir=ROOT / "frontend", quiet=True,
                 register_rate_limit=10_000, dev_mailbox_key=DEV_KEY)
    for k, v in kw.items():
        setattr(cfg, k, v)
    if cfg.env != "development":
        cfg.dev_mailbox = False
    return cfg


class LiveServer:
    """A server for one configuration; several can run over the same data folder in sequence."""

    def __init__(self, cfg: Config):
        self.server, self.app = create_server(cfg)
        cfg.port = self.server.server_address[1]
        self.port = cfg.port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def client(self) -> Client:
        return Client(self.port)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def signup(self, email, name="Test Person", verify=True) -> Client:
        c = self.client()
        s, d, _ = c.post("/api/auth/register", {"name": name, "email": email, "password": PASSWORD,
                                                "confirm_password": PASSWORD, "accept_terms": True})
        assert s == 201, d
        if verify:
            token = next(m["link"] for m in self.app.mailer.list() if m["to"] == email.strip().lower() and m["kind"] == "verify").split("token=")[1]
            assert c.post("/api/auth/verify-email", {"token": token})[0] == 200
            assert c.post("/api/auth/login", {"email": email, "password": PASSWORD})[0] == 200
        return c


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = {k: os.environ.get(k) for k in ("VT_A", "VT_B", "VT_C")}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_dotenv_parsing_and_precedence(self):
        os.environ.pop("VT_A", None)
        os.environ.pop("VT_C", None)
        os.environ["VT_B"] = "from-environment"
        (self.tmp / ".env").write_text('# comment\nVT_A="quoted value"\nVT_B=from-file\n\nnot a pair\nVT_C= spaced \n', encoding="utf-8")
        load_dotenv(self.tmp / ".env")
        self.assertEqual(os.environ["VT_A"], "quoted value")
        self.assertEqual(os.environ["VT_B"], "from-environment")  # real environment wins
        self.assertEqual(os.environ["VT_C"], "spaced")

    def test_missing_dotenv_is_harmless(self):
        load_dotenv(self.tmp / "absent.env")

    def test_non_development_disables_mailbox_and_defaults_are_safe(self):
        saved = {k: os.environ.get(k) for k in ("VIRELIX_ENV", "VIRELIX_HOST")}
        try:
            os.environ["VIRELIX_ENV"] = "production"
            os.environ.pop("VIRELIX_HOST", None)
            cfg = from_env()
            self.assertFalse(cfg.dev_mailbox)
            self.assertFalse(cfg.is_development)
        finally:
            for k, v in saved.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        self.assertEqual(Config().host, "127.0.0.1")

    def test_gitignore_protects_env_and_data(self):
        text = (ROOT / ".gitignore").read_text()
        self.assertIn(".env", text)
        self.assertIn("/data/*", text)
        self.assertNotIn("jiteshgulati", (ROOT / ".env.example").read_text())


class OwnerGovernanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="virelix-gov-"))
        self.servers = []

    def tearDown(self):
        for s in self.servers:
            s.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def start(self, owner: str) -> LiveServer:
        if self.servers:
            self.servers[-1].stop()
            self.servers.pop()
        s = LiveServer(_cfg(self.tmp, owner))
        self.servers.append(s)
        return s

    def role(self, srv, email):
        return srv.app.auth.find_by_email(email)["role"]

    def test_owner_email_is_normalised(self):
        srv = self.start("  Boss@Example.TEST ")
        srv.signup("boss@example.test")
        self.assertEqual(self.role(srv, "boss@example.test"), "owner")

    def test_unverified_owner_email_gets_nothing(self):
        srv = self.start("boss@example.test")
        srv.signup("boss@example.test", verify=False)
        self.assertEqual(self.role(srv, "boss@example.test"), "user")
        self.assertFalse(srv.app.auth.owner_state()["owner_established"])

    def test_missing_and_invalid_configuration(self):
        srv = self.start("")
        srv.signup("first@example.test")  # the first account is not special
        self.assertEqual(self.role(srv, "first@example.test"), "user")
        srv = self.start("not-an-email")
        self.assertIn("not a valid email", srv.app.auth.owner_state()["config_error"])
        srv.signup("not-an-email@example.test")
        self.assertEqual(self.role(srv, "not-an-email@example.test"), "user")

    def test_existing_owner_survives_restart_and_is_granted_on_restart_if_verified_earlier(self):
        srv = self.start("")
        srv.signup("boss@example.test")              # verified while OWNER_EMAIL was unset
        self.assertEqual(self.role(srv, "boss@example.test"), "user")
        srv = self.start("boss@example.test")         # configured later: granted at start-up
        self.assertEqual(self.role(srv, "boss@example.test"), "owner")
        srv = self.start("boss@example.test")         # restart: unchanged
        self.assertEqual(self.role(srv, "boss@example.test"), "owner")

    def test_changing_owner_email_never_transfers_ownership(self):
        srv = self.start("boss@example.test")
        boss = srv.signup("boss@example.test")
        srv.signup("next@example.test")
        srv = self.start("next@example.test")          # configuration changed after ownership was established
        state = srv.app.auth.owner_state()
        self.assertEqual(state["conflict"], "configuration_mismatch")
        self.assertEqual(self.role(srv, "boss@example.test"), "owner")   # data preserved
        self.assertEqual(self.role(srv, "next@example.test"), "user")    # no second Owner, no transfer
        boss = srv.client()
        boss.post("/api/auth/login", {"email": "boss@example.test", "password": PASSWORD})
        self.assertEqual(boss.get("/api/me")[1]["role"], "admin")       # governance locked, admin kept
        self.assertEqual(boss.get("/api/owner/invitations")[0], 403)
        self.assertEqual(boss.get("/api/admin/overview")[0], 200)
        nxt = srv.client()
        nxt.post("/api/auth/login", {"email": "next@example.test", "password": PASSWORD})
        self.assertEqual(nxt.get("/api/owner/platform")[0], 403)
        srv = self.start("boss@example.test")          # restoring the configuration resolves it
        self.assertIsNone(srv.app.auth.owner_state()["conflict"])

    def test_recovery_script_release_is_explicit(self):
        srv = self.start("boss@example.test")
        srv.signup("boss@example.test")
        srv.signup("next@example.test")
        srv.stop(); self.servers.clear()
        env = {**os.environ, "OWNER_EMAIL": "next@example.test", "VIRELIX_DATA_DIR": str(self.tmp / "data"),
               "VIRELIX_CORPUS_DIR": str(self.tmp / "corpus")}
        script = [sys.executable, str(ROOT / "scripts" / "owner_recovery.py")]
        out = subprocess.run(script + ["release", "--email", "boss@example.test"], env=env, capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)  # --confirm required
        out = subprocess.run(script + ["release", "--email", "boss@example.test", "--confirm"], env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        srv = self.start("next@example.test")
        self.assertEqual(self.role(srv, "next@example.test"), "owner")
        self.assertEqual(self.role(srv, "boss@example.test"), "user")

    def test_concurrent_registration_and_verification(self):
        srv = self.start("boss@example.test")
        results = []

        def reg():
            c = srv.client()
            c.get("/api/auth/session")
            results.append(c.post("/api/auth/register", {"name": "Boss", "email": "boss@example.test", "password": PASSWORD,
                                                         "confirm_password": PASSWORD, "accept_terms": True})[0])
        threads = [threading.Thread(target=reg) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(results).count(201), 1)
        token = next(m["link"] for m in srv.app.mailer.list() if m["kind"] == "verify").split("token=")[1]
        outcomes = []

        def ver():
            c = srv.client()
            c.get("/api/auth/session")
            outcomes.append(c.post("/api/auth/verify-email", {"token": token})[0])
        threads = [threading.Thread(target=ver) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(outcomes.count(200), 1)
        owners = [u for u in srv.app.db.users.read().values() if u["role"] == "owner"]
        self.assertEqual(len(owners), 1)

    def test_owner_address_cannot_be_invited(self):
        srv = self.start("boss@example.test")
        boss = srv.signup("boss@example.test")
        s, d, _ = boss.post("/api/owner/invitations", {"email": "BOSS@example.test"})
        self.assertEqual(s, 400)


class MailboxExposureTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def _call(self, addr, headers):
        hdrs = {"Host": f"127.0.0.1:{self.port}", **headers}
        return self.app.handle(Request.build("GET", "/api/dev/mailbox", hdrs, b"", addr))

    def test_network_clients_and_forged_headers_are_refused(self):
        self.assertEqual(self._call("192.168.1.20", {"X-Dev-Mailbox-Key": DEV_KEY}).status, 403)
        forged = {"X-Dev-Mailbox-Key": DEV_KEY, "X-Forwarded-For": "127.0.0.1", "X-Real-IP": "127.0.0.1", "Host": "localhost"}
        self.assertEqual(self._call("10.0.0.7", forged).status, 403)
        self.assertEqual(self._call("127.0.0.1", {}).status, 403)
        self.assertEqual(self._call("127.0.0.1", {"X-Dev-Mailbox-Key": DEV_KEY}).status, 200)

    def test_disabled_outside_development(self):
        app = App(_cfg(Path(tempfile.mkdtemp()), "", env="production"))
        resp = app.handle(Request.build("GET", "/api/dev/mailbox", {"X-Dev-Mailbox-Key": DEV_KEY}, b"", "127.0.0.1"))
        self.assertEqual(resp.status, 404)
        self.assertFalse(app.mailer.enabled)

    def test_tokens_never_appear_in_public_or_authenticated_responses(self):
        c = self.client()
        self.register(c, "leak@virelix.test")
        token = self.token_from("leak@virelix.test", "verify")
        for path in ["/api/auth/session", "/api/health"]:
            self.assertNotIn(token, json.dumps(c.get(path)[1]))
        c.post("/api/auth/verify-email", {"token": token})
        c.post("/api/auth/login", {"email": "leak@virelix.test", "password": PASSWORD})
        for path in ["/api/me", "/api/notifications", "/api/me/sessions"]:
            body = json.dumps(c.get(path)[1])
            self.assertNotIn(token, body)
            self.assertNotIn(c.cookies["vx_session"], body)


class LivePrivilegeAndIsolationTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt", "07-hash-tables.txt"]

    def test_admin_removal_takes_effect_in_the_active_session(self):
        admin = self.make_admin("live-admin@virelix.test")
        self.assertEqual(admin.get("/api/admin/documents")[0], 200)
        uid = admin.get("/api/me")[1]["id"]
        self.assertEqual(self.owner().post(f"/api/owner/admins/{uid}/remove")[0], 200)
        self.assertEqual(admin.get("/api/admin/documents")[0], 403)          # same cookie, no re-login
        self.assertEqual(admin.get("/api/me")[1]["role"], "user")
        self.assertEqual(admin.get("/api/collections")[0], 200)              # personal data kept

    def test_admins_and_owner_cannot_read_private_workspaces(self):
        member = self.signup("private@virelix.test")
        doc = self.app.corpus.report.documents[0].doc_id
        col = member.post("/api/collections", {"name": "Mine"})[1]
        member.post("/api/saved", {"doc_id": doc})
        member.get("/api/search?q=hash&record=1")
        att = member.upload("/api/attachments", "secret.txt", b"private words")[1]
        saved_id = member.get("/api/saved")[1]["items"][0]["id"]
        hist_id = member.get("/api/history")[1]["items"][0]["id"]
        for intruder in (self.owner(), self.make_admin("nosy-admin@virelix.test"), self.signup("nosy@virelix.test")):
            self.assertEqual(intruder.get(f"/api/collections/{col['id']}")[0], 404)
            self.assertEqual(intruder.post(f"/api/collections/{col['id']}/items", {"doc_id": doc})[0], 404)
            self.assertEqual(intruder.get(f"/api/attachments/{att['id']}")[0], 404)
            self.assertEqual(intruder.delete(f"/api/saved/{saved_id}")[0], 404)
            self.assertEqual(intruder.delete(f"/api/history/{hist_id}")[0], 404)
            self.assertNotIn("private words", json.dumps(intruder.get("/api/search?q=private&mode=any&sources=corpus,attachments")[1]))
        self.assertEqual(len(member.get("/api/saved")[1]["items"]), 1)
        self.assertEqual(len(member.get("/api/history")[1]["items"]), 1)

    def test_user_management_exposes_no_credentials(self):
        self.signup("plain-dir@virelix.test")
        owner = self.owner()
        listing = owner.get("/api/admin/users")[1]["items"]
        detail = owner.get(f"/api/admin/users/{listing[0]['id']}")[1]
        blob = json.dumps([listing, detail])
        for forbidden in ("password_hash", "scrypt$", "token", "prefs"):
            self.assertNotIn(forbidden, blob)

    def test_password_change_attempts_are_throttled(self):
        c = self.signup("throttle-pw@virelix.test")
        body = {"current_password": "Wrong-pass-123", "new_password": "Another-pass-88", "confirm_password": "Another-pass-88"}
        codes = [c.post("/api/me/password", body)[0] for _ in range(6)]
        self.assertEqual(codes[:5], [400] * 5)
        self.assertEqual(codes[5], 429)

    def test_new_accounts_default_to_light_theme(self):
        self.assertEqual(self.signup("theme@virelix.test").get("/api/me")[1]["prefs"]["theme"], "light")

    def test_unsafe_upload_names_are_neutralised(self):
        admin = self.make_admin("names-admin@virelix.test")
        status, doc, _ = admin.upload("/api/admin/documents", "<script>alert(1)</script>.txt", b"Harmless text.")
        self.assertEqual(status, 201)
        self.assertNotIn("<", doc["filename"])
        self.assertTrue((self.cfg.corpus_dir / doc["filename"]).resolve().is_relative_to(self.cfg.corpus_dir.resolve()))
        status, _, _ = admin.post("/api/admin/documents/remove", {"doc_ids": ["../../etc/passwd"]})
        self.assertEqual(status, 404)


class StartupTests(unittest.TestCase):
    def test_documented_entry_point_starts_and_serves(self):
        tmp = Path(tempfile.mkdtemp(prefix="virelix-start-"))
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        env = {**os.environ, "VIRELIX_DATA_DIR": str(tmp / "data"), "VIRELIX_PORT": str(port),
               "OWNER_EMAIL": "owner@example.test", "PYTHONUNBUFFERED": "1"}
        proc = subprocess.Popen([sys.executable, str(ROOT / "run.py")], cwd=ROOT, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for _ in range(50):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                        health = json.loads(r.read())
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                self.fail("server did not start")
            self.assertEqual(health["status"], "ok")
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/login", timeout=2) as r:
                self.assertIn(b'<script type="module" src="/assets/js/main.js">', r.read())
            self.assertTrue((tmp / "data" / "server.lock").is_file())
            # A second server on the same data folder must refuse to start.
            second = subprocess.run([sys.executable, str(ROOT / "run.py"), "--port", "0"], cwd=ROOT, env=env,
                                    capture_output=True, text=True, timeout=20)
            self.assertIn("Another Virelix server", second.stderr + second.stdout)
        finally:
            proc.terminate()
            out = proc.communicate(timeout=10)[0]
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertIn("Virelix", out)
        self.assertIn("/dev/mailbox#key=", out)


class TerminologyTests(unittest.TestCase):
    """Academic scheduling language belongs in docs/, not in the running product."""

    PATTERN = re.compile(r"\bweek\s?[0-9]|after week|PST_AD|G393|\bOJT\b|academic (project|milestone|scope)|coursework|four-week", re.I)

    def test_runtime_source_has_no_academic_schedule_language(self):
        hits = []
        for base in (ROOT / "backend", ROOT / "frontend", ROOT / "run.py"):
            files = [base] if base.is_file() else [p for p in base.rglob("*") if p.suffix in {".py", ".js", ".html", ".css"} and "vendor" not in p.parts]
            for f in files:
                for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                    if self.PATTERN.search(line):
                        hits.append(f"{f.relative_to(ROOT)}:{n}: {line.strip()[:90]}")
        self.assertEqual(hits, [], "\n".join(hits))

    def test_corpus_metadata_has_no_team_codes(self):
        for f in (ROOT / "corpus").glob("*.txt"):
            self.assertNotRegex(f.read_text(encoding="utf-8").split("---")[0], r"G393|PST_AD")


if __name__ == "__main__":
    unittest.main()
