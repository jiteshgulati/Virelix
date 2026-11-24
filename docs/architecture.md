# Virelix — Requirements and Architecture (Week 1)

Project PST_AD_164 · Search Engine Backend (Mini Elasticsearch) · Team G393 · four-week plan, Week 1 deliverable.

## 1. Problem statement

People who work with a body of documents, such as course notes, technical articles or reports, need to
find which documents discuss a topic, see *where* and *why* a document matched, and keep what they
find. General web search can't see a private corpus, and opaque relevance scores make it hard to trust
or debug results. The academic goal is to build, from first principles, the core of a search engine:
document loading, text preprocessing, an inverted index, term-frequency retrieval and ranking, and
later query analysis and evaluation. Virelix wraps that engine in a usable product with accounts,
roles and personal workspaces.

## 2. Objectives

| # | Objective | Milestone |
|---|---|---|
| O1 | Load a TXT corpus robustly, with stable IDs and metadata | Week 1 ✔ |
| O2 | Preprocess text consistently for documents and queries | Week 1 ✔ |
| O3 | Define and inspect the inverted-index data structure | Week 1 ✔ (foundation) |
| O4 | Provide a usable search interface, honest about its current capability | Week 1 ✔ (preview) |
| O5 | Full index construction, query processing, TF ranking, snippets | Week 2 ✔ (retrieval and ranking; snippets with the search experience) |
| O6 | Aggregate query logging; pandas analysis; Zipf and top-term charts | Week 3 |
| O7 | Precision@5, Recall@5, MRR; edge cases; performance; report and demo | Week 4 |

## 3. Target users

- **Members (students, researchers):** search the shared corpus, read documents, save and organise them, explore private notes.
- **Admins (course staff, maintainers):** curate the shared corpus, (re)build the document index, moderate member accounts.
- **Owner (project lead):** one designated account that governs who holds Admin access.
- **Evaluators:** review code, tests and documentation against the PRD.

## 4. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR1 | Discover `.txt` documents in a configured folder; report counts, sizes and skipped files with reasons | Done |
| FR2 | Assign stable document IDs (`doc-` + SHA-1 of case-folded filename) | Done |
| FR3 | Extract titles and metadata from an optional `Key: value` header; fall back to first line, then filename | Done |
| FR4 | Handle empty, unsupported, binary, oversized, non-UTF-8, unreadable files and missing folders | Done |
| FR5 | Preprocess: NFKC, case folding, apostrophe joining, punctuation to space, whitespace collapse, tokenise | Done |
| FR6 | Inverted index: terms → postings (doc ID, TF, positions); document records; vocabulary stats; validated, versioned JSON persistence; automatic lifecycle | Done |
| FR7 | Search UI: query, clear, categories, floating filters, sort, pagination, result actions, follow-up refine | Done |
| FR8 | Extractive overview with genuine references; save answer | Done |
| FR9 | Accounts: register, verify email, sign in or out, remember me, reset password, change password, sessions | Done |
| FR10 | Roles: Member/Admin/Owner enforced in the backend; Owner from `OWNER_EMAIL`; Admin by invitation | Done |
| FR11 | Workspace: history, saved results, collections, private attachments, preferences, in-app notifications | Done |
| FR12 | Admin: overview, global documents, index management, users, analytics (Week 3 state), quality (Week 4 state), system | Done |
| FR13 | Ranked retrieval with TF (posting-list retrieval; any, all, exact phrase); private per-user index; snippets | Done (Week 2) |
| FR14 | Aggregate query logging and analysis | **Week 3** |
| FR15 | Retrieval evaluation | **Week 4** |

## 5. Non-functional requirements

- **Stack:** Python 3 standard library backend; HTML5, CSS3, Bootstrap 5 and vanilla ES modules frontend; JSON and filesystem persistence; no build step.
- **Security:** scrypt password hashing, hashed single-use tokens, HttpOnly SameSite=Strict session cookies, CSRF double-submit plus Origin check, login throttling, strict CSP, static allow-list, per-user isolation, audit log.
- **Integrity:** atomic writes (temp file, fsync, `os.replace`), per-store locks, server-side validation on every input.
- **Honesty:** no fabricated scores, results, analytics, deliveries or AI output; unavailable features say so. Scores are raw term-frequency counts, never shown as percentages.
- **Accessibility:** WCAG 2.1 AA target. Semantic HTML, labels, focus management, ≥4.5:1 text contrast, reduced-motion support; automated axe checks.
- **Responsiveness:** usable from 320 px to 1920 px; verified at 1920, 1440, 1024, 768, 390 and 320.
- **Performance:** the corpus and its index are held in memory. Measured locally (Python 3.14, WSL2, OneDrive-synced folder, 31 documents, 2,073 terms): loading the files takes about 240 ms and building the index about 17 ms. Retrieval and ranking for a typical two-word query take well under a millisecond (median about 0.04 ms in Any mode, 0.01 ms in All or Exact phrase). Every search response reports its own `response_time_ms`, measured with a monotonic clock. Formal benchmarking is a Week 4 task.

## 6. Core modules

```
            ┌──────────────── Browser (SPA, ES modules) ─────────────────┐
            │ router · api client (CSRF) · views · Bootstrap components  │
            └───────────────▲───────────────────────────┬────────────────┘
                 JSON / raw-text uploads (same origin)   │ static assets (allow-listed)
            ┌───────────────┴───────────────────────────▼────────────────┐
            │ server.py  ThreadingHTTPServer · security headers · SPA     │
            │ app.py     router · session resolution · CSRF · role gate   │
            ├────────────┬──────────────┬──────────────┬─────────────────┤
            │ auth       │ governance   │ corpus       │ workspace       │
            │ (accounts, │ (invitations,│ (shared docs,│ (history, saved,│
            │ sessions,  │ users, audit)│ index        │ collections,    │
            │ tokens)    │              │ lifecycle)   │ attachments)    │
            ├────────────┴──────────────┴──────┬───────┴─────────────────┤
            │ services/search.py: shared + private index → ranked results │
            │ search/: loader · preprocess · index · engine · overview   │
            ├───────────────────────────────────┴────────────────────────┤
            │ storage.py: atomic JSON stores in data/ · corpus/ folder   │
            └────────────────────────────────────────────────────────────┘
```

| Module | Responsibility |
|---|---|
| `backend/search/loader.py` | Discovery, decoding, metadata, stable IDs, load report |
| `backend/search/preprocess.py` | Normalisation and tokenisation (shared by documents and queries) |
| `backend/search/index.py` | `Posting`, `DocumentRecord`, `InvertedIndex` (with `validate`), `build_index` |
| `backend/search/engine.py` | Query parsing, posting-list retrieval (any, all, exact phrase), term-frequency scoring and deterministic ranking |
| `backend/search/overview.py` | Extractive overview over ranked hits; opening excerpts |
| `backend/services/search.py` | Combines the shared index and the caller's private index; filters, sorts, paginates; measures response time |
| `backend/services/auth.py` | Registration, verification, login, sessions, reset, owner reconciliation |
| `backend/services/governance.py` | Owner-only invitations; Admin user management; suspension |
| `backend/services/corpus.py` | Shared corpus; index lifecycle (load, validate, rebuild atomically on change), status and inspection |
| `backend/services/workspace.py` | Per-user history, saved items, collections, attachments, preferences; private per-user attachment index |
| `backend/services/mailer.py` | Development mailbox (stored and printed; never delivered) |
| `frontend/assets/js/core` | Router with guards, API client, safe templating, preferences |

## 7. Frontend/backend interaction

- The browser loads one HTML shell; the router lazy-loads view modules (`/assets/js/views/*.js`).
- On boot, on any `403`, on navigation (at most every 15 s) and on back/forward-cache restores, the client calls `GET /api/auth/session` so role and status changes made by the server are reflected immediately.
- On boot the client calls `GET /api/auth/session`. Every response sets a non-HttpOnly `vx_csrf` cookie if one is missing.
- State-changing requests send `X-CSRF-Token` matching that cookie. The server also rejects mismatched `Origin` headers.
- The session is an HttpOnly `vx_session` cookie (random 256-bit token; only its SHA-256 is stored).
- File uploads send raw bytes (`Content-Type: text/plain`, `X-Filename`), so no multipart parsing is needed.
- Role checks happen in the route table (`auth="user"|"admin"|"owner"`) **and** again inside services for privileged operations.

## 8. Data structures

```python
# Inverted index (backend/search/index.py)
postings:  dict[str, dict[str, Posting]]      # term -> doc_id -> Posting
Posting(doc_id: str, tf: int, positions: list[int])
DocumentRecord(doc_id, title, filename, length, unique_terms, metadata, modified)
stats(): documents, vocabulary_size, total_tokens, postings, average_document_length, hapax_terms

# Loader
Document(doc_id, filename, title, text, metadata, size_bytes, modified, encoding, warnings)
LoadReport(folder, documents[], skipped[SkippedFile(filename, reason, detail)], loaded_at)
```

Persistent JSON stores in `data/`: `users.json` (id → user), `sessions.json` (token-hash → session),
`tokens.json` (token-hash → verify or reset record), `invitations.json`, `workspace.json`
(user → history, saved, collections, attachment metadata), `notifications.json`, `dev_outbox.json`,
`audit.log.jsonl`, `index/shared-index.json`, `attachments/<user>/<id>.txt`, `removed_documents/`.

## 8a. Ranked retrieval

**Query processing.** A query goes through the same `preprocess.tokenize` pipeline as documents
(NFKC, case folding, apostrophe joining, punctuation to space). The engine keeps two views:
the token sequence, with duplicates, for phrase matching, and the *distinct* terms, in first-seen
order, for scoring. Queries are limited to 300 characters and 24 distinct terms.

**Retrieval** reads only the posting lists of the query terms. Document text is never scanned
to find matches.

| Mode | Candidate set |
|---|---|
| Any term (default for new accounts) | Union of the terms' posting lists |
| All terms | Intersection, starting from the term with the lowest document frequency |
| Exact phrase | All-terms intersection, then a positional check that the tokens occur consecutively and in order (repeated tokens handled) |

**Scoring.** `Score(d, q) = Σ tf(t, d)` over the distinct terms `t` of `q`. Repeating a word in the
query doesn't raise any score. Titles are indexed with the body (a title taken from the first line
isn't counted twice). A score is a count of occurrences, not a probability or percentage.

**Ranking.** Score descending, then case-folded title, then document ID, so the order is fully
deterministic. Title and date sorts are alternatives. Category filters apply before ranking, and
pagination applies after ranking to the complete result set. Only the requested page's documents
are read to build result views.

**Shared index lifecycle** (`CorpusService`):

| Situation | Behaviour |
|---|---|
| Start-up, index file current | Loaded and validated (TF matches positions, postings reference known documents, lengths agree) |
| Missing, unreadable, older format, failed validation, or built from a different corpus | Rebuilt from the loaded documents and saved |
| Document uploaded or removed, or corpus reloaded | Rebuilt immediately, so search always reflects the current corpus |
| Administrator rebuild | Same path; the generation number increases |
| Rebuild fails | The previous index stays in service; the error is shown on the admin index page |

Every rebuild builds a complete new index, validates it, writes it atomically (temp file, fsync,
`os.replace`) and only then swaps it in under the service lock. Searches take a consistent snapshot
(index and documents together) and never trigger a rebuild.

**Private index.** Each member's attachments get a separate in-memory index, built only from that
member's files and cached until their set of attachments changes (upload, removal, clearing or
24-hour expiry). It's never merged into the shared index, never written to disk, and never
reachable through administration endpoints. Admins and the Owner can't see other members'
attachments in search, vocabulary or postings. Results from both indexes are merged by score,
because each score is a plain count within one document.


## 9. Roles and permissions

The authoritative permission matrix and onboarding workflow are in [roles-and-onboarding.md](roles-and-onboarding.md).

## 10. API contracts

See [api.md](api.md). Errors always have the shape `{"error": {"code", "message", "fields"?}}` with accurate status codes.

## 11. Security boundaries

| Boundary | Control |
|---|---|
| Browser ↔ server | CSP `default-src 'self'` (no inline script or style), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` |
| Anonymous → account | Validation, duplicate check, rate limit; role is always `user`; verification required before sign-in |
| Account → session | scrypt check, constant-time compare, dummy hash for unknown emails, 5-failure lockout, rotating CSRF |
| Member → Admin/Owner data | Route role gate (`403`); services re-check; admin APIs return no private workspace content |
| Admin → Owner operations | Owner-only routes plus `_require_owner` in the service; Admins can't change roles |
| Owner designation | Granted only to the *verified, active* account matching `OWNER_EMAIL`, and only while no Owner exists (checked inside the user-store lock). Never transferred or revoked automatically; a mismatch locks governance and is reported. See [roles-and-onboarding.md](roles-and-onboarding.md) |
| User ↔ user | Every workspace query is keyed by the session's user ID; foreign IDs return `404` |
| Files | Safe basenames, `.txt` only, size limits, NUL/binary rejection; attachments stored per user outside `frontend/` |
| Static serving | Only `frontend/assets/*` with allow-listed extensions; resolved path must stay inside `frontend/` |
| Dev mailbox | Development mode only; loopback *socket* address (Host and forwarded headers ignored); console-printed developer key required; not linked from the UI |

## 12. Future integration points

- **Week 3:** a query-log writer at the `h_search` boundary; `analysis/` with pandas and matplotlib; charts on `/admin/analytics`.
- **Week 4:** `data/evaluation/judgments.json`, an evaluation script, and metrics on `/admin/quality`.
- **After Week 4:** an email provider behind `DevMailbox.send`; AI Answers, Research Mode, semantic or hybrid search behind the existing entry points.
