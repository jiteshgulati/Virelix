import unittest

from tests.backend.helpers import DEV_KEY, ServerTestCase


class SearchAndWorkspaceTests(ServerTestCase):
    corpus_files = None  # full sample corpus

    def setUp(self):
        self.c = self.signup(f"ws-{self._testMethodName}@virelix.test")

    def doc_id(self, filename="01-inverted-index-fundamentals.txt"):
        return next(d.doc_id for d in self.app.corpus.report.documents if d.filename == filename)

    def test_search_preview_and_history(self):
        status, data, _ = self.c.get("/api/search?q=inverted%20index&record=1")
        self.assertEqual(status, 200)
        self.assertGreater(data["total"], 0)
        self.assertIn("Ranked by term frequency", data["method"])
        first = data["results"][0]
        self.assertEqual(first["score"], sum(first["term_frequencies"].values()))
        self.assertEqual(first["matched_terms"], ["inverted", "index"])
        self.assertEqual(first["title"], "Inverted Index Fundamentals")  # highest term frequency (3 + 9)
        hist = self.c.get("/api/history")[1]["items"]
        self.assertEqual(hist[0]["query"], "inverted index")
        self.assertEqual(hist[0]["result_count"], data["total"])
        self.assertEqual(self.c.delete(f"/api/history/{hist[0]['id']}")[0], 200)
        self.assertEqual(self.c.get("/api/history")[1]["items"], [])

    def test_search_errors_and_params(self):
        self.assertEqual(self.c.get("/api/search?q=")[1]["error"]["code"], "invalid_query")
        self.assertEqual(self.c.get("/api/search?q=%21%21%21")[0], 400)
        self.assertEqual(self.c.get("/api/search?q=index&page=abc")[0], 400)
        self.assertEqual(self.c.get("/api/search?q=index&sources=web")[0], 400)
        r = self.c.get("/api/search?q=index&mode=any&per_page=5&page=2&sort=title_asc")[1]
        self.assertEqual((r["page"], r["per_page"]), (2, 5))
        titles = [x["title"] for x in r["results"]]
        self.assertEqual(titles, sorted(titles, key=str.casefold))
        r = self.c.get("/api/search?q=index&mode=any&categories=Databases")[1]
        self.assertTrue(all(x["category"] == "Databases" for x in r["results"]))

    def test_consecutive_identical_searches_are_not_duplicated(self):
        self.c.get("/api/search?q=hash&mode=all&record=1")
        self.c.get("/api/search?q=hash&mode=all&record=1")
        self.c.get("/api/search?q=hash&mode=any&record=1")
        self.c.get("/api/search?q=hash&mode=all&record=1")
        self.assertEqual([h["mode"] for h in self.c.get("/api/history")[1]["items"]], ["all", "any", "all"])

    def test_history_respects_preference(self):
        self.c.patch("/api/me/prefs", {"save_history": False})
        self.c.get("/api/search?q=hash&record=1")
        self.assertEqual(self.c.get("/api/history")[1]["items"], [])

    def test_saved_results(self):
        d = self.doc_id()
        self.assertEqual(self.c.post("/api/saved", {"doc_id": d, "query": "index"})[0], 201)
        self.assertEqual(self.c.post("/api/saved", {"doc_id": d})[1]["error"]["code"], "already_saved")
        self.assertEqual(self.c.post("/api/saved", {"doc_id": "doc-missing"})[0], 404)
        self.assertTrue(self.c.get(f"/api/documents/{d}")[1]["saved"])
        flags = {r["doc_id"]: r["saved"] for r in self.c.get("/api/search?q=inverted&per_page=50")[1]["results"]}
        self.assertTrue(flags.pop(d))
        self.assertFalse(any(flags.values()))
        self.assertEqual(self.c.delete(f"/api/saved/by-doc/{d}")[0], 200)
        self.assertEqual(self.c.delete(f"/api/saved/by-doc/{d}")[0], 404)

    def test_save_overview_is_server_derived(self):
        status, item, _ = self.c.post("/api/saved/overview", {"query": "password hashing", "passages": [{"text": "forged"}]})
        self.assertEqual(status, 201)
        self.assertNotIn("forged", str(item["passages"]))
        self.assertTrue(item["references"])
        self.assertEqual(self.c.post("/api/saved/overview", {"query": "zzzqqq"})[0], 400)

    def test_collections(self):
        d1, d2 = self.doc_id(), self.doc_id("07-hash-tables.txt")
        status, col, _ = self.c.post("/api/collections", {"name": "Reading list", "doc_id": d1})
        self.assertEqual((status, col["item_count"]), (201, 1))
        self.assertEqual(self.c.post("/api/collections", {"name": "reading LIST"})[1]["error"]["code"], "duplicate_name")
        self.assertEqual(self.c.post("/api/collections", {"name": "  "})[0], 400)
        cid = col["id"]
        self.assertEqual(self.c.post(f"/api/collections/{cid}/items", {"doc_id": d2})[0], 201)
        self.assertEqual(self.c.post(f"/api/collections/{cid}/items", {"doc_id": d2})[1]["error"]["code"], "duplicate_item")
        self.assertEqual(self.c.patch(f"/api/collections/{cid}", {"name": "Renamed"})[1]["name"], "Renamed")
        self.assertEqual(self.c.delete(f"/api/collections/{cid}/items/{d1}")[0], 200)
        self.assertEqual([i["doc_id"] for i in self.c.get(f"/api/collections/{cid}")[1]["items"]], [d2])
        self.assertEqual(self.c.delete(f"/api/collections/{cid}")[0], 200)
        self.assertEqual(self.c.get(f"/api/collections/{cid}")[0], 404)

    def test_attachments_private_and_validated(self):
        status, att, _ = self.c.upload("/api/attachments", "my notes.txt", b"Private notes about zanzibarite crystals.")
        self.assertEqual(status, 201)
        self.assertEqual(att["filename"], "my-notes.txt")
        self.assertEqual(self.c.upload("/api/attachments", "scan.pdf", b"%PDF")[0], 415)
        self.assertEqual(self.c.upload("/api/attachments", "bin.txt", b"\x00\x01\x02")[0], 415)
        self.assertEqual(self.c.upload("/api/attachments", "empty.txt", b"")[0], 400)
        self.assertEqual(self.c.upload("/api/attachments", "big.txt", b"a " * 300_000)[0], 413)
        mine = self.c.get("/api/search?q=zanzibarite&sources=attachments")[1]
        self.assertEqual(mine["total"], 1)
        self.assertEqual(self.c.get("/api/search?q=zanzibarite&sources=corpus")[1]["total"], 0)
        other = self.signup("other-attach@virelix.test")
        self.assertEqual(other.get("/api/search?q=zanzibarite&sources=corpus,attachments")[1]["total"], 0)
        self.assertEqual(other.get(f"/api/attachments/{att['id']}")[0], 404)
        self.assertEqual(other.delete(f"/api/attachments/{att['id']}")[0], 404)
        self.assertEqual(self.c.get(f"/api/attachments/{att['id']}")[1]["text"], "Private notes about zanzibarite crystals.")
        self.assertNotIn("zanzibarite", " ".join(d.text for d in self.app.corpus.report.documents))
        self.assertEqual(self.c.delete("/api/attachments")[1]["removed"], 1)

    def test_workspace_isolation(self):
        col = self.c.post("/api/collections", {"name": "Mine"})[1]
        other = self.signup("other-iso@virelix.test")
        self.assertEqual(other.get(f"/api/collections/{col['id']}")[0], 404)
        self.assertEqual(other.delete(f"/api/collections/{col['id']}")[0], 404)
        self.assertEqual(other.get("/api/collections")[1]["items"], [])

    def test_preferences_validation(self):
        self.assertEqual(self.c.patch("/api/me/prefs", {"theme": "oled", "accent": "lapis"})[1]["prefs"]["theme"], "oled")
        self.assertEqual(self.c.patch("/api/me/prefs", {"theme": "neon"})[0], 400)
        self.assertEqual(self.c.patch("/api/me/prefs", {"role": "owner"})[0], 400)
        self.assertEqual(self.c.patch("/api/me/prefs", {"per_page": 7})[0], 400)

    def test_document_viewer_api(self):
        d = self.doc_id()
        data = self.c.get(f"/api/documents/{d}")[1]
        self.assertEqual(data["title"], "Inverted Index Fundamentals")
        self.assertIn("postings list", data["text"])
        self.assertEqual(self.c.get("/api/documents/doc-0000000000")[1]["error"]["code"], "document_not_found")


class AdminCorpusTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt", "07-hash-tables.txt"]

    def test_upload_index_and_remove(self):
        admin = self.make_admin("corpus-admin@virelix.test")
        status, doc, _ = admin.upload("/api/admin/documents", "../../evil name.txt",
                                      b"Title: Uploaded Note\nCategory: Testing\n---\nQuasar telemetry notes.")
        self.assertEqual(status, 201)
        self.assertEqual(doc["filename"], "evil-name.txt")
        self.assertTrue((self.cfg.corpus_dir / "evil-name.txt").is_file())
        self.assertEqual(admin.upload("/api/admin/documents", "evil-name.txt", b"again")[0], 409)
        self.assertEqual(admin.upload("/api/admin/documents", "x.md", b"# md")[0], 415)
        self.assertEqual(admin.upload("/api/admin/documents", "x.txt", b"\x00\x00")[0], 415)
        user = self.signup("reader@virelix.test")
        self.assertEqual(user.get("/api/search?q=quasar")[1]["total"], 1)

        # The index is rebuilt automatically when the corpus changes: the upload is already indexed.
        status, idx, _ = admin.get("/api/admin/index")
        self.assertEqual((idx["state"], idx["stats"]["documents"], idx["last_event"]["reason"]), ("current", 3, "corpus changed"))
        self.assertTrue(idx["retrieval_enabled"])
        generation = idx["generation"]
        status, idx, _ = admin.post("/api/admin/index/rebuild", {})
        self.assertEqual((status, idx["state"], idx["generation"]), (200, "current", generation + 1))
        post = admin.get("/api/admin/index/postings?term=Quasar")[1]
        self.assertEqual((post["term"], post["df"], post["postings"][0]["tf"]), ("quasar", 1, 1))
        vocab = admin.get("/api/admin/index/vocabulary?q=hash&sort=df")[1]
        self.assertTrue(all("hash" in t["term"] for t in vocab["terms"]))

        self.assertEqual(admin.post("/api/admin/documents/remove", {"doc_ids": ["doc-nope"]})[0], 404)
        self.assertEqual(admin.post("/api/admin/documents/remove", {"doc_ids": [doc["doc_id"]]})[0], 200)
        self.assertFalse((self.cfg.corpus_dir / "evil-name.txt").exists())
        self.assertEqual(user.get("/api/search?q=quasar")[1]["total"], 0)
        self.assertEqual(admin.get("/api/admin/index")[1]["state"], "current")
        self.assertEqual(admin.get("/api/admin/index/postings?term=quasar")[1]["df"], 0)
        self.assertIn("document_removed", [e["action"] for e in self.owner().get("/api/owner/audit")[1]["items"]])


class StaticSecurityTests(ServerTestCase):
    corpus_files = ["01-inverted-index-fundamentals.txt"]

    def test_private_files_not_served(self):
        c = self.client()
        for path in ["/data/users.json", "/corpus/01-inverted-index-fundamentals.txt", "/assets/../../data/users.json",
                     "/assets/%2e%2e/%2e%2e/run.py", "/backend/app.py", "/run.py", "/.env"]:
            status, body, _ = c.get(path)
            self.assertIn(status, {404}, path)

    def test_spa_routes_and_security_headers(self):
        status, body, resp = self.client().get("/search")
        self.assertEqual(status, 200)
        self.assertIn(b"<!doctype html>", body.lower())
        csp = resp.getheader("Content-Security-Policy")
        self.assertIn("script-src 'self'", csp)
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")

    def test_dev_mailbox_requires_developer_key(self):
        c = self.client()
        self.assertEqual(c.get("/api/dev/mailbox")[1]["error"]["code"], "dev_key_required")
        self.assertEqual(c.get("/api/dev/mailbox", headers={"X-Dev-Mailbox-Key": "wrong"})[0], 403)
        self.assertEqual(c.get("/api/dev/mailbox", headers={"X-Dev-Mailbox-Key": DEV_KEY})[0], 200)


if __name__ == "__main__":
    unittest.main()
