import { get, onUnauthenticated, onForbidden } from "./core/api.js";
import { syncSession } from "./core/sync.js";
import { session } from "./core/store.js";
import { applyPrefs } from "./core/prefs.js";
import { configure, startRouter, navigate, resetShell } from "./core/router.js";
import { createShell } from "./components/shell.js";
import { toast } from "./components/feedback.js";

configure({ shellFactory: createShell });

onUnauthenticated(() => {
  if (!session.user) return;
  session.set({ user: null, unread: 0 });
  resetShell();
  toast("Your session ended. Sign in again to continue.", { tone: "info" });
  const next = encodeURIComponent(location.pathname + location.search);
  navigate(`/login?next=${next}`, { replace: true });
});

// A 403 can mean the server changed this account's role (e.g. Admin access removed): re-sync.
onForbidden(() => { if (session.user) syncSession(); });

// Pages restored from the back/forward cache must not show a stale signed-in view.
window.addEventListener("pageshow", (e) => { if (e.persisted) syncSession({ quiet: true }); });

// "/" focuses the nearest search field (unless typing in a field already).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest("input, textarea, select, [contenteditable='true']")) return;
  const field = document.querySelector("[data-search-input]");
  if (field) { e.preventDefault(); field.focus(); field.select(); }
});

async function boot() {
  try {
    const s = await get("/api/auth/session");
    session.set({ user: s.authenticated ? s.user : null, devMailbox: !!s.dev_mailbox, unread: s.user?.unread_notifications || 0 });
    if (s.authenticated) applyPrefs(s.user.prefs);
  } catch (err) {
    session.set({ user: null });
    console.error(err);
  }
  await startRouter();
}

boot();
