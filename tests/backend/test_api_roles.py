import unittest

from tests.backend.helpers import OWNER_EMAIL, ServerTestCase


class OwnerBootstrapTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_owner_granted_only_after_verification(self):
        c = self.client()
        self.register(c, OWNER_EMAIL, "Owner")
        self.assertEqual(self.app.auth.find_by_email(OWNER_EMAIL)["role"], "user")
        c.post("/api/auth/verify-email", {"token": self.token_from(OWNER_EMAIL, "verify")})
        self.assertEqual(self.app.auth.find_by_email(OWNER_EMAIL)["role"], "owner")
        type(self)._owner_ready = False

    def test_second_owner_record_locks_governance_without_changing_data(self):
        self.owner()
        c = self.signup("fake-owner@virelix.test")
        with self.app.db.users.update() as users:
            for u in users.values():
                if u["email"] == "fake-owner@virelix.test":
                    u["role"] = "owner"  # simulate a tampered data file: two Owner records
        state = self.app.auth.reconcile_owner()
        self.assertEqual(state["conflict"], "multiple_owners")
        # Nothing is silently changed...
        self.assertEqual(self.app.auth.find_by_email("fake-owner@virelix.test")["role"], "owner")
        # ...but nobody can exercise Owner governance while the conflict stands.
        self.assertEqual(c.get("/api/owner/platform")[0], 403)
        self.assertEqual(self.owner().get("/api/owner/invitations")[0], 403)
        self.assertEqual(c.get("/api/me")[1]["role"], "admin")
        with self.app.db.users.update() as users:
            for u in users.values():
                if u["email"] == "fake-owner@virelix.test":
                    u["role"] = "user"
        self.assertEqual(self.owner().get("/api/owner/invitations")[0], 200)


class RoleAuthorizationTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt", "02-tokenization-and-normalization.txt"]

    def test_normal_user_blocked_from_admin_and_owner(self):
        u = self.signup("plain@virelix.test")
        for path in ["/api/admin/overview", "/api/admin/documents", "/api/admin/users", "/api/admin/index",
                     "/api/admin/system", "/api/owner/invitations", "/api/owner/platform", "/api/owner/audit"]:
            self.assertEqual(u.get(path)[0], 403, path)
        self.assertEqual(u.upload("/api/admin/documents", "x.txt", b"hello world")[0], 403)
        self.assertEqual(u.post("/api/admin/documents/remove", {"doc_ids": ["doc-x"]})[0], 403)
        self.assertEqual(u.post("/api/owner/invitations", {"email": "me2@virelix.test"})[0], 403)

    def test_admin_cannot_use_owner_operations(self):
        admin = self.make_admin("admin1@virelix.test")
        self.assertEqual(admin.get("/api/admin/overview")[0], 200)
        self.assertEqual(admin.get("/api/owner/invitations")[0], 403)
        self.assertEqual(admin.post("/api/owner/invitations", {"email": "x@virelix.test"})[0], 403)
        target = self.signup("victim@virelix.test")
        uid = target.get("/api/me")[1]["id"]
        self.assertEqual(admin.post(f"/api/owner/admins/{uid}/remove")[0], 403)

    def test_admin_cannot_moderate_privileged_accounts(self):
        admin = self.make_admin("admin2@virelix.test")
        owner_id = self.owner().get("/api/me")[1]["id"]
        self.assertEqual(admin.post(f"/api/admin/users/{owner_id}/suspend")[0], 403)
        other = self.make_admin("admin3@virelix.test")
        other_id = other.get("/api/me")[1]["id"]
        self.assertEqual(admin.post(f"/api/admin/users/{other_id}/suspend")[0], 403)
        self.assertEqual(admin.post(f"/api/admin/users/{admin.get('/api/me')[1]['id']}/suspend")[0], 403)


class InvitationLifecycleTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_full_lifecycle(self):
        owner = self.owner()
        invitee = self.signup("invitee@virelix.test")
        intruder = self.signup("intruder@virelix.test")
        status, data, _ = owner.post("/api/owner/invitations", {"email": "invitee@virelix.test"})
        self.assertEqual(status, 201)
        inv_id = data["invitation"]["id"]
        self.assertEqual(owner.post("/api/owner/invitations", {"email": "invitee@virelix.test"})[1]["error"]["code"], "invite_pending")
        first = self.token_from("invitee@virelix.test", "invite")
        owner.post(f"/api/owner/invitations/{inv_id}/resend")
        second = self.token_from("invitee@virelix.test", "invite")
        self.assertNotEqual(first, second)
        self.assertEqual(invitee.post("/api/invitations/accept", {"token": first})[1]["error"]["code"], "invite_invalid")
        self.assertEqual(intruder.post("/api/invitations/accept", {"token": second})[0], 403)  # email-bound
        status, data, _ = invitee.post("/api/invitations/accept", {"token": second})
        self.assertEqual((status, data["user"]["role"]), (200, "admin"))
        self.assertEqual(invitee.post("/api/invitations/accept", {"token": second})[0], 400)    # single use
        statuses = {i["id"]: i["status"] for i in owner.get("/api/owner/invitations")[1]["items"]}
        self.assertEqual(statuses[inv_id], "accepted")
        self.assertEqual(owner.post(f"/api/owner/invitations/{inv_id}/revoke")[0], 409)
        admin_id = invitee.get("/api/me")[1]["id"]
        self.assertEqual(owner.post(f"/api/owner/admins/{admin_id}/remove")[0], 200)
        self.assertEqual(invitee.get("/api/admin/overview")[0], 403)
        actions = [e["action"] for e in owner.get("/api/owner/audit")[1]["items"]]
        for a in ["admin_invited", "admin_invite_resent", "admin_invite_accepted", "admin_removed"]:
            self.assertIn(a, actions)

    def test_revoked_and_expired_invitations_fail(self):
        owner = self.owner()
        a = self.signup("revoked@virelix.test")
        inv = owner.post("/api/owner/invitations", {"email": "revoked@virelix.test"})[1]["invitation"]
        token = self.token_from("revoked@virelix.test", "invite")
        self.assertEqual(owner.post(f"/api/owner/invitations/{inv['id']}/revoke")[0], 200)
        self.assertEqual(a.post("/api/invitations/accept", {"token": token})[1]["error"]["code"], "invite_revoked")

        b = self.signup("expired@virelix.test")
        inv = owner.post("/api/owner/invitations", {"email": "expired@virelix.test"})[1]["invitation"]
        token = self.token_from("expired@virelix.test", "invite")
        with self.app.db.invitations.update() as invs:
            invs[inv["id"]]["expires_at"] = 0
        self.assertEqual(b.post("/api/invitations/accept", {"token": token})[1]["error"]["code"], "invite_expired")
        listed = {i["id"]: i["status"] for i in owner.get("/api/owner/invitations")[1]["items"]}
        self.assertEqual(listed[inv["id"]], "expired")
        owner.post(f"/api/owner/invitations/{inv['id']}/resend")   # resending revives it with a new link
        fresh = self.token_from("expired@virelix.test", "invite")
        self.assertEqual(b.post("/api/invitations/accept", {"token": fresh})[0], 200)

    def test_invite_validation(self):
        owner = self.owner()
        self.assertEqual(owner.post("/api/owner/invitations", {"email": "not-an-email"})[0], 400)
        self.assertEqual(owner.post("/api/owner/invitations", {"email": OWNER_EMAIL})[0], 400)


class SuspensionTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_suspend_and_reactivate(self):
        admin = self.make_admin("mod@virelix.test")
        user = self.signup("member@virelix.test")
        uid = user.get("/api/me")[1]["id"]
        listing = admin.get("/api/admin/users?q=member")[1]["items"]
        self.assertEqual([u["email"] for u in listing], ["member@virelix.test"])
        self.assertEqual(admin.post(f"/api/admin/users/{uid}/suspend", {"reason": "Test"})[1]["status"], "suspended")
        self.assertEqual(user.get("/api/me")[0], 401)                   # session revoked
        fresh = self.client()
        self.assertEqual(fresh.post("/api/auth/login", {"email": "member@virelix.test", "password": "Correct-horse-42"})[1]["error"]["code"], "account_suspended")
        self.assertEqual(admin.get("/api/admin/users?status=suspended")[1]["items"][0]["id"], uid)
        self.assertEqual(admin.post(f"/api/admin/users/{uid}/suspend")[0], 409)
        self.assertEqual(admin.post(f"/api/admin/users/{uid}/reactivate")[1]["status"], "active")
        self.assertEqual(fresh.post("/api/auth/login", {"email": "member@virelix.test", "password": "Correct-horse-42"})[0], 200)


if __name__ == "__main__":
    unittest.main()
