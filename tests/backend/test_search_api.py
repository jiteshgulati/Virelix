"""Ranked search through the HTTP API: scores, modes, sorting, pagination, timing,
private-index isolation and the extractive overview."""

import json
import unittest
from urllib.parse import quote

from tests.backend.helpers import ServerTestCase

FIX = {
    # Hand-counted for "python programming": A 3+2=5, B 1+1=2, C 1+0=1.
    "fx-a.txt": "Title: Alpha Notes\nCategory: Fixtures\nDate: 2024-01-01\n---\nPython Python Python programming programming. This sentence is long enough to be quoted as a passage.",
    "fx-b.txt": "Title: Beta Notes\nCategory: Fixtures\nDate: 2024-03-01\n---\nPython programming is described here in a sentence long enough to quote.",
    "fx-c.txt": "Title: Gamma Notes\nCategory: Other\nDate: 2024-02-01\n---\nPython search appears in this sentence which is long enough to quote.",
}
for i in range(12):  # 12 documents that each mention "kestrel" once: pagination fixture
    FIX[f"fx-p{i:02}.txt"] = f"Title: Page Fixture {i:02}\nCategory: Paging\n---\nkestrel number {i}"


def q(path, **params):
    return path + "?" + "&".join(f"{k}={quote(str(v))}" for k, v in params.items())


class RankedSearchApiTests(ServerTestCase):
    corpus_files = []
    fixture_docs = FIX

    def setUp(self):
        self.c = self.signup(f"api-{self._testMethodName}@virelix.test")

    def search(self, **params):
        params.setdefault("sources", "corpus")
        status, data, _ = self.c.get(q("/api/search", **params))
        self.assertEqual(status, 200, data)
        return data

    def test_scores_and_order_match_the_hand_counted_fixture(self):
        r = self.search(q="python programming")
        got = [(x["title"], x["score"], x["term_frequencies"]) for x in r["results"]]
        self.assertEqual(got, [("Alpha Notes", 5, {"python": 3, "programming": 2}),
                               ("Beta Notes", 2, {"python": 1, "programming": 1}),
                               ("Gamma Notes", 1, {"python": 1})])
        self.assertEqual((r["mode"], r["sort"], r["ranking"]), ("any", "relevance", "term_frequency"))
        self.assertIsInstance(r["response_time_ms"], float)
        self.assertGreaterEqual(r["response_time_ms"], 0)

    def test_results_carry_structured_snippets(self):
        top = self.search(q="python programming")["results"][0]
        snip = top["snippet"]
        self.assertEqual(snip["kind"], "match")
        marked = [snip["text"][a:b].casefold() for a, b in snip["highlights"]]
        self.assertEqual(marked, ["python", "python", "python", "programming", "programming"])
        phrase = self.search(q="python programming", mode="phrase")["results"][0]["snippet"]
        self.assertEqual([phrase["text"][a:b] for a, b in phrase["highlights"]], ["Python programming"])

    def test_modes(self):
        self.assertEqual([x["score"] for x in self.search(q="python programming", mode="all")["results"]], [5, 2])
        self.assertEqual([x["title"] for x in self.search(q="python programming", mode="phrase")["results"]],
                         ["Alpha Notes", "Beta Notes"])
        self.assertEqual(self.search(q="programming python", mode="phrase")["total"], 0)

    def test_new_accounts_default_to_any_terms(self):
        self.assertEqual(self.search(q="python unicorn")["mode"], "any")
        self.assertEqual(self.c.get("/api/me")[1]["prefs"]["default_mode"], "any")

    def test_unknown_terms_succeed_with_no_results(self):
        r = self.search(q="unicorn")
        self.assertEqual((r["total"], r["results"], r["terms_without_matches"]), (0, [], ["unicorn"]))

    def test_validation_errors(self):
        for params in [{"q": ""}, {"q": "  "}, {"q": "!!!"}, {"q": "x" * 301}, {"q": "python", "mode": "fuzzy"},
                       {"q": "python", "sort": "score"}, {"q": "python", "page": "abc"}, {"q": "python", "sources": "web"}]:
            status, data, _ = self.c.get(q("/api/search", **params))
            self.assertEqual(status, 400, params)
            self.assertNotIn("Traceback", json.dumps(data))

    def test_legacy_sort_name_still_ranks_by_relevance(self):
        self.assertEqual(self.search(q="python", sort="coverage")["sort"], "relevance")

    def test_category_filter_and_alternative_sorts(self):
        self.assertEqual([x["title"] for x in self.search(q="python", categories="Fixtures")["results"]], ["Alpha Notes", "Beta Notes"])
        self.assertEqual([x["title"] for x in self.search(q="python", sort="date_desc")["results"]],
                         ["Beta Notes", "Gamma Notes", "Alpha Notes"])

    def test_pagination_is_complete_stable_and_ranked_before_paging(self):
        seen = []
        for page in (1, 2, 3):
            r = self.search(q="kestrel", per_page=5, page=page)
            self.assertEqual((r["total"], r["pages"], r["page"]), (12, 3, page))
            seen += [x["doc_id"] for x in r["results"]]
        self.assertEqual(len(seen), 12)
        self.assertEqual(len(set(seen)), 12)               # no duplicates, nothing skipped
        everything = [x["doc_id"] for x in self.search(q="kestrel", per_page=50)["results"]]
        self.assertEqual(seen, everything)                # same order as one big page
        self.assertEqual(self.search(q="kestrel", per_page=5, page=99)["page"], 3)

    def test_overview_quotes_top_ranked_documents(self):
        status, ov, _ = self.c.get(q("/api/search/overview", q="python programming"))
        self.assertEqual(status, 200)
        self.assertEqual(ov["references"][0]["title"], "Alpha Notes")
        self.assertEqual(ov["matching_documents"], 3)

    def test_upload_and_removal_are_searchable_immediately(self):
        admin = self.make_admin(f"idx-admin-{self._testMethodName}@virelix.test")
        status, doc, _ = admin.upload("/api/admin/documents", "fx-new.txt", b"Title: Newcomer\n---\nosprey osprey")
        self.assertEqual(status, 201)
        self.assertEqual([(x["title"], x["score"]) for x in self.search(q="osprey")["results"]], [("Newcomer", 2)])
        admin.post("/api/admin/documents/remove", {"doc_ids": [doc["doc_id"]]})
        self.assertEqual(self.search(q="osprey")["total"], 0)


class PrivateIndexIsolationTests(ServerTestCase):
    corpus_files = []
    fixture_docs = {"shared.txt": "Title: Shared Notes\n---\nlapwing once"}

    def test_private_documents_are_ranked_but_only_for_their_owner(self):
        alice = self.signup("alice-private@virelix.test")
        bob = self.signup("bob-private@virelix.test")
        owner = self.owner()
        status, att, _ = alice.upload("/api/attachments", "notes.txt", b"lapwing lapwing lapwing heronry")
        self.assertEqual(status, 201)
        mine = alice.get("/api/search?q=lapwing&sources=corpus,attachments")[1]
        self.assertEqual([(x["source"], x["score"]) for x in mine["results"]], [("attachment", 3), ("corpus", 1)])
        for other in (bob, owner):
            r = other.get("/api/search?q=lapwing%20heronry&sources=corpus,attachments")[1]
            self.assertEqual([x["source"] for x in r["results"]], ["corpus"])
            self.assertEqual(r["terms_without_matches"], ["heronry"])
            self.assertEqual(other.get(f"/api/attachments/{att['id']}")[0], 404)
        vocab = json.dumps(owner.get("/api/admin/index/vocabulary?q=heronry")[1])
        self.assertNotIn("heronry", vocab.replace('"q"', ""))
        self.assertEqual(owner.get("/api/admin/index/postings?term=heronry")[1]["df"], 0)

    def test_removed_and_expired_attachments_leave_the_private_index(self):
        carol = self.signup("carol-private@virelix.test")
        _, a1, _ = carol.upload("/api/attachments", "a.txt", b"plover plover")
        _, a2, _ = carol.upload("/api/attachments", "b.txt", b"plover dunlin")
        self.assertEqual(carol.get("/api/search?q=plover&sources=attachments")[1]["total"], 2)
        carol.delete(f"/api/attachments/{a1['id']}")
        self.assertEqual(carol.get("/api/search?q=plover&sources=attachments")[1]["total"], 1)
        uid = carol.get("/api/me")[1]["id"]
        with self.app.db.workspace.update() as data:
            for a in data[uid]["attachments"]:
                a["expires_ts"] = 0                      # simulate the 24-hour expiry passing
        self.assertEqual(carol.get("/api/search?q=dunlin&sources=attachments")[1]["total"], 0)


if __name__ == "__main__":
    unittest.main()
