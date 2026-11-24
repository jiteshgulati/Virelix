# Team responsibilities

Virelix is built by two academically equal team members, both **Full-Stack Developers** with
complementary specialisations. The aim is an even share of the work across the whole project,
achieved through real responsibilities rather than counted commits.

| Developer | Designation | Specialisation | Virelix role | GitHub account | GitHub role |
|---|---|---|---|---|---|
| **Jitesh Gulati** | Full-Stack Developer | Search Engine & Platform Engineering | Owner | [@jiteshgulati](https://github.com/jiteshgulati) | Repository owner and maintainer |
| **Chaitain Gupta** | Full-Stack Developer | Interface & Data Engineering | Admin | [@chaitanya-gupta-07](https://github.com/chaitanya-gupta-07) | Collaborator |

*Chaitain* is the name used for college work; *Chaitanya* is the same person's name on his email and GitHub account.

The roles in the *Virelix role* and *GitHub role* columns are operational permissions. They don't imply academic seniority.

## Maintenance is not authorship

This document assigns **who maintains and reviews** each area from now on. It doesn't record who
wrote the existing code:

- The first commit on `master` (`Added README`) was made by Chaitain (Chaitanya) Gupta from @chaitanya-gupta-07 and is preserved as-is.
- **The application foundation was developed jointly.** Both developers worked together on one shared computer, with AI coding assistance, so authorship of individual lines can't be reliably separated.
- It was published as a series of component commits on top of that first commit. In each one, the **commit author is the developer who leads that area** and **the other developer is credited with a `Co-authored-by` trailer**, so every foundation commit credits both. Each developer pushed the commits they authored from their own GitHub account. The split reflects area leadership, not exclusive authorship.
- New work is credited through each developer's own commits, pull requests and reviews. Pair work uses `Co-authored-by:` trailers that both people agree to.

## Responsibility by phase

| Phase | Jitesh Gulati | Chaitain Gupta |
|---|---|---|
| Foundation | Backend architecture, persistence, authentication, authorization, index structure | Frontend, document loader, preprocessing, corpus and corpus management |
| Search engine | Inverted-index construction, retrieval, query processing, relevance ranking | Snippet generation, search-result integration, highlighting, filters |
| Data analysis | Analytics APIs, backend integration, benchmark traces, privacy | Query logging, pandas analysis, document frequency, Zipf analysis, matplotlib, analytics interface |
| Final evaluation | Performance benchmarking, security, backend testing, architecture and API documentation | Search-quality evaluation (P@5, R@5, MRR), browser testing, quality dashboard, README |
| Final submission | Shared | Shared |

**Shared by both:** requirements and PRD analysis, product planning, API-contract design,
frontend/backend compatibility, code review, integration testing, cross-component bug fixing,
security awareness, technical and academic documentation, release preparation, demonstration,
presentation and viva preparation. Both developers are expected to understand the whole
application; ownership never stops either of them from contributing to the other's area.

## Ownership matrix

Legend: **J** = Jitesh Gulati, **C** = Chaitain Gupta. *Primary* maintains the area and drives its
changes; *Reviewer* reviews pull requests that touch it. Shared rows name a lead for each part.

### Backend platform

| Path | Purpose | Primary | Reviewer | Reason |
|---|---|---|---|---|
| `run.py` | Entry point and CLI flags | J | C | Server start-up and configuration |
| `backend/config.py` | Environment and `.env` loading, defaults | J | C | Platform configuration |
| `backend/server.py` | HTTP server, security headers, static allow-list, data-folder lock, start-up banner | J | C | Infrastructure. C reviews static-asset serving because the frontend depends on it |
| `backend/web.py` | Request/response objects, router | J | C | Request handling |
| `backend/security.py` | scrypt hashing, tokens, validation, throttles, safe filenames | J | C | Security utilities |
| `backend/storage.py` | Atomic JSON stores, locks, audit log | J | C | Persistence and concurrency |
| `backend/services/auth.py` | Registration, verification, sessions, reset, Owner bootstrap | J | C | Authentication and governance |
| `backend/services/governance.py` | Admin invitations, Admin removal, user suspension | J | C | Authorization |
| `backend/services/common.py` | Roles, notifier, auditor | J | C | Platform services |
| `backend/services/mailer.py` | Development mailbox | J | C | Email integration point |
| `backend/services/workspace.py` | History, saved items, collections, attachments, preferences | J | C | Privacy boundaries. C owns the matching interfaces |
| `scripts/owner_recovery.py` | Manual Owner handover | J | C | Governance tooling |
| `scripts/smoke_test.py` | Cross-platform start-up smoke test used by CI | J | C | Platform verification |

### Search engine and documents

| Path | Purpose | Primary | Reviewer | Reason |
|---|---|---|---|---|
| `backend/search/loader.py` | TXT discovery, decoding, metadata, stable IDs, load report | C | J | Document processing |
| `backend/search/preprocess.py` | Normalisation and tokenisation, including offset-aware tokens for highlighting | C | J | Text processing. J reviews because the index depends on it |
| `backend/search/snippets.py` | Query-aware snippets with structured highlight ranges | C | J | Result presentation |
| `backend/search/index.py` | Inverted index: postings, TF, positions, validation, persistence | J | C | Core index |
| `backend/search/engine.py` | Query parsing, posting-list retrieval, TF scoring, deterministic ranking | J | C | Ranked retrieval |
| `backend/search/overview.py` | Extractive overview over ranked hits; opening excerpts | **Shared**: J leads selection from ranked hits; C leads passage presentation | both | Spans retrieval and result presentation |
| `backend/services/search.py` | Combines shared and private indexes; filters, sorts, paginates, times responses | **Shared**: J leads retrieval and privacy; C leads result fields used by the interface | both | The search contract |
| `backend/services/corpus.py` | Shared-corpus lifecycle and index lifecycle | **Shared**: C leads load, upload, removal and validation; J leads index load, validation, atomic rebuild and status | both | One service, two specialisations |
| `corpus/`, `corpus/inventory.json` | 31-document sample corpus | C | J | Corpus preparation |
| `scripts/corpus_inventory.py` | Generates the corpus inventory | C | J | Corpus tooling |

### Integration layer

| Path | Purpose | Primary | Reviewer | Reason |
|---|---|---|---|---|
| `backend/app.py` | API route table and handlers: the frontend/backend contract | **Shared**: J leads auth, admin and governance routes plus middleware; C leads the response shapes of search, document and workspace routes | both | Every feature crosses it |
| `docs/api.md` | API contracts | J | C | API documentation. Contract changes need both |

### Frontend

| Path | Purpose | Primary | Reviewer | Reason |
|---|---|---|---|---|
| `frontend/index.html`, `favicon.svg`, `robots.txt` | Page shell | C | J | Frontend structure |
| `frontend/assets/css/` | Design tokens, themes, components | C | J | Design system |
| `frontend/assets/js/core/router.js`, `store.js`, `prefs.js`, `format.js`, `text.js`, `icons.js` | Routing, state, preferences, formatting | C | J | Client architecture |
| `frontend/assets/js/core/api.js`, `sync.js` | API client, CSRF header, session re-sync | C | J | Frontend integration. J reviews because it's security-relevant |
| `frontend/assets/js/core/dom.js` | Escaping templates, highlighting | C | J | Rendering. J reviews for injection safety |
| `frontend/assets/js/components/` | Shell, search bar, filter panel, dialogs, states | C | J | UI components |
| `frontend/assets/js/views/` (workspace, auth, search, documents) | Product screens | C | J | User-facing integration |
| `frontend/assets/js/views/admin/`, `views/owner/`, `views/dev/` | Administration and governance screens | C | J | C builds the interfaces; J reviews the permission behaviour |
| `frontend/assets/vendor/`, `frontend/assets/fonts/` | Bootstrap 5.3.9, fonts and their licences | C | J | Asset maintenance |

### Analysis and evaluation (later milestones)

| Path | Purpose | Primary | Reviewer | Reason |
|---|---|---|---|---|
| `analysis/` | Query-log analysis with pandas and matplotlib | C | J | Data analysis |
| `requirements-analysis.txt` (when analysis starts) | Analysis dependencies | C | J | Data tooling |
| Analytics and benchmark APIs (not yet built) | Backend analytics, benchmark traces | J | C | Analytics integration and performance |
| Evaluation data and metrics (not yet built) | Test queries, judgments, P@5, R@5, MRR | C | J | Search-quality evaluation |

### Tests

| Path | Purpose | Primary | Reviewer | Reason |
|---|---|---|---|---|
| `tests/backend/test_loader.py`, `test_preprocess.py`, `test_snippets.py` | Loader, preprocessing and snippets | C | J | Matches module ownership |
| `tests/backend/test_index.py`, `test_search_engine.py` | Index, query processing, retrieval, ranking, index lifecycle | J | C | Matches module ownership |
| `tests/backend/test_search_api.py` | Ranked search through the API; private-index isolation | **Shared** | both | Crosses services |
| `tests/backend/test_api_auth.py`, `test_api_roles.py`, `test_governance_security.py` | Authentication, roles, governance, security, start-up | J | C | Security testing |
| `tests/backend/test_api_workspace.py` | Search, workspace, admin corpus, static security | **Shared** | both | Crosses services |
| `tests/backend/helpers.py` | Isolated test server fixtures | J | C | Backend test harness |
| `tests/e2e/` (specs, config, `serve_e2e.py`, manifests) | Playwright browser, responsive, accessibility and role tests | C | J | Browser testing. J reviews the security assertions |

### Documentation and repository

| Path | Purpose | Primary | Reviewer |
|---|---|---|---|
| `README.md` | Project overview and setup | C | J |
| `docs/architecture.md`, `docs/roles-and-onboarding.md` | Architecture, security, roles | J | C |
| `docs/design-system.md`, `docs/corpus-inventory.md`, `docs/screenshots/` | Design system, corpus, screenshots | C | J |
| `docs/test-results.md` | Verified test results | Shared | both |
| `docs/week1-checklist.md`, `docs/week2-handoff.md`, `docs/week2-checklist.md`, `docs/week3-handoff.md` | Academic acceptance and handoff | Shared | both |
| `docs/team-responsibilities.md`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md` | Collaboration and licences | Shared | both |
| `.gitignore`, `.env.example`, `requirements.txt` | Repository safety and configuration | J | C |

## Balance

Measured by expected effort rather than file count:

- **Jitesh** carries the deepest algorithmic and security work: ranked retrieval and index lifecycle, analytics APIs and benchmarking, plus most backend tests.
- **Chaitain** carries the largest code surface (the whole frontend) and the document pipeline, snippet generation, the pandas/matplotlib analysis, search-quality evaluation and the browser test suite. This includes substantial Python work.
- The integration layer (`app.py`, `overview.py`, `services/search.py`, `corpus.py`) and all documentation and submission work are shared, so both developers work on the core of the system.
