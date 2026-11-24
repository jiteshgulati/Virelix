# Contributing to Virelix

Two developers maintain Virelix. Responsibilities and module ownership are in
[docs/team-responsibilities.md](docs/team-responsibilities.md). Anyone may work in any area; the
primary maintainer of an area reviews changes to it.

## Local setup

```bash
git clone https://github.com/jiteshgulati/Virelix.git
cd Virelix
cp .env.example .env        # Windows: copy .env.example .env   (local only, never committed)
python3 run.py              # Windows: py run.py   →  http://localhost:8000
```

- Python 3.11+ only; the application has **no** package dependencies and **no** build step, and runs natively on Windows, Linux and macOS. Never signal or probe processes with `os.kill`: it terminates the target on Windows. Use the portable `DataDirLock` for exclusion.
- Each developer's own copy is a separate installation with its own `.env` and `data/`. Put **your own** address in `OWNER_EMAIL` for local work. The shared installation has a single Owner (see [docs/roles-and-onboarding.md](docs/roles-and-onboarding.md)).
- In development, verification links are printed in the server console.

## Non-negotiable conventions

- **Stack:** Python standard library backend; HTML5, CSS3, Bootstrap 5, vanilla JavaScript ES modules. No frameworks, TypeScript, bundlers or external backend services. Node.js and Playwright are development-only.
- **Rendering:** build HTML only with the `html` tagged template from `core/dom.js`, which escapes every value. Never assign untrusted strings to `innerHTML`. Link targets from data go through `safePath`.
- **Authorization lives in the backend.** Every protected route declares its role in `backend/app.py`, and services re-check privileged operations. Hiding UI is never a security control.
- **Privacy:** no role may read another account's history, saved items, collections, attachments, sessions or notifications.
- **Honesty:** never show invented results, scores, analytics, deliveries or AI output. Unavailable features say so.
- **Product language:** the running app must not mention academic weeks, project IDs or team codes. `TerminologyTests` and `professional.spec.js` enforce this. Academic material belongs in `docs/` and the README's academic section.
- Keep the existing design system ([docs/design-system.md](docs/design-system.md)). Don't introduce one-off colours or fonts.

## Branches

Branch from an up-to-date `master` and name branches after real work:

| Prefix | Use | Examples |
|---|---|---|
| `feature/` | New capability | `feature/search-ranking`, `feature/snippet-generation`, `feature/query-analytics` |
| `fix/` | Bug fix | `fix/authentication`, `fix/responsive-layout` |
| `docs/` | Documentation only | `docs/architecture` |
| `test/` | Tests only | `test/search-quality` |
| `chore/` | Tooling and maintenance | `chore/update-playwright` |

Create a branch only when you start the work. Don't create placeholder branches.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary` in the
imperative, ≤ 72 characters, e.g. `feat(index): store term positions`,
`fix(auth): revoke sessions on suspension`, `test(e2e): cover filter reset`.

- One logical change per commit. Don't make empty or artificially split commits, and don't back-date anything.
- Commits carry only the people who did the work. Don't add tool or assistant names as author, committer or co-author, and don't paste tool signatures into commit messages or pull requests.
- Commit with your own identity, not your teammate's. Use GitHub's noreply address (Settings → Emails) to keep your real email private.
- **On a shared computer**, don't rely on a single global `user.name`; set the author per commit:

  ```bash
  # Jitesh
  git -c user.name="Jitesh Gulati" -c user.email="291272817+jiteshgulati@users.noreply.github.com" commit
  # Chaitain
  git -c user.name="Chaitain Gupta" -c user.email="281244573+chaitanya-gupta-07@users.noreply.github.com" commit
  ```

  Push with the same person's GitHub login (`gh auth switch` between accounts), so push activity matches authorship.
- For genuine pair work, add a trailer both of you agree to:
  `Co-authored-by: Name <id+username@users.noreply.github.com>`.

## Pull requests

1. Push your branch and open a pull request into `master` using the template.
2. Request review from the other developer. `.github/CODEOWNERS` requests the right reviewer automatically. Changes to a shared module (`backend/app.py`, `backend/search/overview.py`, `backend/services/search.py`, `backend/services/corpus.py`, `docs/api.md`) always need the other developer's approval.
3. Before requesting review, run both test suites and update docs and screenshots if behaviour or UI changed.
4. Merge with **squash** or a normal merge commit after approval. Never force-push `master` or rewrite published history.
5. Delete the branch after merging.

## Tests

```bash
python3 -m unittest discover -s tests/backend -t .      # backend, standard library only

cd tests/e2e
npm ci                                                  # uses the committed lockfile
npx playwright install chromium                         # Linux may also need: npx playwright install-deps
npx playwright test                                     # isolated server on port 8799
npx playwright test screenshots                         # regenerate docs/screenshots
```

Browser tests start their own server with a copied corpus, a temporary data folder and synthetic
accounts. They never touch `data/` or a running instance. Stop anything else using port 8799 first.

## Security and sensitive files

- Never commit `.env`, anything in `data/` (accounts, tokens, sessions, private user content), logs, or browser-test output. `.gitignore` covers these, so check `git status` before every commit.
- **Never paste GitHub tokens or passwords into chat, code, issues, commit messages or remote URLs.** Authenticate with `gh auth login` (browser flow) or a credential manager. If a token is exposed, revoke it immediately.
- Test data must be synthetic (`@virelix.test`, `@example.test`). Never use real addresses in tests or docs.
- Admins uploading documents in a local copy add files to `corpus/`. Don't commit those unless they're intended sample documents. Then regenerate the inventory with `python3 scripts/corpus_inventory.py`.

## Milestone boundaries

Work is planned against the academic PRD. See [docs/week1-checklist.md](docs/week1-checklist.md)
and [docs/week2-handoff.md](docs/week2-handoff.md). Implement a milestone only when the team
starts it, and keep the product interface free of milestone wording.
