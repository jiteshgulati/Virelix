# Limitations and Week 3 handoff

## What ranked retrieval does **not** claim

| Area | Current state | Not yet done |
|---|---|---|
| Ranking | Raw term frequency summed over distinct query terms; ties by title, then ID | Length normalisation, TF-IDF, BM25, field weighting (titles count the same as body text) |
| Text processing | NFKC, case folding, apostrophe joining; stop words kept | Stemming or lemmatisation ("index" and "indexes" are different terms); scripts outside Latin, Greek and Cyrillic aren't tokenised |
| Phrases | Exact consecutive tokens | Proximity or slop ("within 3 words") |
| Snippets | Body text only; one window per result | Multiple fragments; title-only matches show the opening |
| Private index | Rebuilt in memory when a member's attachments change; at most 10 files of 512 KB each | Persistence across restarts (it's rebuilt on the first search) |
| Analytics | Admin page with an honest empty state | Query logging and analysis (this handoff) |
| Search quality | Metric definitions and judgment format | Precision@5, Recall@5, MRR (Week 4) |

Other known limitations:

- An index file from earlier versions (`data/index/foundation.json`) is ignored and can be deleted;
  the current file is `data/index/shared-index.json`.
- `response_time_ms` covers parsing, retrieval, ranking and building the page of results. It
  excludes network time and the session lookup.
- Rate limiters and the login throttle are in memory and reset on restart.

## Week 3 plan: query logging and analysis

1. **Logging point.** `App.h_search` already has every field a log entry needs, after the search
   succeeds: `result["query"]`, `terms`, `mode`, `sort`, `total`, `response_time_ms`, `sources`
   and `categories`. Write an aggregate log (`data/query_log.jsonl`) with no user ID, email or
   attachment content. Searches of private attachments should record only that they included
   attachments, never terms that occur only in private files.
2. **Retention and privacy.** Respect the member's "save history" preference for personal history
   only; the aggregate log is anonymous. Document retention in `architecture.md`.
3. **Analysis.** Put pandas and matplotlib in `requirements-analysis.txt` (development and analysis
   only, not runtime). Read the log and the index (`InvertedIndex.load("data/index/shared-index.json")`):
   top queries, zero-result queries, mode usage, response-time percentiles, and collection-frequency
   ranks for the Zipf plot (`postings` and `cf` are already exposed by `/api/admin/index/vocabulary`).
4. **Interface.** Fill `/admin/analytics` (`frontend/assets/js/views/admin/analytics.js`) from a
   new Admin-only endpoint. Keep the honest empty state when the log is empty.
5. **Tests.** Logging excludes personal data; zero-result queries are logged; disabling personal
   history doesn't disable the aggregate log; the analysis script runs on a fixed sample log.

Code entry points: `backend/app.py` (`h_search`), `backend/services/search.py` (`SearchService.search`
result fields), `backend/search/index.py` (`InvertedIndex.vocabulary`, `collection_frequency`),
`frontend/assets/js/views/admin/analytics.js`.
