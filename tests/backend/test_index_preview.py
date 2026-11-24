import shutil
import tempfile
import unittest
from pathlib import Path

from backend.config import ROOT
from backend.search.index import DocumentRecord, InvertedIndex, initialize_foundation
from backend.search.loader import load_corpus
from backend.search.preview import Candidate, QueryError, overview, search


class InvertedIndexTests(unittest.TestCase):
    def setUp(self):
        self.idx = InvertedIndex()
        self.idx.add_document(DocumentRecord("d1", "One", "1.txt", 0, 0), ["index", "the", "index", "terms"])
        self.idx.add_document(DocumentRecord("d2", "Two", "2.txt", 0, 0), ["terms", "postings"])

    def test_postings_and_term_frequency(self):
        p = self.idx.postings_for("index")
        self.assertEqual([(x.doc_id, x.tf, x.positions) for x in p], [("d1", 2, [0, 2])])
        self.assertEqual(self.idx.document_frequency("terms"), 2)
        self.assertEqual(self.idx.collection_frequency("index"), 2)
        self.assertEqual(self.idx.postings_for("missing"), [])

    def test_document_metadata(self):
        self.assertEqual(self.idx.documents["d1"].length, 4)
        self.assertEqual(self.idx.documents["d1"].unique_terms, 3)

    def test_stats(self):
        s = self.idx.stats()
        self.assertEqual((s["documents"], s["vocabulary_size"], s["total_tokens"], s["postings"]), (2, 4, 6, 5))

    def test_remove_document_cleans_vocabulary(self):
        self.assertTrue(self.idx.remove_document("d2"))
        self.assertNotIn("postings", self.idx.postings)
        self.assertEqual(self.idx.document_frequency("terms"), 1)
        self.assertFalse(self.idx.remove_document("d2"))

    def test_re_adding_replaces(self):
        self.idx.add_document(DocumentRecord("d1", "One", "1.txt", 0, 0), ["fresh"])
        self.assertNotIn("index", self.idx.postings)
        self.assertEqual(self.idx.stats()["documents"], 2)

    def test_round_trip(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            self.idx.save(tmp / "i.json")
            again = InvertedIndex.load(tmp / "i.json")
            self.assertEqual(again.vocabulary(), self.idx.vocabulary())
            self.assertEqual(again.postings_for("index")[0].positions, [0, 2])
        finally:
            shutil.rmtree(tmp)

    def test_bad_format_rejected(self):
        with self.assertRaises(ValueError):
            InvertedIndex.from_dict({"format_version": 99})

    def test_foundation_on_sample_corpus(self):
        docs = load_corpus(ROOT / "corpus").documents
        idx = initialize_foundation(docs)
        self.assertEqual(idx.stats()["documents"], 31)
        self.assertGreater(idx.stats()["vocabulary_size"], 1500)
        self.assertGreaterEqual(idx.document_frequency("index"), 3)
        stop = initialize_foundation(docs, remove_stopwords=True)
        self.assertNotIn("the", stop.postings)
        self.assertLess(stop.stats()["total_tokens"], idx.stats()["total_tokens"])


def cands():
    return [
        Candidate("a", "Alpha Index", "The inverted index maps terms. Postings hold document ids and counts.", "corpus", "a.txt", {"category": "IR", "date": "2024-01-01"}),
        Candidate("b", "Beta Hash", "Hash tables store keys. An index can use a hash table.", "corpus", "b.txt", {"category": "DS", "date": "2024-03-01"}),
        Candidate("c", "Gamma", "Nothing relevant lives here at all, only unrelated prose text.", "corpus", "c.txt", {"category": "DS", "date": "2024-02-01"}),
    ]


class PreviewTests(unittest.TestCase):
    def test_all_mode_requires_every_term(self):
        r = search(cands(), "index hash")
        self.assertEqual([x["doc_id"] for x in r["results"]], ["b"])
        self.assertEqual(r["results"][0]["matched_terms"], ["index", "hash"])

    def test_any_mode_orders_by_matched_count(self):
        r = search(cands(), "index hash", mode="any")
        self.assertEqual([x["doc_id"] for x in r["results"]], ["b", "a"])
        self.assertEqual(r["results"][1]["missing_terms"], ["hash"])

    def test_phrase_mode(self):
        self.assertEqual(search(cands(), "inverted index", mode="phrase")["total"], 1)
        self.assertEqual(search(cands(), "index inverted", mode="phrase")["total"], 0)

    def test_no_scores_are_reported(self):
        result = search(cands(), "index")["results"][0]
        self.assertFalse({"score", "relevance", "rank_score"} & set(result))

    def test_terms_without_matches(self):
        r = search(cands(), "index zebra", mode="any")
        self.assertEqual(r["terms_without_matches"], ["zebra"])
        self.assertEqual(search(cands(), "zebra")["total"], 0)

    def test_invalid_queries(self):
        for q in ["", "   ", "!!!", "x" * 301]:
            with self.assertRaises(QueryError):
                search(cands(), q)
        with self.assertRaises(QueryError):
            search(cands(), "index", mode="fuzzy")
        with self.assertRaises(QueryError):
            search(cands(), "index", sort="score")

    def test_sorting(self):
        titles = lambda r: [x["title"] for x in r["results"]]
        self.assertEqual(titles(search(cands(), "index", sort="title_desc")), ["Beta Hash", "Alpha Index"])
        self.assertEqual([x["doc_id"] for x in search(cands(), "index", sort="date_desc")["results"]], ["b", "a"])
        self.assertEqual([x["doc_id"] for x in search(cands(), "index", sort="date_asc")["results"]], ["a", "b"])

    def test_pagination_bounds(self):
        many = [Candidate(str(i), f"Doc {i:02}", "index text", "corpus", f"{i}.txt") for i in range(23)]
        r = search(many, "index", per_page=10, page=3)
        self.assertEqual((r["page"], r["pages"], len(r["results"]), r["total"]), (3, 3, 3, 23))
        self.assertEqual(search(many, "index", per_page=10, page=99)["page"], 3)

    def test_category_filter(self):
        self.assertEqual(search(cands(), "index", mode="any", categories=["IR"])["total"], 1)

    def test_overview_is_extractive_with_real_references(self):
        o = overview(cands(), "index", mode="any")
        self.assertEqual(o["kind"], "extractive_preview")
        texts = {c.doc_id: c.text for c in cands()}
        for p in o["passages"]:
            self.assertIn(p["text"], texts[p["doc_id"]])
        self.assertEqual({r["doc_id"] for r in o["references"]}, {p["doc_id"] for p in o["passages"]})

    def test_overview_without_matches(self):
        self.assertEqual(overview(cands(), "zebra")["passages"], [])


if __name__ == "__main__":
    unittest.main()
