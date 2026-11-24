# Verified test results

Recorded from the final local runs on **2026-11-24 (UTC)** against the code on `feature/search-experience`,
which includes `feature/ranked-retrieval`. GitHub Actions results for each pull request are linked from the
pull requests.

| Suite | Command | Result |
|---|---|---|
| Backend (unittest, standard library) | `python -m unittest discover -s tests/backend -t .` | **160/160 passed**, 0 skipped (37.0s) |
| Backend on native Windows (Python 3.14.7) | `py -m unittest discover -s tests/backend -t .` | **159 passed, 1 skipped** (the skip is a Unix-only file-permission test) |
| Start-up smoke test (Linux and native Windows) | `python scripts/smoke_test.py` | **Passed** on both: server start, sign-in, ranked search, second-instance refusal |
| Browser (Playwright, Chromium) | `cd tests/e2e && npx playwright test` | **59/59 passed**, 0 failed, 0 flaky (9.2m, 1 worker) |
| `feature/ranked-retrieval` from a fresh clone | backend suite and smoke test | **144/144 passed**; smoke test passed |

Previous baseline: 117 backend and 55 browser tests. Assertions changed on purpose because behaviour
changed: results now carry a score (the old "no score field" check now checks that the score equals
the sum of its term frequencies); the method text describes ranking; the admin index is built
automatically, so the test expects it to be current after an upload instead of "not initialised";
three browser checks follow the new *Any term* default. No assertion was removed or weakened.

Environment: Python 3.14.4 (Linux) and 3.14.7 (Windows) · Node 24.21 · Playwright 1.65.1 · Chromium
headless · Linux (WSL2) · axe-core 4.14 (WCAG 2.0/2.1 A and AA; serious and critical impacts fail).
All tests use synthetic `@virelix.test` / `@example.test` accounts, temporary data folders and a
copied corpus; none touch `data/` or a running instance.

## Backend tests by module

| Module | Passed | Covers |
|---|---:|---|
| `tests/backend/test_api_auth.py` | 14 | Registration, verification, sign-in, sessions, password reset |
| `tests/backend/test_api_roles.py` | 9 | Member, Admin and Owner permissions |
| `tests/backend/test_api_workspace.py` | 15 | Search history, saved items, collections, attachments, admin corpus |
| `tests/backend/test_datadir_lock.py` | 6 | One server per data folder, crash recovery |
| `tests/backend/test_governance_security.py` | 24 | Owner designation, invitations, security headers, terminology |
| `tests/backend/test_index.py` | 10 | Index build, statistics, persistence, validation, headerless titles |
| `tests/backend/test_loader.py` | 14 | Corpus discovery, decoding, metadata, stable IDs |
| `tests/backend/test_preprocess.py` | 16 | Normalisation and tokenisation |
| `tests/backend/test_search_api.py` | 13 | Ranked API results, modes, validation, pagination, overview, private-index isolation |
| `tests/backend/test_search_engine.py` | 24 | Query parsing, hand-counted ranking, phrases, posting-list evidence, index lifecycle |
| `tests/backend/test_snippets.py` | 15 | Offset tokenizer parity, snippet windows, boundaries, ellipses, phrases, fallback |

### Hand-counted ranking fixture

| Document | Text | python | programming | Score | Any term | All terms |
|---|---|---:|---:|---:|---|---|
| A | Python Python Python programming programming | 3 | 2 | **5** | 1st | 1st |
| B | Python programming | 1 | 1 | **2** | 2nd | 2nd |
| C | Python search | 1 | 0 | **1** | 3rd | excluded |

The same fixture is checked through the HTTP API (`test_search_api.py`). Repeating a query word
(`python python python`) gives the same scores as `python`.

### Evidence that retrieval uses postings

`PostingRetrievalEvidenceTests` wraps the index's postings in a recorder and makes tokenising any
document text raise an error. A phrase search still returns the right document, and the recorder
shows that only the two query terms' posting lists were read.

### Measured timings (local, 31 documents, 2,073 terms)

| Operation | Median |
|---|---:|
| Build the shared index | 16.7 ms |
| Retrieve and rank, *Any term* (5 two- and three-word queries × 200) | 0.040 ms (p95 0.087 ms) |
| Retrieve and rank, *All terms* | 0.009 ms (p95 0.031 ms) |
| Retrieve and rank, *Exact phrase* | 0.008 ms (p95 0.035 ms) |

These are spot measurements on one machine, not a benchmark; formal performance measurement is
planned for Week 4. Each search response reports its own `response_time_ms`.

## Browser tests

| Spec | Test | Time |
|---|---|---:|
| `admin.spec.js` | Administration › analytics, quality and system pages are truthful | 3.8s |
| `admin.spec.js` | Administration › bulk selection exposes selected-item actions | 3.9s |
| `admin.spec.js` | Administration › document index: rebuild, inspect vocabulary and postings | 4.3s |
| `admin.spec.js` | Administration › global documents: upload, filter, preview, remove | 4.7s |
| `admin.spec.js` | Administration › overview shows real corpus figures and working shortcuts | 2.8s |
| `auth.spec.js` | Authentication › a used verification link is rejected | 1.2s |
| `auth.spec.js` | Authentication › forgot password → reset link → sign in with the new password | 6.7s |
| `auth.spec.js` | Authentication › password visibility toggle | 1.2s |
| `auth.spec.js` | Authentication › register → verify by emailed link → sign in → sign out | 4.5s |
| `auth.spec.js` | Authentication › registration validates input and never offers a role choice | 1.2s |
| `auth.spec.js` | Authentication › unauthenticated visitors are sent to sign-in with a return path | 842ms |
| `auth.spec.js` | Authentication › wrong password shows a generic error | 1.5s |
| `professional.spec.js` | Appearance defaults › first-time visitors and new accounts get the light theme, even on a dark OS | 3.3s |
| `professional.spec.js` | Developer mailbox › is not linked from the application | 1.7s |
| `professional.spec.js` | Developer mailbox › requires the console key; the key never stays in the address bar | 1.1s |
| `professional.spec.js` | Injection safety › highlighting never breaks HTML entities or emits markup from text | 520ms |
| `professional.spec.js` | Injection safety › notification and return links only accept same-origin paths | 2.2s |
| `professional.spec.js` | Injection safety › stored and reflected HTML is rendered as text and never executes | 4.2s |
| `professional.spec.js` | Live privilege changes › removing Admin access updates the open session immediately | 8.4s |
| `professional.spec.js` | Role-based interfaces and product language › admin and owner: correct navigation groups and professional copy | 36.8s |
| `professional.spec.js` | Role-based interfaces and product language › member: personal workspace only, and professional copy everywhere | 27.7s |
| `professional.spec.js` | Role-based interfaces and product language › public pages contain no academic schedule language | 8.0s |
| `ranked.spec.js` | Ranked search results › attachment text is rendered as text, never as markup | 3.1s |
| `ranked.spec.js` | Ranked search results › full ranked set is paginated and re-sorted, not just the visible page | 4.9s |
| `ranked.spec.js` | Ranked search results › scores are shown, explained, ordered and equal to the per-term counts | 3.6s |
| `ranked.spec.js` | Ranked search results › snippets highlight the matched words around where they occur | 3.9s |
| `responsive-a11y.spec.js` | Accessibility › auth pages pass axe | 6.5s |
| `responsive-a11y.spec.js` | Accessibility › keyboard: skip link, slash shortcut and dialog focus return | 4.1s |
| `responsive-a11y.spec.js` | Accessibility › no serious axe violations on key pages (dark) | 24.5s |
| `responsive-a11y.spec.js` | Accessibility › no serious axe violations on key pages (light) | 25.2s |
| `responsive-a11y.spec.js` | Responsive layouts › filter panel becomes a bottom sheet on phones | 3.2s |
| `responsive-a11y.spec.js` | Responsive layouts › long unbroken user text never widens the page on a 320px phone | 9.5s |
| `responsive-a11y.spec.js` | Responsive layouts › mobile navigation drawer opens, navigates and closes | 3.5s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 1024px | 19.5s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 1440px | 19.3s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 1920px | 19.6s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 320px | 18.5s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 390px | 19.0s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 768px | 19.4s |
| `roles.spec.js` | Roles and governance › admins can suspend and reactivate a member; suspension ends the member's session | 9.7s |
| `roles.spec.js` | Roles and governance › members see no administration navigation and are refused admin pages | 2.4s |
| `roles.spec.js` | Roles and governance › owner invites an admin; invitation is email-bound, single-use and revocable | 15.0s |
| `roles.spec.js` | Roles and governance › revoked invitations stop working; resend issues a new link | 9.3s |
| `roles.spec.js` | Roles and governance › the OWNER_EMAIL account becomes Owner after verification | 1.6s |
| `screenshots.spec.js` | documentation screenshots | 1.3m |
| `search.spec.js` | Search workspace › category tabs: extractive overview with references, unavailable sources stated honestly | 4.1s |
| `search.spec.js` | Search workspace › empty, invalid and no-result queries are handled | 3.9s |
| `search.spec.js` | Search workspace › floating filter panel: focus, escape, apply, persistence and reset | 4.9s |
| `search.spec.js` | Search workspace › home has no category tabs; submitting a query opens results with tabs | 2.7s |
| `search.spec.js` | Search workspace › missing documents show a clear state | 2.3s |
| `search.spec.js` | Search workspace › save, collect, view document, refine and history | 12.3s |
| `search.spec.js` | Search workspace › sorting and pagination work over real results | 3.8s |
| `workspace.spec.js` | Personal workspace and settings › account: profile update, password change validation, history toggle | 5.4s |
| `workspace.spec.js` | Personal workspace and settings › appearance preferences apply immediately and persist | 7.5s |
| `workspace.spec.js` | Personal workspace and settings › attachments are invisible to other members | 4.6s |
| `workspace.spec.js` | Personal workspace and settings › collections: create, rename, duplicate names, delete with confirmation | 8.6s |
| `workspace.spec.js` | Personal workspace and settings › notifications show truthful in-app state | 1.9s |
| `workspace.spec.js` | Personal workspace and settings › private attachments: validate, attach, search privately, view, remove | 3.9s |
| `workspace.spec.js` | Personal workspace and settings › unavailable entry points explain themselves | 3.4s |

## Defects found and fixed in this pass

- **Titles from a document's first line were indexed twice.** A document without a metadata header takes its title from its first line, which is also part of the body, so those words had double term frequencies. Fixed in `index.indexable_text`.
- **Short snippets near the end of a document.** When the match was in the last sentence, the snippet could be under 160 characters. It now extends backwards to an earlier sentence.
- **Dark-theme contrast** of the new per-term counts failed axe; they now use the term text colour.
- **A test left a child process pipe open**, producing a `ResourceWarning` on Windows (`test_datadir_lock.py`).
- **Browser test races in the new spec**: reading result lists before they rendered. The reads now wait for results first.

## Cross-platform verification

- **Windows (native):** the full backend suite and `scripts/smoke_test.py` ran on Windows Python 3.14.7. The smoke test starts `run.py`, checks pages, assets and the `/data/…` 404, signs a synthetic account in, runs a ranked search, and confirms that a second instance on the same data folder is refused while the first keeps running.
- **Linux:** full backend and browser suites ran (WSL2 Ubuntu, Python 3.14.4).
- **macOS:** the backend suite passes in GitHub Actions on `macos-latest`. It hasn't been tested interactively on a Mac.
- **Continuous integration:** `.github/workflows/ci.yml` (replacing `tests.yml`) runs on every pull request and every push to `master`: backend tests and the smoke test on Ubuntu (Python 3.11 and 3.13), Windows and macOS, and the browser suite on Ubuntu. Earlier `tests.yml` run 45334933998 (commit `795d9fa`) passed all four of its jobs.
- **CI-found test races, fixed in `795d9fa`:** the first CI run exposed two browser tests that only passed on slower machines. One pressed the skip link before the app had rendered; the other's "Suspended" check also matched the member's own name. Both are fixed and repeat-tested.
- **Fixed:** the data-folder check called `os.kill(pid, 0)`, which on Windows *terminates* the process instead of probing it. It's now an OS-level file lock (`msvcrt.locking` on Windows, `fcntl.flock` elsewhere) that the OS releases if the server crashes (`test_datadir_lock.py`).

## Not covered by automation

- Real email delivery: none exists; the development mailbox is exercised instead.
- Browsers other than Chromium.
- Load and performance testing.
- Manual screen-reader passes (automated axe checks and keyboard tests only).
