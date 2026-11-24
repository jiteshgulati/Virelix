import unittest

from backend import security as sec
from tests.backend.helpers import PASSWORD, ServerTestCase


class RegistrationTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_validation_errors(self):
        c = self.client()
        status, data, _ = c.post("/api/auth/register", {"name": "", "email": "bad", "password": "short",
                                                         "confirm_password": "other", "accept_terms": False})
        self.assertEqual(status, 400)
        self.assertEqual(set(data["error"]["fields"]), {"name", "email", "password", "confirm_password", "accept_terms"})

    def test_role_input_is_ignored(self):
        c = self.client()
        status, _, _ = self.register(c, "sneaky@virelix.test", role="owner", status="active", email_verified=True)
        self.assertEqual(status, 201)
        user = self.app.auth.find_by_email("sneaky@virelix.test")
        self.assertEqual(user["role"], "user")
        self.assertFalse(user["email_verified"])

    def test_duplicate_registration(self):
        c = self.client()
        self.assertEqual(self.register(c, "dup@virelix.test")[0], 201)
        status, data, _ = self.register(c, "DUP@virelix.test")
        self.assertEqual(status, 409)
        self.assertEqual(data["error"]["code"], "email_taken")

    def test_password_is_hashed(self):
        c = self.client()
        self.register(c, "hash@virelix.test")
        stored = self.app.auth.find_by_email("hash@virelix.test")["password_hash"]
        self.assertTrue(stored.startswith("scrypt$"))
        self.assertNotIn(PASSWORD, stored)


class VerificationAndLoginTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_unverified_cannot_sign_in_then_verify_once(self):
        c = self.client()
        self.register(c, "v@virelix.test")
        status, data, _ = c.post("/api/auth/login", {"email": "v@virelix.test", "password": PASSWORD})
        self.assertEqual((status, data["error"]["code"]), (403, "email_unverified"))
        token = self.token_from("v@virelix.test", "verify")
        self.assertEqual(c.post("/api/auth/verify-email", {"token": token})[0], 200)
        status, data, _ = c.post("/api/auth/verify-email", {"token": token})
        self.assertEqual((status, data["error"]["code"]), (400, "token_used"))
        self.assertEqual(c.post("/api/auth/login", {"email": "v@virelix.test", "password": PASSWORD})[0], 200)

    def test_resend_supersedes_old_token(self):
        c = self.client()
        self.register(c, "resend@virelix.test")
        old = self.token_from("resend@virelix.test", "verify")
        self.assertEqual(c.post("/api/auth/resend-verification", {"email": "resend@virelix.test"})[0], 200)
        new = self.token_from("resend@virelix.test", "verify")
        self.assertNotEqual(old, new)
        self.assertEqual(c.post("/api/auth/verify-email", {"token": old})[1]["error"]["code"], "token_used")
        self.assertEqual(c.post("/api/auth/verify-email", {"token": new})[0], 200)

    def test_expired_token(self):
        c = self.client()
        self.register(c, "exp@virelix.test")
        token = self.token_from("exp@virelix.test", "verify")
        with self.app.db.tokens.update() as tokens:
            tokens[sec.token_hash(token)]["expires_at"] = 0
        self.assertEqual(c.post("/api/auth/verify-email", {"token": token})[1]["error"]["code"], "token_expired")

    def test_garbage_token(self):
        c = self.client()
        self.assertEqual(c.post("/api/auth/verify-email", {"token": "x" * 40})[1]["error"]["code"], "token_invalid")

    def test_wrong_password_is_generic_and_throttled(self):
        self.signup("throttle@virelix.test")
        c = self.client()
        s1, d1, _ = c.post("/api/auth/login", {"email": "throttle@virelix.test", "password": "Wrong-pass-123"})
        s2, d2, _ = c.post("/api/auth/login", {"email": "nobody@virelix.test", "password": "Wrong-pass-123"})
        self.assertEqual((s1, s2), (401, 401))
        self.assertEqual(d1["error"]["message"], d2["error"]["message"])
        for _ in range(4):
            c.post("/api/auth/login", {"email": "throttle@virelix.test", "password": "Wrong-pass-123"})
        status, data, resp = c.post("/api/auth/login", {"email": "throttle@virelix.test", "password": PASSWORD})
        self.assertEqual(status, 429)
        self.assertTrue(resp.getheader("Retry-After"))

    def test_session_cookie_flags_and_logout(self):
        c = self.client()
        self.register(c, "cookie@virelix.test")
        c.post("/api/auth/verify-email", {"token": self.token_from("cookie@virelix.test", "verify")})
        status, _, resp = c.post("/api/auth/login", {"email": "cookie@virelix.test", "password": PASSWORD, "remember": True})
        self.assertEqual(status, 200)
        cookie = next(v for k, v in resp.getheaders() if k.lower() == "set-cookie" and v.startswith("vx_session="))
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertIn("Max-Age=", cookie)
        session_token = c.cookies["vx_session"]
        self.assertEqual(c.get("/api/me")[0], 200)
        self.assertEqual(c.post("/api/auth/logout")[0], 200)
        c.cookies["vx_session"] = session_token          # replaying the old cookie must fail
        self.assertEqual(c.get("/api/me")[0], 401)

    def test_csrf_and_origin_enforced(self):
        c = self.signup("csrf@virelix.test")
        status, data, _ = c.request("POST", "/api/collections", {"name": "x"}, csrf=False)
        self.assertEqual((status, data["error"]["code"]), (403, "csrf_failed"))
        status, data, _ = c.request("POST", "/api/collections", {"name": "x"}, origin="https://evil.example")
        self.assertEqual((status, data["error"]["code"]), (403, "bad_origin"))
        self.assertEqual(c.request("POST", "/api/collections", {"name": "x"})[0], 201)

    def test_protected_endpoints_require_auth(self):
        c = self.client()
        for path in ["/api/me", "/api/search?q=index", "/api/saved", "/api/history", "/api/collections",
                     "/api/attachments", "/api/admin/overview", "/api/owner/invitations"]:
            self.assertEqual(c.get(path)[0], 401, path)


class PasswordRecoveryTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_reset_flow_invalidates_sessions(self):
        email = "reset@virelix.test"
        signed_in = self.signup(email)
        anon = self.client()
        status, data, _ = anon.post("/api/auth/forgot-password", {"email": email})
        self.assertEqual(status, 200)
        status_unknown, data_unknown, _ = anon.post("/api/auth/forgot-password", {"email": "ghost@virelix.test"})
        self.assertEqual(data["message"], data_unknown["message"])  # no account enumeration
        token = self.token_from(email, "reset")
        self.assertEqual(anon.post("/api/auth/reset-password/check", {"token": token})[0], 200)
        weak = anon.post("/api/auth/reset-password", {"token": token, "password": "weak", "confirm_password": "weak"})
        self.assertEqual(weak[0], 400)  # token still usable after a policy failure
        new = "Brand-new-pass-77"
        self.assertEqual(anon.post("/api/auth/reset-password", {"token": token, "password": new, "confirm_password": new})[0], 200)
        self.assertEqual(anon.post("/api/auth/reset-password", {"token": token, "password": new, "confirm_password": new})[1]["error"]["code"], "token_used")
        self.assertEqual(signed_in.get("/api/me")[0], 401)
        self.assertEqual(anon.post("/api/auth/login", {"email": email, "password": PASSWORD})[0], 401)
        self.assertEqual(anon.post("/api/auth/login", {"email": email, "password": new})[0], 200)

    def test_change_password_keeps_current_session_only(self):
        email = "change@virelix.test"
        a = self.signup(email)
        b = self.client()
        b.post("/api/auth/login", {"email": email, "password": PASSWORD})
        bad = a.post("/api/me/password", {"current_password": "nope", "new_password": "Another-pass-88", "confirm_password": "Another-pass-88"})
        self.assertEqual(bad[0], 400)
        ok = a.post("/api/me/password", {"current_password": PASSWORD, "new_password": "Another-pass-88", "confirm_password": "Another-pass-88"})
        self.assertEqual(ok[0], 200)
        self.assertEqual(a.get("/api/me")[0], 200)
        self.assertEqual(b.get("/api/me")[0], 401)


if __name__ == "__main__":
    unittest.main()
