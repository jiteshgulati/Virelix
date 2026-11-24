# Week 2 acceptance checklist: Ranked Retrieval and Search Experience

Each requirement points to the code that implements it and the tests that check it. Verified
counts and run details are in [test-results.md](test-results.md). Academic milestone language
stays in this file; the application itself describes these features in product terms.

## Index construction and lifecycle

| Requirement | Implementation | Evidence |
|---|---|---|
| Inverted index: term → postings with term frequency and positions | `backend/search/index.py` (`Posting`, `InvertedIndex`, `build_index`) | `test_index.py` |
| Index validated on load (TF matches positions, known documents, lengths agree) | `InvertedIndex.validate` | `test_index.py::test_validate_detects_inconsistency`, `test_search_engine.py::CorpusIndexLifecycleTests::test_tampered_index_fails_validation_and_is_rebuilt` |
| Built at start-up when missing; loaded when current | `CorpusService._load_or_rebuild_index` | `CorpusIndexLifecycleTests::test_built_at_startup_then_loaded_on_restart` |
| Rebuilt when corrupt, an older format or stale | same | `CorpusIndexLifecycleTests::test_corrupt_incompatible_and_stale_files_are_rebuilt` |
| Atomic rebuild: build → validate → atomic save → swap; failure keeps the old index | `CorpusService._rebuild_locked`, `storage.atomic_write_text` | `CorpusIndexLifecycleTests::test_failed_rebuild_keeps_the_previous_index` |
| Upload and removal update search immediately | `CorpusService.reload` after `upload`/`remove` | `test_search_api.py::RankedSearchApiTests::test_upload_and_removal_are_searchable_immediately`, `test_api_workspace.py::AdminCorpusTests::test_upload_index_and_remove` |
| No rebuild per search | `SearchService` reads `CorpusService.snapshot()` only | Code path; `PostingRetrievalEvidenceTests` (no document text is tokenised during retrieval) |
| Headerless titles not counted twice | `index.indexable_text` | `test_index.py::test_headerless_title_is_not_counted_twice` |
| Admin index page shows genuine state and a working rebuild | `views/admin/index.js`, `GET /api/admin/index`, `POST /api/admin/index/rebuild` | `admin.spec.js` › document index: rebuild, inspect vocabulary and postings |

## Query processing and retrieval

| Requirement | Implementation | Evidence |
|---|---|---|
| Same normalisation for queries and documents | `engine.parse_query` → `preprocess.tokenize` | `QueryParsingTests::test_normalisation_matches_document_pipeline`, `test_unicode_and_sort_alias` |
| Empty, punctuation-only, over-long and over-complex queries rejected clearly | `engine.parse_query` | `QueryParsingTests::test_invalid_queries`, `RankedSearchApiTests::test_validation_errors`, `search.spec.js` › empty, invalid and no-result queries |
| Any term (default for new accounts), All terms, Exact phrase | `engine.retrieve` | `RankingTests`, `PhraseTests`, `RankedSearchApiTests::test_modes`, `test_new_accounts_default_to_any_terms` |
| Saved preferences preserved | `DEFAULT_PREFS` is only a fallback under stored prefs | `RankedSearchApiTests::test_new_accounts_default_to_any_terms`; stored prefs untouched by design |
| Retrieval uses posting lists, not a linear scan | `engine.retrieve` reads `index.postings` for the query terms only | `PostingRetrievalEvidenceTests::test_only_query_term_postings_are_read_and_no_text_is_scanned` |
| Phrase matching with positions, including repeated tokens | `engine._contains_phrase` | `PhraseTests::test_phrase_with_repeated_terms`, `test_independent_occurrence_is_not_a_phrase` |

## Ranking

| Requirement | Implementation | Evidence |
|---|---|---|
| `Score(d,q) = Σ TF(t,d)` over distinct normalised query terms | `engine.retrieve` | `RankingTests::test_prd_example_any_terms` (A=5, B=2, C=1, counted by hand) |
| All terms excludes partial matches (A, B only) | `engine.retrieve` | `RankingTests::test_all_terms_excludes_partial_matches` |
| Repeated query terms don't inflate scores | distinct terms in `ParsedQuery.terms` | `RankingTests::test_repeated_query_terms_do_not_inflate_scores` |
| Ties broken by case-folded title, then document ID | `engine.rank` | `RankingTests::test_equal_scores_break_ties_by_title_then_id`, `test_deterministic_across_runs_and_insertion_orders` |
| Filters, sorting and pagination over the full ranked set | `engine.rank` then slicing in `SearchService.search` | `RankingTests::test_alternative_sorts_cover_the_full_result_set`, `RankedSearchApiTests::test_pagination_is_complete_stable_and_ranked_before_paging`, `ranked.spec.js` › full ranked set is paginated and re-sorted |
| API returns score, per-term frequencies, matched and missing terms | `SearchService._result_view` | `RankedSearchApiTests::test_scores_and_order_match_the_hand_counted_fixture` |
| Real `response_time_ms` from a monotonic timer | `time.perf_counter` in `SearchService.search` | same test (type and range); shown in the results header |

## Private attachments

| Requirement | Implementation | Evidence |
|---|---|---|
| Attachments never enter the shared index | separate `WorkspaceService.private_index` | `PrivateIndexIsolationTests::test_private_documents_are_ranked_but_only_for_their_owner` (shared vocabulary and postings checked) |
| No cross-user visibility, including Admin and Owner | private index keyed by the session's user ID | same test (another member and the Owner), `workspace.spec.js` › attachments are invisible to other members |
| Removed and expired attachments not searchable | cache keyed by the current attachment set, after expiry purge | `PrivateIndexIsolationTests::test_removed_and_expired_attachments_leave_the_private_index` |

## Snippets

| Requirement | Implementation | Evidence |
|---|---|---|
| About 160–240 characters, word and sentence boundaries | `snippets.make_snippet` | `SnippetTests::test_length_and_word_boundaries`, `test_starts_at_a_nearby_sentence`, `test_corpus_snippets_stay_in_range` |
| Ellipses where text is cut | `leading_ellipsis` / `trailing_ellipsis` | `SnippetTests::test_window_prefers_the_most_distinct_terms` |
| Multi-term windows | `_best_window` (distinct terms, then matches, then earliest) | `SnippetTests::test_window_prefers_the_most_distinct_terms` |
| Phrase handling | phrase occurrences highlighted as one range | `SnippetTests::test_phrase_mode_highlights_whole_phrase_only`, `RankedSearchApiTests::test_results_carry_structured_snippets` |
| Opening-excerpt fallback | `_opening` | `SnippetTests::test_opening_fallback_when_body_has_no_match` |
| Highlights agree with the index's normalisation | `preprocess.tokenize_with_offsets` | `OffsetTokenizerTests` (whole sample corpus) |
| Safe structured highlighting, not HTML | ranges → `highlightRanges` (escapes every segment) | `SnippetTests::test_markup_is_returned_as_plain_text`, `ranked.spec.js` › attachment text is rendered as text, never as markup |

## Interface

| Requirement | Implementation | Evidence |
|---|---|---|
| Score shown with an explanation; never a percentage | `vx-score` chip, per-term `×n`, "How results are ranked" | `ranked.spec.js` › scores are shown, explained, ordered and equal to the per-term counts |
| Highlighted snippets | `snippetBlock` in `views/search.js` | `ranked.spec.js` › snippets highlight the matched words |
| Relevance sort (default); earlier links still work | `SORTS`, `SORT_ALIASES` | `ranked.spec.js` (sort=coverage link) |
| Extractive overview from ranked hits | `SearchService.overview` | `RankedSearchApiTests::test_overview_quotes_top_ranked_documents`, `search.spec.js` › category tabs: extractive overview |
| Professional wording, no milestone language in the app | help, home, settings, admin pages | `professional.spec.js`, `TerminologyTests` |
| Accessible in every theme | axe on key pages | `responsive-a11y.spec.js` |

## Platform and workflow

| Requirement | Evidence |
|---|---|
| CI: Linux backend, native Windows backend, start-up smoke test, Playwright Chromium | `.github/workflows/ci.yml` |
| Concurrency cancellation, read-only permissions, job timeouts | `ci.yml` (`concurrency`, `permissions: contents: read`, `timeout-minutes`) |
| Native Windows compatibility | Backend suite and `scripts/smoke_test.py` on Windows Python (see test-results.md) |
| No new runtime dependencies | `requirements.txt` unchanged (standard library only) |
| Two pull requests, cross-reviewed | `feature/ranked-retrieval` (Jitesh), `feature/search-experience` (Chaitain) |

## Out of scope (not started)

Query-log analytics, pandas, Zipf charts, Precision@5, Recall@5, MRR, benchmarking, TF-IDF,
BM25, semantic search and deployment are not part of this milestone.
