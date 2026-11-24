# Virelix API reference

Base path `/api`. JSON in, JSON out (`Content-Type: application/json`). Uploads send raw file bytes.

**Conventions**

- **Auth:** `public`, `user` (any signed-in, verified, active account), `admin` (Admin or Owner), `owner`.
- **CSRF:** every non-GET request needs header `X-CSRF-Token` equal to the `vx_csrf` cookie. Cross-origin `Origin` headers are rejected.
- **Errors:** `{"error": {"code": "snake_case", "message": "Human readable", "fields": {"field": "message"}}}`.
  Status codes: 400 validation · 401 not signed in · 403 forbidden/CSRF · 404 · 405 · 409 conflict · 413 too large · 415 unsupported type · 429 throttled (`Retry-After`) · 500.
- **Uploads:** `POST` with `Content-Type: text/plain` (or `application/octet-stream`) and `X-Filename: <url-encoded name>`.

## Authentication

| Method & path | Auth | Body / query | Response |
|---|---|---|---|
| `GET /health` | public | | `{status, version, time}` |
| `GET /auth/session` | public | | `{authenticated, user?, dev_mailbox}` |
| `POST /auth/register` | public | `{name, email, password, confirm_password, accept_terms: true}` | `201 {ok, email, verification}`. Role fields are ignored. `409 email_taken` |
| `POST /auth/verify-email` | public | `{token}` | `{ok, email, role}` · `400 token_invalid | token_used | token_expired` |
| `POST /auth/resend-verification` | public | `{email}` | generic `{ok, message}` (no account enumeration) |
| `POST /auth/login` | public | `{email, password, remember}` | `{ok, user}` + `Set-Cookie: vx_session` · `401 invalid_credentials` · `403 email_unverified | account_suspended` · `429 too_many_attempts` |
| `POST /auth/logout` | user | | `{ok}`; session deleted server-side |
| `POST /auth/forgot-password` | public | `{email}` | generic `{ok, message, delivery}` |
| `POST /auth/reset-password/check` | public | `{token}` | `{ok, email (masked), expires_at}` |
| `POST /auth/reset-password` | public | `{token, password, confirm_password}` | `{ok}`; revokes every session for that account |

## Account

| Method & path | Auth | Notes |
|---|---|---|
| `GET /me` | user | Profile, prefs, unread count. `role` is the *effective* role (an Owner shows as `admin` while governance is locked by a configuration conflict) |
| `PATCH /me` | user | `{name}` |
| `POST /me/password` | user | `{current_password, new_password, confirm_password}`; other sessions revoked; 5 wrong current passwords → `429` for 15 min |
| `PATCH /me/prefs` | user | Any of: `theme` (light·dark·oled·system), `accent`, `text_size`, `density`, `sidebar`, `motion`, `save_history`, `default_mode`, `per_page` (10·20·30), `default_sources`, `show_excerpts`, `show_matched_terms`, `notify_*`. Unknown keys → 400 |
| `GET /me/sessions` · `DELETE /me/sessions/{id}` · `POST /me/sessions/revoke-others` | user | Session management |
| `GET /notifications` · `POST /notifications/read {ids?}` · `DELETE /notifications` | user | In-app only |

## Search and documents

| Method & path | Auth | Notes |
|---|---|---|
| `GET /search` | user | `q` (≤300 chars), `mode` (all·any·phrase), `sort` (coverage·title_asc·title_desc·date_desc·date_asc), `page`, `per_page` (5–50), `sources` (corpus,attachments), `categories` (comma list), `record=1` adds to history. Returns `{query, terms, total, page, pages, per_page, searched, terms_without_matches, method, results[]}`. Each result: `doc_id, title, source, filename, category, author, date, tags, excerpt, excerpt_kind, matched_terms, missing_terms, word_count, saved`. **No score field.** |
| `GET /search/overview` | user | `q`, `mode`. Returns `{kind: "extractive_preview", passages[{text, doc_id, title, sentence_index, matched_terms}], references[], matching_documents, method}` |
| `GET /search/facets` | user | Sources with counts, categories with counts, document types with `supported` |
| `GET /documents/{doc_id}` | user | Full text and metadata, `saved`, `collections` (IDs containing it) · `404 document_not_found` |

## Workspace

| Method & path | Auth | Notes |
|---|---|---|
| `GET /history` · `DELETE /history/{id}` · `DELETE /history` | user | `{items, recording}`. Consecutive identical searches update one entry |
| `GET /saved` | user | Items include `available` (document still in corpus) |
| `POST /saved` | user | `{doc_id, query?}` · `409 already_saved` |
| `POST /saved/overview` | user | `{query, mode}`. Passages are recomputed by the server; client text is ignored |
| `DELETE /saved/{id}` · `DELETE /saved/by-doc/{doc_id}` | user | |
| `GET /collections` · `POST /collections {name, description?, doc_id?}` | user | Names unique per user (case-insensitive) · `409 duplicate_name` |
| `GET·PATCH·DELETE /collections/{id}` | user | Rename via `{name, description?}` |
| `POST /collections/{id}/items {doc_id}` · `DELETE /collections/{id}/items/{doc_id}` | user | `409 duplicate_item` |
| `GET /attachments` | user | Items and limits (`.txt`, 512 KB, 10 files, 24 h) |
| `POST /attachments` (raw upload) | user | `415 unsupported_type | binary_file` · `413 file_too_large` · `409 limit_reached` |
| `GET·DELETE /attachments/{id}` · `DELETE /attachments` | user | Only the owner's attachments; others get 404 |
| `POST /invitations/accept {token}` | user | Email-bound; makes the caller an Admin |
| `GET /invitations/peek?token=` | public | `{email (masked unless it's you), status, expires_at}` |

## Administration (Admin and Owner)

| Method & path | Notes |
|---|---|
| `GET /admin/overview` | Corpus counts and skipped files, index status, user counts by role and status |
| `GET /admin/documents` | `q`, `category`, `sort` (title_asc·title_desc·modified_desc·size_desc·size_asc·words_desc) |
| `POST /admin/documents` (raw upload) | `.txt` ≤1 MB; safe filename; `409 duplicate_filename` |
| `POST /admin/documents/remove {doc_ids[]}` | All-or-nothing; files move to `data/removed_documents/` |
| `GET /admin/documents/{doc_id}` | Metadata and full text |
| `POST /admin/corpus/reload` | Re-scan the corpus folder |
| `GET /admin/index` | `{state: not_initialized·current·stale, stats, corpus_documents, retrieval_enabled: false, note}` |
| `POST /admin/index/rebuild {remove_stopwords?}` | Build the foundation from the corpus |
| `GET /admin/index/vocabulary` | `q`, `sort` (term·df·cf), `page`, `per_page` |
| `GET /admin/index/postings?term=` | `{term, df, cf, postings[{doc_id, title, tf, positions, positions_total}]}` |
| `GET /admin/index/documents` | Per-document token length and unique terms |
| `GET /admin/users` | `q`, `role`, `status` (active·suspended·unverified) |
| `GET /admin/users/{id}` | Account details (never workspace contents) |
| `POST /admin/users/{id}/suspend {reason?}` · `POST /admin/users/{id}/reactivate` | Members only, never yourself; suspension revokes sessions |
| `GET /admin/system` | Measured process, storage, corpus, index, sessions, email and governance status (no paths, secrets or personal data) |

## Owner

| Method & path | Notes |
|---|---|
| `GET /owner/invitations` | All invitations with computed `expired` status |
| `POST /owner/invitations {email}` | `409 invite_pending | already_admin` · `400` for the Owner's own or designated address |
| `POST /owner/invitations/{id}/resend` | New token (old link stops working), new expiry |
| `POST /owner/invitations/{id}/revoke` | |
| `GET /owner/admins` · `POST /owner/admins/{id}/remove` | Remove Admin access |
| `GET /owner/platform` | Ownership (masked `OWNER_EMAIL`, `state.conflict`), security posture, capability availability |
| `GET /owner/audit?limit=` | Privileged-action log, newest first |

## Development only

| Method & path | Notes |
|---|---|
| `GET /dev/mailbox` · `DELETE /dev/mailbox` | Requires development mode (otherwise `404`), a loopback socket address (otherwise `403`; `Host`/`X-Forwarded-*` ignored) **and** header `X-Dev-Mailbox-Key` matching the key printed at start-up (otherwise `403 dev_key_required`) |
