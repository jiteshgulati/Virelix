// Keeps the client's view of the signed-in account in step with the server, which is the only
// authority on identity, status and role. Called on 403 responses, periodically on navigation,
// and when a page is restored from the browser's back/forward cache.
import { get } from "./api.js";
import { session } from "./store.js";
import { navigate, render, resetShell } from "./router.js";

let inflight = null;

export function syncSession({ quiet = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const s = await get("/api/auth/session", { quiet401: true });
      const before = session.user;
      if (!s.authenticated) {
        if (before) {
          session.set({ user: null, unread: 0 });
          resetShell();
          navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
        }
        return "signed-out";
      }
      const roleChanged = !before || before.role !== s.user.role;
      session.set({ user: s.user, unread: s.user.unread_notifications || 0 });
      if (roleChanged && before) {
        resetShell();
        await render();
        if (!quiet) {
          const { toast } = await import("../components/feedback.js");
          toast("Your account access has changed. Navigation has been updated.", { tone: "info", timeout: 6000 });
        }
        return "changed";
      }
      return "unchanged";
    } catch {
      return "error";
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
