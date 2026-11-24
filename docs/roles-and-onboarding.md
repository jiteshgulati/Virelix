# Roles, permissions and onboarding

Virelix has exactly three account roles. The backend is the only authority: every protected API
checks the signed-in account's current role and status on **every request**, so role changes and
suspensions take effect immediately, including in sessions that are already open. Hidden buttons
and client-side route guards are presentation only.

| Role (internal id) | Shown as | How it's obtained |
|---|---|---|
| Normal user (`user`) | Member | Every public registration |
| Admin (`admin`) | Admin | Accepting an Owner's invitation (email-bound, expiring, single use) |
| Owner (`owner`) | Owner | The verified account matching `OWNER_EMAIL`; one per installation |

## Permission matrix

| Interface or capability | Member | Admin | Owner |
|---|:-:|:-:|:-:|
| Home and search, categories and filters | ✅ | ✅ | ✅ |
| AI Overview (extractive preview) | ✅ | ✅ | ✅ |
| Read shared documents | ✅ | ✅ | ✅ |
| Own attachments, history, saved results, collections | ✅ | ✅ | ✅ |
| Own settings, account, sessions, notifications | ✅ | ✅ | ✅ |
| Help and sign out | ✅ | ✅ | ✅ |
| Admin overview | ⛔ | ✅ | ✅ |
| Global documents: list, upload, preview, remove | ⛔ | ✅ | ✅ |
| Index management: inspect and rebuild | ⛔ | ✅ | ✅ |
| User directory; suspend or reactivate **members** | ⛔ | ✅ | ✅ |
| Search analytics, search quality, system pages | ⛔ | ✅ | ✅ |
| Admin management: invite, resend, revoke, remove Admin | ⛔ | ⛔ | ✅ |
| Ownership & platform; governance audit log | ⛔ | ⛔ | ✅ |
| Another account's private workspace | ⛔ | ⛔ | ⛔ |
| Raise one's own role through any input | ⛔ | ⛔ | ⛔ |
| Read others' password hashes, sessions or tokens | ⛔ | ⛔ | ⛔ |

Additional rules enforced in the services:

- Admins can suspend and reactivate **members only**: never an Admin, the Owner or themselves.
- Suspension and Admin removal apply immediately. Suspension also revokes every session.
- No role, including the Owner, can read another account's history, saved items, collections, attachments, sessions or notifications. Foreign resource IDs return `404`.
- Unauthenticated requests get `401`; authenticated requests without permission get `403`.

Navigation shows one group per granted area: **Workspace** (everyone), **Administration** (Admin and Owner), **Governance** (Owner).

## Owner designation

- `OWNER_EMAIL` is read from the environment or `.env`, trimmed and lower-cased. An invalid address designates nobody and is reported at start-up.
- The Owner role is **granted only** when no Owner exists yet and the matching account is **verified and active**. It's checked when the account verifies its email and at every start-up, inside the user-store lock, so concurrent requests can't create two Owners.
- Registration input, the first account, browser state and URL parameters never confer any role.
- **No automatic transfer.** If the stored Owner no longer matches `OWNER_EMAIL` (or there is more than one Owner record, or the variable was removed), Virelix changes nothing, locks Owner-only governance, keeps that account's Admin capabilities and data, and prints a warning at start-up. To resolve it, either:
  1. restore `OWNER_EMAIL` to the established Owner's address and restart; or
  2. hand over deliberately: stop the server, run `python scripts/owner_recovery.py status`, then
     `python scripts/owner_recovery.py release --email <current-owner> --confirm`, and restart.
     The released account becomes a member and keeps its data; the verified `OWNER_EMAIL` account becomes Owner.

### Shared installation vs. local copies

One shared Virelix installation has **one** Owner. Teammates don't set their own `OWNER_EMAIL` on
that installation; they register normally and the Owner invites them as Admins. A teammate running
a separate copy on their own machine has a separate installation with its own `.env` and data.

## Onboarding workflow

1. **Configure.** Put the Owner's address in `.env` as `OWNER_EMAIL=…` (never in `.env.example` or source code).
2. **Start** with `python run.py` (or `python3 run.py`). The console shows the Owner status.
3. **Register** at `/register` using exactly that address.
4. **Verify.** No email is sent in development. The verification link is printed in the server console, and in the developer mailbox, whose key is also printed there. Opening that link proves access to the server console, not control of the mailbox.
5. **Sign in.** The account menu shows *Owner*, and the Governance section appears.
6. **Invite an Admin** from Governance → Admin management. The invited person registers or signs in with *that* address, verifies, and opens the invitation link.
7. **Accept.** Only the invited, verified account can accept. Links expire after 72 hours, work once, and stop working when resent or revoked.
8. **Check.** The Admin sees Workspace and Administration, but no Governance. Ordinary registrations remain Members.

## Developer mailbox

Development mode only. Every request must satisfy all three conditions: it comes from a loopback
**socket** address (`Host` and `X-Forwarded-*` headers are ignored), it carries the developer key
printed in the console, and the server is in development mode. In any other environment the
endpoints return `404`. The page isn't linked from the application.
