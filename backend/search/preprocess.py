"""Text preprocessing.

Pipeline, applied in this order:

1. Unicode NFKC normalisation (folds full-width forms, ligatures such as "ﬁ").
2. Lowercase conversion (``str.casefold`` for language-aware folding).
3. Apostrophe removal inside words ("don't" -> "dont", "user's" -> "users").
4. Punctuation handling: every character that is not a letter or digit
   becomes a space, so "full-text", "full_text" and "full/text" all split.
5. Whitespace normalisation (runs of any whitespace collapse to one space).
6. Tokenisation on single spaces.

Stop-word removal is *optional* and off by default. Whether ranked retrieval
uses it is recorded in the index settings when the index is built.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable

_APOSTROPHES = re.compile(r"(?<=\w)['’`](?=\w)")
_NON_ALNUM = re.compile(r"[^0-9a-zÀ-ɏͰ-ϿЀ-ӿ]+")
_WS = re.compile(r"\s+")

# A compact English stop-word list (articles, auxiliaries, pronouns, prepositions).
STOPWORDS = frozenset(
    """a about above after again against all am an and any are as at be because been
    before being below between both but by can could did do does doing down during each
    few for from further had has have having he her here hers herself him himself his how
    i if in into is it its itself just me more most my myself no nor not now of off on once
    only or other our ours ourselves out over own same she should so some such than that the
    their theirs them themselves then there these they this those through to too under until
    up very was we were what when where which while who whom why will with would you your
    yours yourself yourselves""".split()
)


def normalize_text(text: str | None) -> str:
    """Return lowercase, punctuation-free, whitespace-normalised text."""
    if not text:
        return ""
    if not isinstance(text, str):
        raise TypeError("normalize_text expects str")
    text = unicodedata.normalize("NFKC", text).casefold()
    text = _APOSTROPHES.sub("", text)
    text = _NON_ALNUM.sub(" ", text)
    return _WS.sub(" ", text).strip()


def tokenize(text: str | None, *, remove_stopwords: bool = False, min_length: int = 1) -> list[str]:
    """Split text into normalised tokens, preserving order and duplicates."""
    normalized = normalize_text(text)
    if not normalized:
        return []
    tokens = normalized.split(" ")
    if min_length > 1:
        tokens = [t for t in tokens if len(t) >= min_length]
    if remove_stopwords:
        tokens = [t for t in tokens if t not in STOPWORDS]
    return tokens


def unique_terms(tokens: Iterable[str]) -> list[str]:
    """Deduplicate while keeping first-seen order (useful for query terms)."""
    seen: set[str] = set()
    out = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def split_sentences(text: str) -> list[str]:
    """Rough sentence splitter used by the extractive overview preview."""
    text = _WS.sub(" ", text or "").strip()
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])", text)
    return [p.strip() for p in parts if p.strip()]
