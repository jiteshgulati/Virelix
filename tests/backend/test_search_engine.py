"""Query processing, posting-list retrieval and term-frequency ranking.

Expected scores are counted by hand from the fixture text below, never computed
with the code under test.
"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.config import Config
from backend.search import engine
from backend.search.index import InvertedIndex, build_index
from backend.search.loader import Document
from backend.services import corpus as corpus_module
from backend.services.common import Auditor
from backend.services.corpus import CorpusService
from backend.storage import Database


def doc(doc_id, title, text, category="Fixtures", date=""):
    meta = {"category": category}
    if date:
        meta["date"] = date
    return Document(doc_id=doc_id, filename=f"{doc_id}.txt", title=title, text=text, metadata=meta)


# Titles are indexed too, so fixture titles avoid every query word used below.
FIXTURES = [
    doc("A", "Alpha Notes", "Python Python Python programming programming", date="2024-01-01"),  # python 3, programming 2
    doc("B", "Beta Notes", "Python programming", date="2024-03-01"),                                 # python 1, programming 1
    doc("C", "Gamma Notes", "Python search", date="2024-02-01"),                                     # python 1
    doc("D", "Delta Tie", "zircon quartz", category="Minerals"),                                     # zircon 1, quartz 1
    doc("E", "Echo Tie", "quartz zircon", category="Minerals"),                                      # quartz 1, zircon 1
    doc("F", "Foxtrot Repeat", "data data data science", category="Data"),                           # data 3, science 1
]


def run(query, mode="any", sort="relevance", categories=None, index=None):
    parsed = engine.parse_query(query, mode)
    return engine.search([("corpus", index or build_index(FIXTURES))], parsed, sort=sort, categories=categories)


def order(result):
    return [(h.doc_id, h.score) for h in result["hits"]]


class QueryParsingTests(unittest.TestCase):
    def test_normalisation_matches_document_pipeline(self):
        q = engine.parse_query("  PYTHON,   Programming!!  ", "any")
        self.assertEqual(q.terms, ("python", "programming"))

    def test_repeated_terms_are_kept_for_phrases_but_scored_once(self):
        q = engine.parse_query("data data science", "phrase")
        self.assertEqual(q.tokens, ("data", "data", "science"))
        self.assertEqual(q.terms, ("data", "science"))

    def test_invalid_queries(self):
        for bad in ["", "   ", "!!! ...", None, "x" * 301, " ".join(f"w{i}" for i in range(25))]:
            with self.assertRaises(engine.QueryError, msg=repr(bad)[:40]):
                engine.parse_query(bad, "any")
        with self.assertRaises(engine.QueryError):
            engine.parse_query("python", "fuzzy")
        with self.assertRaises(engine.QueryError):
            engine.normalise_sort("score")

    def test_unicode_and_sort_alias(self):
        self.assertEqual(engine.parse_query("Café ＰＹＴＨＯＮ", "any").terms, ("café", "python"))
        self.assertEqual(engine.normalise_sort("coverage"), "relevance")


class RankingTests(unittest.TestCase):
    def test_prd_example_any_terms(self):
        # A: 3 + 2 = 5; B: 1 + 1 = 2; C: 1 + 0 = 1
        self.assertEqual(order(run("python programming")), [("A", 5), ("B", 2), ("C", 1)])

    def test_all_terms_excludes_partial_matches(self):
        self.assertEqual(order(run("python programming", "all")), [("A", 5), ("B", 2)])

    def test_unknown_term_any_vs_all(self):
        self.assertEqual(order(run("python unicorn")), [("A", 3), ("B", 1), ("C", 1)])
        self.assertEqual(order(run("python unicorn", "all")), [])
        result = run("python unicorn")
        self.assertEqual(result["terms_without_matches"], ["unicorn"])

    def test_repeated_query_terms_do_not_inflate_scores(self):
        self.assertEqual(order(run("python python python")), order(run("python")))
        self.assertEqual(order(run("python")), [("A", 3), ("B", 1), ("C", 1)])

    def test_case_and_punctuation_do_not_change_results(self):
        self.assertEqual(order(run("PYTHON; programming?")), order(run("python programming")))

    def test_equal_scores_break_ties_by_title_then_id(self):
        # Delta and Echo both score 2; also B and C tie on "python" (1 each): Beta before Gamma.
        self.assertEqual(order(run("zircon quartz")), [("D", 2), ("E", 2)])
        self.assertEqual([h.doc_id for h in run("python")["hits"]][1:], ["B", "C"])

    def test_term_frequencies_are_reported_per_term(self):
        a = run("python programming")["hits"][0]
        self.assertEqual((a.tf, a.missing), ({"python": 3, "programming": 2}, []))
        c = run("python programming")["hits"][2]
        self.assertEqual((c.tf, c.missing), ({"python": 1}, ["programming"]))

    def test_alternative_sorts_cover_the_full_result_set(self):
        self.assertEqual([h.doc_id for h in run("python", sort="title_asc")["hits"]], ["A", "B", "C"])
        self.assertEqual([h.doc_id for h in run("python", sort="title_desc")["hits"]], ["C", "B", "A"])
        self.assertEqual([h.doc_id for h in run("python", sort="date_desc")["hits"]], ["B", "C", "A"])
        self.assertEqual([h.doc_id for h in run("python", sort="date_asc")["hits"]], ["A", "C", "B"])

    def test_category_filter_applies_before_ranking(self):
        self.assertEqual(order(run("python zircon", categories=["minerals"])), [("D", 1), ("E", 1)])

    def test_deterministic_across_runs_and_insertion_orders(self):
        reversed_index = build_index(list(reversed(FIXTURES)))
        for q in ["python programming", "zircon quartz", "data science"]:
            self.assertEqual(order(run(q)), order(run(q, index=reversed_index)))


class PhraseTests(unittest.TestCase):
    def test_phrase_requires_adjacency_and_order(self):
        self.assertEqual(order(run("zircon quartz", "phrase")), [("D", 2)])
        self.assertEqual(order(run("quartz zircon", "phrase")), [("E", 2)])

    def test_phrase_with_repeated_terms(self):
        # "data data data science" contains "data data science" (positions 1,2,3) but not "data science data".
        self.assertEqual(order(run("data data science", "phrase")), [("F", 4)])
        self.assertEqual(order(run("data science data", "phrase")), [])

    def test_independent_occurrence_is_not_a_phrase(self):
        self.assertEqual(order(run("programming python", "phrase")), [])


class RecordingPostings(dict):
    """A postings mapping that records which terms were looked up."""

    def __init__(self, data):
        super().__init__(data)
        self.seen = set()

    def get(self, key, default=None):
        self.seen.add(key)
        return super().get(key, default)

    def __getitem__(self, key):
        self.seen.add(key)
        return super().__getitem__(key)


class PostingRetrievalEvidenceTests(unittest.TestCase):
    def test_only_query_term_postings_are_read_and_no_text_is_scanned(self):
        index = build_index(FIXTURES)
        index.postings = RecordingPostings(index.postings)
        parsed = engine.parse_query("zircon quartz", "phrase")
        no_text = AssertionError("document text was tokenised during retrieval")
        with mock.patch("backend.search.preprocess.tokenize", side_effect=no_text), \
                mock.patch("backend.search.engine.tokenize", side_effect=no_text):
            hits = engine.search([("corpus", index)], parsed)["hits"]
        self.assertEqual([h.doc_id for h in hits], ["D"])
        self.assertEqual(index.postings.seen, {"zircon", "quartz"})


class CorpusIndexLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="virelix-lifecycle-"))
        self.corpus = self.tmp / "corpus"
        self.corpus.mkdir()
        for name, text in {"one.txt": "Title: One\n---\nalpha beta beta", "two.txt": "Title: Two\n---\nbeta gamma"}.items():
            (self.corpus / name).write_text(text, encoding="utf-8")
        self.cfg = Config(corpus_dir=self.corpus, data_dir=self.tmp / "data", quiet=True)
        self.db = Database(self.cfg.data_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def service(self):
        return CorpusService(self.cfg, self.db, Auditor(self.db))

    def test_built_at_startup_then_loaded_on_restart(self):
        first = self.service()
        self.assertEqual(first.index_event["reason"], "no stored index")
        self.assertTrue(first.index_path.is_file())
        second = self.service()
        self.assertEqual(second.index_event["event"], "loaded")
        self.assertEqual(second.index.stats()["vocabulary_size"], 5)  # alpha beta gamma one two

    def test_corrupt_incompatible_and_stale_files_are_rebuilt(self):
        svc = self.service()
        svc.index_path.write_text("{not json", encoding="utf-8")
        self.assertIn("unreadable", self.service().index_event["reason"])
        data = json.loads(svc.index_path.read_text(encoding="utf-8"))
        data["format_version"] = 1
        svc.index_path.write_text(json.dumps(data), encoding="utf-8")
        self.assertIn("unreadable", self.service().index_event["reason"])
        (self.corpus / "three.txt").write_text("Title: Three\n---\ndelta", encoding="utf-8")
        svc3 = self.service()
        self.assertEqual(svc3.index_event["reason"], "stored index was built from a different corpus")
        self.assertIn("delta", svc3.index.postings)

    def test_tampered_index_fails_validation_and_is_rebuilt(self):
        svc = self.service()
        data = json.loads(svc.index_path.read_text(encoding="utf-8"))
        term = next(iter(data["postings"]))
        doc_id = next(iter(data["postings"][term]))
        data["postings"][term][doc_id][0] += 7
        svc.index_path.write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual(self.service().index_event["reason"], "stored index failed validation")

    def test_failed_rebuild_keeps_the_previous_index(self):
        svc = self.service()
        before = svc.index
        with mock.patch.object(corpus_module, "build_index", side_effect=ValueError("disk full")):
            (self.corpus / "three.txt").write_text("Title: Three\n---\ndelta", encoding="utf-8")
            svc.reload()
        self.assertIs(svc.index, before)
        self.assertIn("previous index is still in use", svc.index_error)
        self.assertEqual(svc.index_status()["state"], "stale")
        svc.reload()                                     # next successful rebuild recovers
        self.assertIn("delta", svc.index.postings)
        self.assertEqual(svc.index_status()["state"], "current")

    def test_generation_increments_and_index_round_trips(self):
        svc = self.service()
        g = svc.index.settings["generation"]
        svc.rebuild_index({"id": "u", "email": "a@example.test", "role": "admin"})
        self.assertEqual(svc.index.settings["generation"], g + 1)
        reloaded = InvertedIndex.load(svc.index_path)
        self.assertEqual(reloaded.vocabulary(), svc.index.vocabulary())
        self.assertEqual(reloaded.validate(), [])

    def test_empty_corpus_gives_an_empty_working_index(self):
        for f in self.corpus.iterdir():
            f.unlink()
        svc = self.service()
        self.assertEqual(svc.index.stats()["documents"], 0)
        self.assertEqual(engine.search([("corpus", svc.index)], engine.parse_query("beta"))["hits"], [])


if __name__ == "__main__":
    unittest.main()
