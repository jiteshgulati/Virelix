"""Snippet windows, boundaries, ellipses, phrase handling, fallback and highlight ranges."""

import unittest
from pathlib import Path

from backend.search.loader import load_corpus
from backend.search.preprocess import tokenize, tokenize_with_offsets
from backend.search.snippets import make_snippet

FILLER = "Filler words keep this sentence long enough to push matches apart. " * 6


def marked(s):
    return [s["text"][a:b] for a, b in s["highlights"]]


class OffsetTokenizerTests(unittest.TestCase):
    def test_tokens_match_the_index_pipeline(self):
        for text in ["Don't stop—full-text/full_text", "ﬁle Café café ＰＹＴＨＯＮ", "user’s ß ΣΊΣΥΦΟΣ привет", "", "   "]:
            self.assertEqual([t for t, _, _ in tokenize_with_offsets(text)], tokenize(text), text)

    def test_offsets_point_at_the_raw_text(self):
        text = "  Don't ＰＹＴＨＯＮ café"
        self.assertEqual([text[a:b] for _, a, b in tokenize_with_offsets(text)], ["Don't", "ＰＹＴＨＯＮ", "café"])

    def test_whole_sample_corpus_agrees(self):
        for d in load_corpus(Path("corpus")).documents:
            self.assertEqual([t for t, _, _ in tokenize_with_offsets(d.text)], tokenize(d.text), d.filename)


class SnippetTests(unittest.TestCase):
    def test_highlights_are_exact_ranges_of_matched_words(self):
        s = make_snippet("Indexing makes an Inverted INDEX fast. Nothing else.", ["inverted", "index"])
        self.assertEqual(marked(s), ["Inverted", "INDEX"])       # one range per matched word; "Indexing" isn't "index"
        self.assertEqual(s["kind"], "match")
        self.assertFalse(s["leading_ellipsis"])

    def test_case_punctuation_and_apostrophes_still_highlight(self):
        s = make_snippet("We don't use Python's REPL; (python) works.", ["dont", "pythons", "python"])
        self.assertEqual(marked(s), ["don't", "Python's", "python"])

    def test_window_prefers_the_most_distinct_terms(self):
        text = "alpha here. " + FILLER + "Later alpha and beta appear together. " + FILLER
        s = make_snippet(text, ["alpha", "beta"])
        self.assertEqual(set(t.casefold() for t in marked(s)), {"alpha", "beta"})
        self.assertTrue(s["leading_ellipsis"])
        self.assertTrue(s["trailing_ellipsis"])

    def test_length_and_word_boundaries(self):
        text = FILLER + "The keyword sits in the middle of this sentence. " + FILLER
        s = make_snippet(text, ["keyword"])
        self.assertGreaterEqual(len(s["text"]), 160)
        self.assertLessEqual(len(s["text"]), 240)
        flat = " ".join(text.split())
        self.assertIn(s["text"], flat)                          # verbatim text, whitespace collapsed
        start = flat.index(s["text"])
        end = start + len(s["text"])
        self.assertTrue(start == 0 or flat[start - 1] == " ")    # no half words
        self.assertTrue(end == len(flat) or flat[end] in " .,;:")

    def test_starts_at_a_nearby_sentence(self):
        text = FILLER + "Ranking orders results by score. " + FILLER
        self.assertTrue(make_snippet(text, ["ranking"])["text"].startswith("Ranking orders"))

    def test_match_near_the_end_still_fills_the_snippet(self):
        text = FILLER + "Finally the marker appears."
        s = make_snippet(text, ["marker"])
        self.assertGreaterEqual(len(s["text"]), 160)
        self.assertFalse(s["trailing_ellipsis"])
        self.assertEqual(marked(s), ["marker"])

    def test_phrase_mode_highlights_whole_phrase_only(self):
        text = "Search tools help. An engine runs. A search engine ranks pages."
        s = make_snippet(text, ["search", "engine"], phrase=["search", "engine"])
        self.assertEqual(marked(s), ["search engine"])
        self.assertEqual(marked(make_snippet(text, ["search", "engine"])), ["Search", "engine", "search", "engine"])

    def test_opening_fallback_when_body_has_no_match(self):
        s = make_snippet(FILLER, ["unicorn"])
        self.assertEqual((s["kind"], s["highlights"], s["leading_ellipsis"]), ("opening", [], False))
        self.assertTrue(s["text"].startswith("Filler words"))
        self.assertTrue(s["trailing_ellipsis"])
        self.assertLessEqual(len(s["text"]), 240)

    def test_short_document_is_returned_whole(self):
        s = make_snippet("Short note about kestrels.", ["kestrels"])
        self.assertEqual((s["text"], s["leading_ellipsis"], s["trailing_ellipsis"]), ("Short note about kestrels.", False, False))

    def test_markup_is_returned_as_plain_text(self):
        s = make_snippet("<script>alert(1)</script> python <b>x</b>", ["python"])
        self.assertIn("<script>", s["text"])                    # data, not HTML: the browser escapes it
        self.assertEqual(marked(s), ["python"])

    def test_empty_text(self):
        self.assertEqual(make_snippet("", ["x"])["kind"], "empty")

    def test_corpus_snippets_stay_in_range(self):
        docs = load_corpus(Path("corpus")).documents
        for q in ["inverted index", "hash sorting", "binary search tree", "precision recall", "the"]:
            terms = list(dict.fromkeys(tokenize(q)))
            for d in docs:
                s = make_snippet(d.text, terms)
                if s["kind"] == "match" and len(" ".join(d.text.split())) >= 240:
                    self.assertTrue(160 <= len(s["text"]) <= 240, (q, d.filename, len(s["text"])))
                    self.assertTrue(all(tokenize(h)[0] in terms for h in marked(s)))


if __name__ == "__main__":
    unittest.main()
