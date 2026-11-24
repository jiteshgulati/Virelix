import shutil
import tempfile
import unittest
from pathlib import Path

from backend.config import ROOT
from backend.search.index import DocumentRecord, InvertedIndex, build_index
from backend.search.loader import load_corpus


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

    def test_headerless_title_is_not_counted_twice(self):
        from backend.search.loader import Document
        headerless = Document("h", "h.txt", "kestrel survey", "kestrel survey\nkestrel again")
        headed = Document("t", "t.txt", "Raptor Notes", "kestrel survey\nkestrel again")
        idx = build_index([headerless, headed])
        self.assertEqual(idx.postings["kestrel"]["h"].tf, 2)   # first line not duplicated as title
        self.assertEqual(idx.postings["kestrel"]["t"].tf, 2)
        self.assertEqual(idx.postings["raptor"]["t"].tf, 1)    # a header title is indexed

    def test_validate_detects_inconsistency(self):
        self.assertEqual(self.idx.validate(), [])
        self.idx.postings["index"]["d1"].tf = 5          # tf no longer matches its positions
        self.assertTrue(any("tf/positions" in p for p in self.idx.validate()))

    def test_bad_format_rejected(self):
        with self.assertRaises(ValueError):
            InvertedIndex.from_dict({"format_version": 99})

    def test_foundation_on_sample_corpus(self):
        docs = load_corpus(ROOT / "corpus").documents
        idx = build_index(docs)
        self.assertEqual(idx.stats()["documents"], 31)
        self.assertGreater(idx.stats()["vocabulary_size"], 1500)
        self.assertGreaterEqual(idx.document_frequency("index"), 3)
        stop = build_index(docs, remove_stopwords=True)
        self.assertNotIn("the", stop.postings)
        self.assertLess(stop.stats()["total_tokens"], idx.stats()["total_tokens"])


if __name__ == "__main__":
    unittest.main()
