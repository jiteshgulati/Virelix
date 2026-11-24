# Verified test results

Recorded from the final runs on **2026-11-24 (UTC)** against the code in this repository, immediately before publication.

| Suite | Command | Result |
|---|---|---|
| Backend (unittest, standard library) | `python -m unittest discover -s tests/backend -t .` | **117/117 passed**, 0 skipped (28.9s) |
| Backend on native Windows (Python 3.14.7) | `py -m unittest discover -s tests/backend -t .` | **116 passed, 1 skipped** (the skip is a Unix-only file-permission test) |
| Browser (Playwright, Chromium) | `cd tests/e2e && npx playwright test` | **55/55 passed**, 0 failed, 0 flaky (8.9m, 1 worker) |

Previous baseline: 87 backend and 44 browser tests. Two earlier assertions were changed on purpose because the behaviour changed: an Owner whose email no longer matches `OWNER_EMAIL` is no longer silently demoted (governance locks instead), and the developer mailbox now requires a key. No assertion was removed or weakened.

Environment: Python 3.14.4 · Node 24.21 · Playwright 1.65.1 · Chrome Headless Shell 159 · Linux (WSL2) · axe-core 4.14 (WCAG 2.0/2.1 A and AA; serious and critical impacts fail). All tests use synthetic `@virelix.test` / `@example.test` accounts, temporary data folders and a copied corpus; none touch `data/` or a running instance.

## Backend tests by module

| Module | Passed |
|---|---:|
| `tests/backend/test_api_auth.py` | 14 |
| `tests/backend/test_api_roles.py` | 9 |
| `tests/backend/test_api_workspace.py` | 15 |
| `tests/backend/test_datadir_lock.py` | 6 |
| `tests/backend/test_governance_security.py` | 24 |
| `tests/backend/test_index_preview.py` | 19 |
| `tests/backend/test_loader.py` | 14 |
| `tests/backend/test_preprocess.py` | 16 |

## Browser tests

| Spec | Test | Time |
|---|---|---:|
| `admin.spec.js` | Administration › overview shows real corpus figures and working shortcuts | 2.5s |
| `admin.spec.js` | Administration › global documents: upload, filter, preview, remove | 4.1s |
| `admin.spec.js` | Administration › bulk selection exposes selected-item actions | 3.9s |
| `admin.spec.js` | Administration › index foundation: build, inspect vocabulary and postings | 3.3s |
| `admin.spec.js` | Administration › analytics, quality and system pages are truthful | 3.2s |
| `auth.spec.js` | Authentication › unauthenticated visitors are sent to sign-in with a return path | 720ms |
| `auth.spec.js` | Authentication › registration validates input and never offers a role choice | 1.0s |
| `auth.spec.js` | Authentication › password visibility toggle | 1.0s |
| `auth.spec.js` | Authentication › register → verify by emailed link → sign in → sign out | 4.0s |
| `auth.spec.js` | Authentication › a used verification link is rejected | 1.3s |
| `auth.spec.js` | Authentication › wrong password shows a generic error | 1.2s |
| `auth.spec.js` | Authentication › forgot password → reset link → sign in with the new password | 4.0s |
| `professional.spec.js` | Role-based interfaces and product language › public pages contain no academic schedule language | 7.4s |
| `professional.spec.js` | Role-based interfaces and product language › member: personal workspace only, and professional copy everywhere | 25.3s |
| `professional.spec.js` | Role-based interfaces and product language › admin and owner: correct navigation groups and professional copy | 34.2s |
| `professional.spec.js` | Injection safety › stored and reflected HTML is rendered as text and never executes | 3.4s |
| `professional.spec.js` | Injection safety › highlighting never breaks HTML entities or emits markup from text | 438ms |
| `professional.spec.js` | Injection safety › notification and return links only accept same-origin paths | 2.1s |
| `professional.spec.js` | Live privilege changes › removing Admin access updates the open session immediately | 7.0s |
| `professional.spec.js` | Developer mailbox › requires the console key; the key never stays in the address bar | 1.0s |
| `professional.spec.js` | Developer mailbox › is not linked from the application | 1.7s |
| `professional.spec.js` | Appearance defaults › first-time visitors and new accounts get the light theme, even on a dark OS | 2.8s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 1920px | 17.1s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 1440px | 17.2s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 1024px | 16.8s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 768px | 16.8s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 390px | 16.7s |
| `responsive-a11y.spec.js` | Responsive layouts › no horizontal overflow at 320px | 17.2s |
| `responsive-a11y.spec.js` | Responsive layouts › long unbroken user text never widens the page on a 320px phone | 8.9s |
| `responsive-a11y.spec.js` | Responsive layouts › mobile navigation drawer opens, navigates and closes | 3.3s |
| `responsive-a11y.spec.js` | Responsive layouts › filter panel becomes a bottom sheet on phones | 3.0s |
| `responsive-a11y.spec.js` | Accessibility › no serious axe violations on key pages (light) | 21.1s |
| `responsive-a11y.spec.js` | Accessibility › no serious axe violations on key pages (dark) | 21.2s |
| `responsive-a11y.spec.js` | Accessibility › auth pages pass axe | 5.5s |
| `responsive-a11y.spec.js` | Accessibility › keyboard: skip link, slash shortcut and dialog focus return | 4.0s |
| `roles.spec.js` | Roles and governance › members see no administration navigation and are refused admin pages | 2.8s |
| `roles.spec.js` | Roles and governance › the OWNER_EMAIL account becomes Owner after verification | 2.0s |
| `roles.spec.js` | Roles and governance › owner invites an admin; invitation is email-bound, single-use and revocable | 12.3s |
| `roles.spec.js` | Roles and governance › revoked invitations stop working; resend issues a new link | 7.4s |
| `roles.spec.js` | Roles and governance › admins can suspend and reactivate a member; suspension ends the member's session | 10.3s |
| `screenshots.spec.js` | documentation screenshots | 1.2m |
| `search.spec.js` | Search workspace › home has no category tabs; submitting a query opens results with tabs | 1.8s |
| `search.spec.js` | Search workspace › empty, invalid and no-result queries are handled | 3.6s |
| `search.spec.js` | Search workspace › floating filter panel: focus, escape, apply, persistence and reset | 4.7s |
| `search.spec.js` | Search workspace › sorting and pagination work over real results | 3.3s |
| `search.spec.js` | Search workspace › category tabs: extractive overview with references, unavailable sources stated honestly | 3.5s |
| `search.spec.js` | Search workspace › save, collect, view document, refine and history | 11.1s |
| `search.spec.js` | Search workspace › missing documents show a clear state | 1.8s |
| `workspace.spec.js` | Personal workspace and settings › private attachments: validate, attach, search privately, view, remove | 3.6s |
| `workspace.spec.js` | Personal workspace and settings › attachments are invisible to other members | 5.5s |
| `workspace.spec.js` | Personal workspace and settings › collections: create, rename, duplicate names, delete with confirmation | 9.0s |
| `workspace.spec.js` | Personal workspace and settings › appearance preferences apply immediately and persist | 6.6s |
| `workspace.spec.js` | Personal workspace and settings › account: profile update, password change validation, history toggle | 4.8s |
| `workspace.spec.js` | Personal workspace and settings › unavailable entry points explain themselves | 3.0s |
| `workspace.spec.js` | Personal workspace and settings › notifications show truthful in-app state | 2.1s |

## Defects found and fixed in this pass

- **Owner bootstrap could revoke and grant automatically.** Start-up reconciliation demoted any Owner not matching `OWNER_EMAIL` and promoted the match, which amounts to a silent transfer. Ownership is now granted only when none exists (inside the user-store lock), never revoked or transferred automatically, and mismatches lock governance and are reported.
- **The Owner email could be invited as an Admin**; the configured Owner address is now rejected.
- **The developer mailbox exposed every account's tokens** to anyone on the machine who knew the URL. It now also requires a console-printed key, is unlinked from the app, and ignores `Host` and forwarded headers.
- **The highlighter matched inside HTML entities.** It ran on already-escaped text, so `amp`, `lt`, `quot` and `39` corrupted displayed text. Matching now runs on raw text with per-segment escaping.
- **Link targets weren't validated**: notification links weren't checked for unsafe schemes. Added `safePath` (same-origin relative paths only).
- **Stale privileges in open tabs.** After Admin removal the server refused requests, but the interface kept showing Administration until reload. The client now re-syncs the session on `403`, on navigation and on back/forward-cache restores.
- **Unthrottled password changes.** Wrong current passwords are now rate-limited.
- **Two servers could share one data folder** and overwrite each other's in-memory JSON stores; a lock now prevents it.
- **Long unbroken user text** (queries, names) widened the page on phones.
- **The Home page had no `<h1>`.**
- **The theme defaulted to the OS setting** instead of light for new visitors and accounts.
- **Academic schedule language** (Week N, project ID, team code, milestones) appeared throughout the runtime UI, API responses, version string and corpus metadata.

## Cross-platform verification

- **Windows (native):** the full backend suite ran on Windows Python 3.14.7. `py run.py` started the server, which served pages and assets, returned 404 for `/data/…`, held `server.lock`, and refused a second instance while the first kept running.
- **Linux:** full backend and browser suites ran (WSL2 Ubuntu, Python 3.14.4).
- **macOS:** the backend suite passes in GitHub Actions on `macos-latest`. It hasn't been tested interactively on a Mac.
- **Continuous integration:** `.github/workflows/tests.yml` runs on every push and pull request. Run 45334933998 (commit `795d9fa`) passed all four jobs: backend on Ubuntu, Windows and macOS (Python 3.12), and the browser suite on Ubuntu.
- **CI-found test races, fixed in `795d9fa`:** the first CI run exposed two browser tests that only passed on slower machines. One pressed the skip link before the app had rendered; the other's "Suspended" check also matched the member's own name. Both are fixed and repeat-tested.
- **Fixed:** the data-folder check called `os.kill(pid, 0)`, which on Windows *terminates* the process instead of probing it. It's now an OS-level file lock (`msvcrt.locking` on Windows, `fcntl.flock` elsewhere) that the OS releases if the server crashes (`test_datadir_lock.py`).

## Not covered by automation

- Real email delivery: none exists; the development mailbox is exercised instead.
- Browsers other than Chromium.
- Load and performance testing.
- Manual screen-reader passes (automated axe checks and keyboard tests only).
