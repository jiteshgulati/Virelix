import os
import shutil
import tempfile
import unittest
from pathlib import Path

from backend.config import ROOT
from backend.search.loader import LoaderError, load_corpus, stable_doc_id


class SampleCorpusTests(unittest.TestCase):
    def test_sample_corpus_loads_completely(self):
        report = load_corpus(ROOT / "corpus")
        self.assertEqual(report.counts["loaded"], 31)
        self.assertEqual(report.counts["skipped"], 0)
        ids = [d.doc_id for d in report.documents]
        self.assertEqual(len(ids), len(set(ids)))
        for doc in report.documents:
            self.assertTrue(doc.title)
            self.assertIn("category", doc.metadata)
            self.assertGreater(len(doc.text.split()), 150, doc.filename)

    def test_ids_are_stable(self):
        a = load_corpus(ROOT / "corpus")
        b = load_corpus(ROOT / "corpus")
        self.assertEqual([d.doc_id for d in a.documents], [d.doc_id for d in b.documents])
        self.assertEqual(stable_doc_id("A.txt"), stable_doc_id("a.txt"))


class EdgeCaseTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="virelix-loader-"))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, name: str, data: bytes):
        (self.dir / name).write_bytes(data)

    def test_header_metadata_and_title(self):
        self.write("x.txt", b"Title: Custom Title\nCategory: Testing\nTags: a, b\n---\nBody text here.")
        doc = load_corpus(self.dir).documents[0]
        self.assertEqual(doc.title, "Custom Title")
        self.assertEqual(doc.metadata["tags"], ["a", "b"])
        self.assertEqual(doc.text, "Body text here.")

    def test_title_from_first_line_and_filename(self):
        self.write("a.txt", b"A Short Heading\n\nSome longer body text follows here.")
        self.write("02-long_name-file.txt", b"This first line is a full sentence that ends with a period.\nMore.")
        docs = {d.filename: d for d in load_corpus(self.dir).documents}
        self.assertEqual(docs["a.txt"].title, "A Short Heading")
        self.assertEqual(docs["02-long_name-file.txt"].title, "Long Name File")

    def test_empty_files_are_skipped(self):
        self.write("empty.txt", b"")
        self.write("blank.txt", b"   \n\t\n")
        self.write("header-only.txt", b"Title: Nothing\n---\n")
        report = load_corpus(self.dir)
        self.assertEqual(report.counts["loaded"], 0)
        self.assertEqual({s.reason for s in report.skipped}, {"empty"})
        self.assertEqual(report.counts["skipped"], 3)

    def test_unsupported_types_are_skipped(self):
        self.write("paper.pdf", b"%PDF-1.4")
        self.write("notes.docx", b"PK..")
        self.write("ok.txt", b"Fine content.")
        report = load_corpus(self.dir)
        self.assertEqual(report.counts["loaded"], 1)
        self.assertEqual(sorted(s.reason for s in report.skipped), ["unsupported_type", "unsupported_type"])

    def test_binary_content_is_rejected(self):
        self.write("image.txt", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
        report = load_corpus(self.dir)
        self.assertEqual(report.skipped[0].reason, "binary")

    def test_cp1252_fallback_with_warning(self):
        self.write("legacy.txt", "Café — résumé".encode("cp1252"))
        doc = load_corpus(self.dir).documents[0]
        self.assertEqual(doc.encoding, "cp1252")
        self.assertIn("café", doc.text.lower())
        self.assertTrue(doc.warnings)

    def test_utf8_bom_and_utf16(self):
        self.write("bom.txt", "﻿Hello BOM".encode("utf-8"))
        self.write("wide.txt", "Hello UTF-16 text".encode("utf-16"))
        docs = {d.filename: d for d in load_corpus(self.dir).documents}
        self.assertEqual(docs["bom.txt"].text, "Hello BOM")
        self.assertEqual(docs["wide.txt"].encoding, "utf-16")

    def test_crlf_and_control_characters(self):
        self.write("crlf.txt", b"Line one\r\nLine\x07 two\r\n")
        doc = load_corpus(self.dir).documents[0]
        self.assertEqual(doc.text, "Line one\nLine two")

    def test_hidden_files_and_subfolders_ignored(self):
        self.write(".hidden.txt", b"secret")
        (self.dir / "sub").mkdir()
        (self.dir / "sub" / "inner.txt").write_text("nested")
        self.assertEqual(load_corpus(self.dir).counts["discovered"], 0)

    def test_missing_folder(self):
        with self.assertRaises(LoaderError):
            load_corpus(self.dir / "nope")

    def test_path_is_a_file(self):
        self.write("f.txt", b"x")
        with self.assertRaises(LoaderError):
            load_corpus(self.dir / "f.txt")

    @unittest.skipIf(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0), "permission semantics")
    def test_unreadable_file(self):
        self.write("locked.txt", b"content")
        os.chmod(self.dir / "locked.txt", 0)
        try:
            if os.access(self.dir / "locked.txt", os.R_OK):
                self.skipTest("filesystem ignores permissions")
            report = load_corpus(self.dir)
            self.assertEqual(report.skipped[0].reason, "unreadable")
        finally:
            os.chmod(self.dir / "locked.txt", 0o644)


if __name__ == "__main__":
    unittest.main()
