import unittest

from backend.search.preprocess import normalize_text, split_sentences, tokenize, unique_terms


class NormalizeTests(unittest.TestCase):
    def test_lowercases(self):
        self.assertEqual(normalize_text("Inverted INDEX"), "inverted index")

    def test_punctuation_becomes_separators(self):
        self.assertEqual(tokenize("full-text, search; engines!"), ["full", "text", "search", "engines"])
        self.assertEqual(tokenize("a/b_c.d"), ["a", "b", "c", "d"])

    def test_whitespace_is_normalized(self):
        self.assertEqual(normalize_text("  many\t\tspaces\n\nhere  "), "many spaces here")

    def test_apostrophes_inside_words_are_removed(self):
        self.assertEqual(tokenize("Don't stop the user's query"), ["dont", "stop", "the", "users", "query"])
        self.assertEqual(tokenize("It’s curly"), ["its", "curly"])

    def test_unicode_compatibility_forms(self):
        self.assertEqual(tokenize("ﬁle ＡＢＣ"), ["file", "abc"])  # ligature + full-width

    def test_accented_letters_are_kept(self):
        self.assertEqual(tokenize("Café naïve"), ["café", "naïve"])

    def test_numbers_are_tokens(self):
        self.assertEqual(tokenize("Python 3.14 in 2026"), ["python", "3", "14", "in", "2026"])


class EdgeCaseTests(unittest.TestCase):
    def test_empty_and_none(self):
        self.assertEqual(tokenize(""), [])
        self.assertEqual(tokenize(None), [])
        self.assertEqual(normalize_text(None), "")

    def test_punctuation_only(self):
        self.assertEqual(tokenize("!!! ... ---"), [])

    def test_whitespace_only(self):
        self.assertEqual(tokenize(" \n\t "), [])

    def test_non_string_rejected(self):
        with self.assertRaises(TypeError):
            normalize_text(42)  # type: ignore[arg-type]

    def test_duplicates_preserved_in_order(self):
        self.assertEqual(tokenize("index the index"), ["index", "the", "index"])

    def test_optional_stopword_removal(self):
        self.assertEqual(tokenize("the index of the corpus", remove_stopwords=True), ["index", "corpus"])

    def test_min_length(self):
        self.assertEqual(tokenize("a an index", min_length=3), ["index"])

    def test_unique_terms_keep_first_order(self):
        self.assertEqual(unique_terms(["b", "a", "b", "c", "a"]), ["b", "a", "c"])

    def test_sentence_split(self):
        self.assertEqual(split_sentences("One here. Two there! Three?"), ["One here.", "Two there!", "Three?"])
        self.assertEqual(split_sentences(""), [])


if __name__ == "__main__":
    unittest.main()
