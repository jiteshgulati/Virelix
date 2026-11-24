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
| O5 | Full index construction, query processing, TF ranking, snippets | Week 2 |
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
| FR6 | Inverted-index model: terms → postings (doc ID, TF, positions); document records; vocabulary stats; JSON persistence | Done (foundation) |
| FR7 | Search UI: query, clear, categories, floating filters, sort, pagination, result actions, follow-up refine | Done (preview data) |
| FR8 | Extractive overview with genuine references; save answer | Done |
| FR9 | Accounts: register, verify email, sign in or out, remember me, reset password, change password, sessions | Done |
| FR10 | Roles: Member/Admin/Owner enforced in the backend; Owner from `OWNER_EMAIL`; Admin by invitation | Done |
| FR11 | Workspace: history, saved results, collections, private attachments, preferences, in-app notifications | Done |
| FR12 | Admin: overview, global documents, index management, users, analytics (Week 3 state), quality (Week 4 state), system | Done |
| FR13 | Ranked retrieval with TF; snippets | **Week 2** |
| FR14 | Aggregate query logging and analysis | **Week 3** |
| FR15 | Retrieval evaluation | **Week 4** |

## 5. Non-functional requirements

- **Stack:** Python 3 standard library backend; HTML5, CSS3, Bootstrap 5 and vanilla ES modules frontend; JSON and filesystem persistence; no build step.
- **Security:** scrypt password hashing, hashed single-use tokens, HttpOnly SameSite=Strict session cookies, CSRF double-submit plus Origin check, login throttling, strict CSP, static allow-list, per-user isolation, audit log.
- **Integrity:** atomic writes (temp file, fsync, `os.replace`), per-store locks, server-side validation on every input.
- **Honesty:** no fabricated scores, results, analytics, deliveries or AI output; unavailable features say so.
- **Accessibility:** WCAG 2.1 AA target. Semantic HTML, labels, focus management, ≥4.5:1 text contrast, reduced-motion support; automated axe checks.
- **Responsiveness:** usable from 320 px to 1920 px; verified at 1920, 1440, 1024, 768, 390 and 320.
- **Performance:** the corpus is held in memory. Measured locally (Python 3.14, WSL2, OneDrive-synced folder): loading the 31 files takes about 240 ms, a preview query about 0.4 ms, and building the index foundation about 20 ms. Formal performance measurement is a Week 4 task.

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
            │ tokens)    │              │ foundation)  │ attachments)    │
            ├────────────┴──────────────┴──────┬───────┴─────────────────┤
            │ search/: loader · preprocess · index · preview             │
            ├───────────────────────────────────┴────────────────────────┤
            │ storage.py: atomic JSON stores in data/ · corpus/ folder   │
            └────────────────────────────────────────────────────────────┘
```

| Module | Responsibility |
|---|---|
| `backend/search/loader.py` | Discovery, decoding, metadata, stable IDs, load report |
| `backend/search/preprocess.py` | Normalisation and tokenisation (shared by documents and queries) |
| `backend/search/index.py` | `Posting`, `DocumentRecord`, `InvertedIndex`, `initialize_foundation` |
| `backend/search/preview.py` | Document search preview and extractive overview (no scoring) |
| `backend/services/auth.py` | Registration, verification, login, sessions, reset, owner reconciliation |
| `backend/services/governance.py` | Owner-only invitations; Admin user management; suspension |
| `backend/services/corpus.py` | Shared corpus lifecycle; document index build, status and inspection |
| `backend/services/workspace.py` | Per-user history, saved items, collections, attachments, preferences |
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
DocumentRecord(doc_id, title, filename, length, unique_terms, metadata)
stats(): documents, vocabulary_size, total_tokens, postings, average_document_length, hapax_terms

# Loader
Document(doc_id, filename, title, text, metadata, size_bytes, modified, encoding, warnings)
LoadReport(folder, documents[], skipped[SkippedFile(filename, reason, detail)], loaded_at)
```

Persistent JSON stores in `data/`: `users.json` (id → user), `sessions.json` (token-hash → session),
`tokens.json` (token-hash → verify or reset record), `invitations.json`, `workspace.json`
(user → history, saved, collections, attachment metadata), `notifications.json`, `dev_outbox.json`,
`audit.log.jsonl`, `index/foundation.json`, `attachments/<user>/<id>.txt`, `removed_documents/`.

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

- **Week 2:** replace `preview.search` with index-backed retrieval (`InvertedIndex.postings_for` → candidate set → TF scoring → snippets). The API response keeps its shape and gains `score` and `snippet` fields; the UI's sort menu gains *Relevance*.
- **Week 3:** a query-log writer at the `h_search` boundary; `analysis/` with pandas and matplotlib; charts on `/admin/analytics`.
- **Week 4:** `data/evaluation/judgments.json`, an evaluation script, and metrics on `/admin/quality`.
- **After Week 4:** an email provider behind `DevMailbox.send`; AI Answers, Research Mode, semantic or hybrid search behind the existing entry points.
