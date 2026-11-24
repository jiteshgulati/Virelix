#!/usr/bin/env python3
"""End-to-end start-up smoke test (standard library only; Windows, Linux, macOS).

Starts ``run.py`` on a free port with a throwaway data folder and a synthetic
Owner address, then checks that it serves the interface, builds the search index,
lets a synthetic account register, verify, sign in and run a ranked search, and
refuses a second server on the same data folder. Never touches real data.

    python scripts/smoke_test.py
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY = "smoke-test-key"
EMAIL = "smoke@example.test"
PASSWORD = "Granite-Lantern-73"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, port: int):
        self.port, self.cookies = port, {}

    def call(self, method: str, path: str, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        if self.cookies:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
            h["X-CSRF-Token"] = self.cookies.get("vx_csrf", "")
        conn.request(method, path, body=data, headers=h)
        resp = conn.getresponse()
        raw = resp.read()
        for k, v in resp.getheaders():
            if k.lower() == "set-cookie":
                name, _, val = v.split(";", 1)[0].partition("=")
                self.cookies[name] = val
        conn.close()
        ctype = resp.getheader("Content-Type", "")
        return resp.status, (json.loads(raw) if "json" in ctype and raw else raw)


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if condition else 'FAIL'} {label}{(': ' + detail) if detail and not condition else ''}")
    if not condition:
        raise SystemExit(1)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="virelix-smoke-"))
    port = free_port()
    env = {**os.environ, "VIRELIX_DATA_DIR": str(tmp / "data"), "VIRELIX_PORT": str(port),
           "VIRELIX_ENV": "development", "OWNER_EMAIL": "owner@example.test",
           "VIRELIX_DEV_MAILBOX_KEY": KEY, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    print(f"Virelix smoke test (Python {sys.version.split()[0]}, {sys.platform}, port {port})")
    server = subprocess.Popen([sys.executable, str(ROOT / "run.py")], cwd=ROOT, env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    try:
        c = Client(port)
        for _ in range(100):
            try:
                status, health = c.call("GET", "/api/health")
                break
            except OSError:
                time.sleep(0.1)
        else:
            check("server started", False, "no response within 10 s")
        check("health endpoint", status == 200 and health["status"] == "ok")
        status, page = c.call("GET", "/")
        check("interface served", status == 200 and b'type="module"' in page)
        check("static assets served", c.call("GET", "/assets/vendor/bootstrap/bootstrap.min.css")[0] == 200)
        check("private data not served", c.call("GET", "/data/users.json")[0] == 404)

        c.call("GET", "/api/auth/session")
        status, reg = c.call("POST", "/api/auth/register", {"name": "Smoke Test", "email": EMAIL, "password": PASSWORD,
                                                          "confirm_password": PASSWORD, "accept_terms": True})
        check("registration", status == 201, f"{status} {reg}")
        _, box = c.call("GET", "/api/dev/mailbox", headers={"X-Dev-Mailbox-Key": KEY})
        token = next(m["link"] for m in box["messages"] if m["to"] == EMAIL).split("token=", 1)[1]
        check("email verification", c.call("POST", "/api/auth/verify-email", {"token": token})[0] == 200)
        check("sign in", c.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})[0] == 200)

        status, r = c.call("GET", "/api/search?q=inverted%20index&sources=corpus")
        check("ranked search", status == 200 and r["total"] > 0 and r["ranking"] == "term_frequency")
        scores = [x["score"] for x in r["results"]]
        check("results ordered by score", scores == sorted(scores, reverse=True), str(scores))
        top = r["results"][0]
        check("score is the sum of term frequencies", top["score"] == sum(top["term_frequencies"].values()))

        second = subprocess.run([sys.executable, str(ROOT / "run.py"), "--port", str(free_port())], cwd=ROOT, env=env,
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        check("second server on the same data folder refused", "Another Virelix server" in second.stdout + second.stderr)
        check("first server still running", c.call("GET", "/api/health")[0] == 200)
        print("Smoke test passed.")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
