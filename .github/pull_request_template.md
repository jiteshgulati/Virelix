## What and why

<!-- What does this change do, and why is it needed? Link the issue or milestone item. -->

## Area

- [ ] Backend platform / security
- [ ] Search engine / documents
- [ ] Frontend
- [ ] Analysis / evaluation
- [ ] Docs / tooling

Shared module touched (`backend/app.py`, `backend/search/overview.py`, `backend/services/search.py`, `backend/services/corpus.py`, `docs/api.md`)? If so, the other developer must approve.

## Checklist

- [ ] `python3 -m unittest discover -s tests/backend -t .` passes
- [ ] `cd tests/e2e && npx playwright test` passes (or explain why it wasn't run)
- [ ] No `.env`, `data/`, tokens or real email addresses in the diff
- [ ] No invented results, scores or analytics; unavailable features are labelled
- [ ] No academic milestone wording in the running app
- [ ] Docs, API reference and screenshots updated if behaviour or UI changed
