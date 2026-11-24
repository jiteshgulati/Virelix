"""Query-aware snippets with structured highlights.

``make_snippet`` picks the passage of a document that best shows why it matched:

1. Find query-term occurrences with ``tokenize_with_offsets`` (the same
   normalisation used by the index, so highlights agree with what matched).
   In exact-phrase mode, each occurrence of the whole phrase is one match.
2. Choose the window (at most ``max_chars`` of raw text) containing the most
   distinct query terms, then the most matches, then the earliest position.
3. Start at a sentence beginning when one is close before the first match,
   otherwise at a word boundary with some leading context. End at a sentence or
   word boundary. Words are never cut in half.
4. Collapse whitespace and add ellipsis flags where text was cut.
5. If nothing in the body matches (for example, the match is in the title
   only), return the document's opening instead.

The result is data, not HTML: ``text`` plus ``highlights`` as ``[start, end)``
character ranges into ``text``. The browser escapes the text and wraps the
ranges in ``<mark>`` itself.
"""

from __future__ import annotations

import re

from backend.search.preprocess import tokenize_with_offsets

DEFAULT_CHARS = 220          # visible snippets land between about 160 and 240 characters
MIN_CHARS = 160
MAX_CANDIDATE_MATCHES = 400  # bound the window search on very repetitive documents
_SENTENCE_END = re.compile(r"[.!?][\"')\]’”]*\s+")


def _matches(text: str, terms: list, phrase: list | None) -> list[tuple[int, int, frozenset]]:
    """``[(start, end, terms_covered)]`` in text order."""
    tokens = tokenize_with_offsets(text)
    if phrase and len(phrase) > 1:
        k = len(phrase)
        out = []
        i = 0
        while i <= len(tokens) - k:
            if all(tokens[i + j][0] == phrase[j] for j in range(k)):
                out.append((tokens[i][1], tokens[i + k - 1][2], frozenset(phrase)))
                i += k
            else:
                i += 1
        return out
    wanted = set(terms)
    return [(s, e, frozenset((t,))) for t, s, e in tokens if t in wanted]


def _best_window(matches: list, max_chars: int) -> list:
    """The run of consecutive matches that fits in ``max_chars`` and scores best."""
    matches = matches[:MAX_CANDIDATE_MATCHES]
    best_key, best = None, matches[:1]
    for i, first in enumerate(matches):
        covered: set = set()
        run = []
        for m in matches[i:]:
            if m[1] - first[0] > max_chars:
                break
            run.append(m)
            covered |= m[2]
        key = (-len(covered), -len(run), first[0])
        if best_key is None or key < best_key:
            best_key, best = key, run
    return best


def _word_start(text: str, pos: int, limit: int) -> int:
    """Move ``pos`` forward to the start of a word (not past ``limit``)."""
    if pos <= 0:
        return 0
    if text[pos - 1].isspace():
        return pos
    nxt = re.search(r"\s", text[pos:limit])
    return pos + nxt.end() if nxt else limit


def _word_end(text: str, pos: int, floor: int) -> int:
    """Move ``pos`` back to the end of a word (not before ``floor``)."""
    if pos >= len(text) or text[pos].isspace():
        return pos
    cut = max(text.rfind(" ", floor, pos), text.rfind("\n", floor, pos))
    return cut if cut > floor else pos


def _collapse(text: str, start: int, end: int, ranges: list) -> tuple[str, list]:
    """Collapse whitespace in ``text[start:end]`` and remap highlight ranges."""
    out, index_map = [], {}
    prev_space = True
    for k in range(start, end):
        ch = text[k]
        if ch.isspace():
            if not prev_space:
                out.append(" ")
            prev_space = True
            index_map[k] = len(out)
            continue
        index_map[k] = len(out)
        out.append(ch)
        prev_space = False
    while out and out[-1] == " ":
        out.pop()
    collapsed = "".join(out)
    mapped = []
    for s, e in ranges:
        if s < start or e > end:
            continue
        ms, me = index_map[s], index_map[e - 1] + 1
        if mapped and ms <= mapped[-1][1]:
            mapped[-1][1] = max(mapped[-1][1], me)
        else:
            mapped.append([ms, me])
    return collapsed, mapped


def _opening(text: str, max_chars: int) -> dict:
    body = text.strip()
    lead = len(text) - len(text.lstrip())
    end = lead + min(len(body), max_chars)
    if end < len(text):
        end = _word_end(text, end, lead + MIN_CHARS // 2)
    snippet, _ = _collapse(text, lead, end, [])
    snippet = snippet.rstrip(",;:")
    return {"text": snippet, "highlights": [], "leading_ellipsis": False,
            "trailing_ellipsis": end < len(text.rstrip()), "kind": "opening"}


def make_snippet(text: str, terms, *, phrase=None, max_chars: int = DEFAULT_CHARS) -> dict:
    """Return ``{text, highlights, leading_ellipsis, trailing_ellipsis, kind}``.

    ``terms``: distinct normalised query terms. ``phrase``: the normalised token
    sequence for exact-phrase searches (``None`` otherwise).
    """
    text = text or ""
    if not text.strip():
        return {"text": "", "highlights": [], "leading_ellipsis": False, "trailing_ellipsis": False, "kind": "empty"}
    matches = _matches(text, list(terms), list(phrase) if phrase else None)
    if not matches:
        return _opening(text, max_chars)

    run = _best_window(matches, max_chars)
    first, last = run[0][0], run[-1][1]
    slack = max(0, max_chars - (last - first))
    text_start = len(text) - len(text.lstrip())
    text_end = len(text.rstrip())

    # Start: a nearby sentence beginning if it keeps the matches in view, else some context.
    start = None
    look_from = max(text_start, first - slack)
    for m in _SENTENCE_END.finditer(text, look_from, first):
        start = m.end()                      # keep the last boundary before the first match
    if start is None and first - text_start <= slack:
        start = text_start                   # the document's opening is close enough
    if start is None:
        start = _word_start(text, max(text_start, first - min(slack // 2, 70)), first)

    # End: fill to max_chars, prefer a sentence end, never cut a word or a match.
    end = min(text_end, start + max_chars)
    if end < last:
        end = last
    if end < text_end:
        sentence_ends = [m.start() + 1 for m in _SENTENCE_END.finditer(text, last, end)]
        good = [p for p in sentence_ends if p - start >= MIN_CHARS]
        end = good[-1] if good else _word_end(text, end, last)

    # Near the end of a document there's little text after the match: extend backwards instead.
    if end - start < MIN_CHARS and start > text_start:
        floor = max(text_start, end - max_chars)
        earlier = [m.end() for m in _SENTENCE_END.finditer(text, floor, start)]
        if floor == text_start:
            start = text_start
        elif earlier and end - earlier[0] >= MIN_CHARS:
            start = earlier[0]
        else:
            start = _word_start(text, floor, first)

    snippet, highlights = _collapse(text, start, end, [(s, e) for s, e, _ in run])
    trimmed = snippet.rstrip(",;:")
    return {"text": trimmed, "highlights": [h for h in highlights if h[1] <= len(trimmed)],
            "leading_ellipsis": start > text_start, "trailing_ellipsis": end < text_end, "kind": "match"}
