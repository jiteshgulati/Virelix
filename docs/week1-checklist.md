# Week 1 acceptance checklist — Planning and Search Engine Foundation

Status key: ✅ done and verified by automated tests · ☑️ done, verified manually or by inspection · ⏭ scheduled for a later week (not claimed).

## Academic PRD — Week 1

| Requirement | Status | Evidence |
|---|---|---|
| Problem statement, objectives, target users | ☑️ | [architecture.md §1–3](architecture.md) |
| Functional and non-functional requirements | ☑️ | [architecture.md §4–5](architecture.md) |
| Core modules, frontend/backend interaction, data structures | ☑️ | [architecture.md §6–8](architecture.md) |
| API contracts | ☑️ | [api.md](api.md) |
| Security boundaries | ☑️ | [architecture.md §10](architecture.md) |
| Future milestone integration points | ☑️ | [architecture.md §11](architecture.md), [week2-handoff.md](week2-handoff.md) |
| Organised repository (backend, frontend, corpus, data, tests, docs, analysis) | ☑️ | [README.md](../README.md#repository-layout) |
| Config template, git ignore rules, startup command, no secrets | ☑️ | `.env.example`, `.gitignore`, `python run.py` |
| ~31 meaningful TXT documents with metadata and inventory | ✅ | `corpus/` (31 files, 12 subjects, 7,042 words) · [corpus-inventory.md](corpus-inventory.md) · `test_sample_corpus_loads_completely` |
| Loader: discover, read, stable IDs, titles and metadata, counts and file info | ✅ | `backend/search/loader.py` · `test_loader.py` |
| Loader: empty, unsupported, malformed or encoding problems, missing or inaccessible folders | ✅ | `test_empty_files_are_skipped`, `test_unsupported_types_are_skipped`, `test_binary_content_is_rejected`, `test_cp1252_fallback_with_warning`, `test_utf8_bom_and_utf16`, `test_missing_folder`, `test_unreadable_file` |
| Preprocessing: lowercase, punctuation, whitespace, tokenisation, empty input | ✅ | `backend/search/preprocess.py` · 16 tests in `test_preprocess.py` |
| Inverted-index data model: terms, doc IDs, postings, TF, metadata, vocabulary stats | ✅ | `backend/search/index.py` · `InvertedIndexTests` |
| Basic structure initialised and inspectable | ✅ | Admin → Index management · `test_upload_index_and_remove` · browser test "index foundation: build, inspect vocabulary and postings" |
| Responsive search interface connected to the foundation | ✅ | `/search` · `search.spec.js` · responsive tests at 6 widths |
| Preview clearly distinguished from ranked search; no invented scores | ✅ | "Document search preview" labels; `test_no_scores_are_reported` |
| Full index construction, TF ranking, query processing, snippets | ⏭ Week 2 | [week2-handoff.md](week2-handoff.md) |
| Query logging, pandas, Zipf charts | ⏭ Week 3 | `analysis/README.md`, Admin → Search analytics (empty state) |
| Evaluation metrics, performance, report, demo | ⏭ Week 4 | Admin → Search quality (prerequisites) |

## Virelix product specification

| Area | Status | Evidence |
|---|---|---|
| Stack: Python stdlib backend, HTML/CSS/Bootstrap 5/vanilla ES modules, JSON storage, no build step | ☑️ | No runtime dependencies (`requirements.txt`); Bootstrap vendored |
| Typography-led brand identity across themes | ☑️ | Wordmark in `components/shell.js`; [design-system.md](design-system.md); screenshots 23–24 |
| Roles Member/Admin/Owner enforced in the backend; no role on registration | ✅ | `test_role_input_is_ignored`, `RoleAuthorizationTests`, `roles.spec.js` |
| Owner only via verified `OWNER_EMAIL`; single Owner; no automatic transfer | ✅ | `OwnerBootstrapTests`, `OwnerGovernanceTests` |
| Registration, login, remember me, visibility toggle, validation | ✅ | `RegistrationTests`, `auth.spec.js` |
| Email verification: expiry, single use, resend, success and failure screens | ✅ | `VerificationAndLoginTests`, `auth.spec.js` |
| Password recovery with expiry, single use, session invalidation | ✅ | `PasswordRecoveryTests`, `auth.spec.js` |
| Session security: hashing, cookies, CSRF, throttling, logout, suspension | ✅ | `test_session_cookie_flags_and_logout`, `test_csrf_and_origin_enforced`, `test_wrong_password_is_generic_and_throttled`, `SuspensionTests` |
| Honest dev email (no fake delivery); no fake OAuth buttons | ✅ | Delivery notices; key-protected developer mailbox (`MailboxExposureTests`, `professional.spec.js`); no third-party sign-in |
| Owner Admin management: invite, pending/accepted/expired/revoked, resend, revoke, accept, remove | ✅ | `InvitationLifecycleTests`, `roles.spec.js` |
| Navigation: role-aware, active state, mobile drawer | ✅ | `roles.spec.js`, "mobile navigation drawer" test |
| Homepage: brand, search, single clear control, attach, unavailable mic, account, help, notifications, four entry points, no idle tabs | ✅ | `search.spec.js` (first test), `workspace.spec.js` |
| Results: categories, floating filter (escape, focus, persistence, reset), sort, pagination, view, save, collection, more menu, follow-up, empty states | ✅ | `search.spec.js` |
| AI Overview as extractive preview with real references and Save Answer | ✅ | `test_overview_is_extractive_with_real_references`, `test_save_overview_is_server_derived`, `search.spec.js` |
| Document viewer: content, metadata, back, save, collection, missing doc, safe rendering | ✅ | `search.spec.js`, `test_document_viewer_api`; text rendered escaped |
| History, saved results, collections (duplicates and missing items handled) | ✅ | `SearchAndWorkspaceTests`, `search.spec.js`, `workspace.spec.js` |
| Private attachments: TXT only, size limit, isolation, never in corpus | ✅ | `test_attachments_private_and_validated`, `workspace.spec.js` |
| Settings: account, appearance (light/dark/OLED/system, accent, text, density, sidebar, motion), privacy, search, notifications, display | ✅ | `workspace.spec.js`, `test_preferences_validation` |
| Admin overview, global documents (upload, filter, sort, preview, metadata, remove, bulk select), index management, users, analytics, quality, system | ✅ | `admin.spec.js`, `AdminCorpusTests`, `SuspensionTests` |
| Owner workspace: Admin management, ownership and platform, audit log | ✅ | `roles.spec.js`, `admin.spec.js` |
| Responsiveness at 1920/1440/1024/768/390/320, all themes | ✅ | `responsive-a11y.spec.js`; screenshots 23–28 |
| Accessibility (axe WCAG 2.1 A/AA, light and dark; keyboard; focus return) | ✅ | `responsive-a11y.spec.js` |
| Static route protection, safe filenames, atomic persistence, audit log | ✅ | `StaticSecurityTests`, `test_upload_index_and_remove`; `storage.py` |
| Screenshots of major pages | ✅ | [screenshots/](screenshots/) (29 images, generated by `screenshots.spec.js`) |

## Professionalisation pass (product terminology and governance)

| Item | Status | Evidence |
|---|---|---|
| No academic schedule language in runtime code or any screen, for any role | ✅ | `TerminologyTests` (source scan), `professional.spec.js` (visible text, titles, labels, tooltips: public, Member, Admin, Owner) |
| Role-based navigation: Workspace / Administration / Governance | ✅ | `professional.spec.js` |
| Permission matrix enforced in the backend | ✅ | [roles-and-onboarding.md](roles-and-onboarding.md); `RoleAuthorizationTests`, `LivePrivilegeAndIsolationTests` |
| Admin removal and suspension take effect in open sessions | ✅ | `test_admin_removal_takes_effect_in_the_active_session`, `SuspensionTests`, `professional.spec.js` |
| Developer mailbox: development only, loopback socket, console key | ✅ | `MailboxExposureTests`, `test_dev_mailbox_requires_developer_key` |
| Injection safety (stored and reflected), entity-safe highlighting, safe link targets | ✅ | `professional.spec.js` "Injection safety" |
| Light theme default for new visitors and accounts | ✅ | `test_new_accounts_default_to_light_theme`, `professional.spec.js` |
| Documented start-up works; single server per data folder | ✅ | `StartupTests` |
