# Limitations and Week 2 handoff

## What Week 1 does **not** claim

| Area | Current state | Not yet done |
|---|---|---|
| Search results | Discovery preview: a linear scan over each document's token set; matching modes all, any and phrase | Index-backed retrieval, TF ranking, relevance ordering |
| Ordering | By number of distinct query terms matched (a count shown to the user), or title/date | Any relevance score |
| Excerpts | Document's metadata summary or opening ~280 characters, with matched words highlighted | Query-dependent snippet generation |
| Inverted index | Data model, population from the corpus, JSON persistence, inspection UI (vocabulary, DF/CF, postings with TF and positions), stale detection | Use by the search API; incremental updates on upload or remove (Admins rebuild manually); compression |
| AI Overview | Extractive: verbatim sentences chosen by distinct-term count, with references | Generative answers, RAG, semantic or hybrid search (after Week 4) |
| Web/Academic/Code/Images/Videos/Books | Clearly marked "not connected" | Any external source |
| Analytics | Page structure with an honest empty state | Query logging, pandas, matplotlib (Week 3) |
| Search quality | Metric definitions, prerequisites, judgment format | Precision@5, Recall@5, MRR (Week 4) |
| Email | Development mailbox (console and key-protected page, never delivered) | SMTP or provider integration |
| Accounts | Email can't be changed; no "delete my account"; no 2FA | Planned product work |
| Scale | JSON files and in-memory corpus suit a coursework corpus | A database for many users or large corpora |

Other known limitations:

- The login throttle and rate limiters are in memory, so they reset when the server restarts.
- `VIRELIX_SECRET_KEY` is read but not yet used; nothing in Week 1 relies on a signing key.
- Attachments expire 24 hours after upload. Expired ones are purged when the owner next lists or searches them.
- Removed corpus documents are moved to `data/removed_documents/`; there's no in-app restore.
- Browser tests on WSL/Linux need Chromium's system libraries (`npx playwright install-deps`).

## Week 2 plan

1. **Construction pipeline.** Build the index at start-up (or load `data/index/foundation.json` when its corpus signature matches), and rebuild automatically after uploads and removals (`CorpusService.upload/remove` → `InvertedIndex.add_document/remove_document`).
2. **Query processing.** Reuse `preprocess.tokenize` for queries; decide stop-word handling (the `remove_stopwords` setting already exists and is recorded in index stats); look up `postings_for(term)`.
3. **Retrieval.** AND: intersect posting doc-ID sets, shortest list first (DF is available). OR: union. Phrase: positional check using the stored `positions`.
4. **Ranking.** Score with term frequency (raw TF summed over query terms, optionally `1 + log tf`), with a tie-break on title. Expose `score` per result and add *Relevance* to the sort menu (`SORTS` in `frontend/assets/js/views/search.js`).
5. **Snippets.** Choose the window around the densest cluster of query-term positions; return `snippet` and keep highlighting client-side.
6. **Integration.** Swap `preview.search` for the index path in `App.h_search`. The response shape stays the same, plus `score` and `snippet`, so the UI needs only the new sort option and snippet field.
7. **Tests.** Extend `tests/backend/test_index_preview.py` with retrieval and ranking cases on a fixed mini-corpus, and add Week 2 acceptance tests.

Code entry points: `backend/search/index.py` (`InvertedIndex`, `initialize_foundation`), `backend/services/corpus.py` (`rebuild_index`, `index_status`), `backend/app.py` (`h_search`), `frontend/assets/js/views/search.js` (`runAll`, `resultItem`).
