// History-API router with auth/role guards, lazy views and accessible transitions.
import { session } from "./store.js";
import { prefersReducedMotion } from "./prefs.js";
import { announce, setTitle } from "./dom.js";

const ROUTES = [
  // public / auth layout
  { path: "/login", view: "auth/login", layout: "auth", guest: true, title: "Sign in" },
  { path: "/register", view: "auth/register", layout: "auth", guest: true, title: "Create account" },
  { path: "/verify-email", view: "auth/verify", layout: "auth", title: "Verify email" },
  { path: "/verify-pending", view: "auth/pending", layout: "auth", title: "Check your email" },
  { path: "/forgot-password", view: "auth/forgot", layout: "auth", title: "Forgot password" },
  { path: "/reset-password", view: "auth/reset", layout: "auth", title: "Choose a new password" },
  { path: "/invite", view: "auth/invite", layout: "auth", title: "Admin invitation" },
  { path: "/terms", view: "auth/terms", layout: "auth", title: "Terms of use" },
  { path: "/dev/mailbox", view: "dev/mailbox", layout: "auth", title: "Development mailbox" },
  // workspace
  { path: "/", view: "home", auth: true, nav: "home", title: "" },
  { path: "/search", view: "search", auth: true, nav: "search", title: "Search" },
  { path: "/documents/:id", view: "document", auth: true, nav: "search", title: "Document" },
  { path: "/attachments/:id", view: "document", auth: true, nav: "files", title: "Attachment", kind: "attachment" },
  { path: "/history", view: "history", auth: true, nav: "history", title: "Search history" },
  { path: "/saved", view: "saved", auth: true, nav: "saved", title: "Saved results" },
  { path: "/collections", view: "collections", auth: true, nav: "collections", title: "Collections" },
  { path: "/collections/:id", view: "collection", auth: true, nav: "collections", title: "Collection" },
  { path: "/files", view: "files", auth: true, nav: "files", title: "Your files" },
  { path: "/answers", view: "answers", auth: true, nav: "home", title: "AI Answers" },
  { path: "/research", view: "research", auth: true, nav: "home", title: "Research Mode" },
  { path: "/settings", view: "settings", auth: true, nav: "settings", title: "Settings" },
  { path: "/settings/:section", view: "settings", auth: true, nav: "settings", title: "Settings" },
  { path: "/help", view: "help", auth: true, nav: "help", title: "Help" },
  // admin
  { path: "/admin", view: "admin/overview", auth: true, role: "admin", nav: "admin", title: "Overview" },
  { path: "/admin/documents", view: "admin/documents", auth: true, role: "admin", nav: "admin-docs", title: "Global documents" },
  { path: "/admin/index", view: "admin/index", auth: true, role: "admin", nav: "admin-index", title: "Index management" },
  { path: "/admin/users", view: "admin/users", auth: true, role: "admin", nav: "admin-users", title: "User management" },
  { path: "/admin/analytics", view: "admin/analytics", auth: true, role: "admin", nav: "admin-analytics", title: "Search analytics" },
  { path: "/admin/quality", view: "admin/quality", auth: true, role: "admin", nav: "admin-quality", title: "Search quality" },
  { path: "/admin/system", view: "admin/system", auth: true, role: "admin", nav: "admin-system", title: "System monitoring" },
  // owner
  { path: "/owner/admins", view: "owner/admins", auth: true, role: "owner", nav: "owner-admins", title: "Admin management" },
  { path: "/owner/platform", view: "owner/platform", auth: true, role: "owner", nav: "owner-platform", title: "Ownership & platform" },
].map((r) => ({ ...r, re: new RegExp("^" + r.path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$") }));

let shell = null;          // { mountView(route), viewEl, update(route) }
let cleanup = null;
let renderToken = 0;
let renderShell = null;    // injected to avoid circular import
let firstRender = true;    // leave focus alone on the initial page load (skip link stays first)

export function configure({ shellFactory }) { renderShell = shellFactory; }

function match(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: m.groups || {} };
  }
  return null;
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) { location.href = to; return; }
  const target = url.pathname + url.search + url.hash;
  if (target === location.pathname + location.search + location.hash && !replace) return render();
  history[replace ? "replaceState" : "pushState"]({}, "", target);
  return render();
}

export function currentPath() { return location.pathname + location.search; }

export function updateQuery(params, { replace = true } = {}) {
  const url = new URL(location.href);
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) url.searchParams.delete(k);
    else url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
  });
  history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search);
}

async function loadView(name) {
  const mod = await import(`../views/${name}.js`);
  return mod.default;
}

export async function render() {
  const token = ++renderToken;
  const found = match(location.pathname);
  const root = document.getElementById("root");
  const user = session.user;

  if (found?.route.auth && !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    history.replaceState({}, "", `/login${location.pathname === "/" ? "" : `?next=${next}`}`);
    return render();
  }
  if (found?.route.guest && user) {
    history.replaceState({}, "", "/");
    return render();
  }

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }

  let route = found?.route;
  let viewName = route?.view || "notfound";
  let layout = route?.layout || (user ? "app" : "auth");
  if (route?.role && !session.hasRole(route.role)) viewName = "forbidden";

  let container;
  if (layout === "auth") {
    shell = null;
    root.replaceChildren();
    container = root;
  } else {
    if (!shell) shell = renderShell(root);
    shell.update(route || { nav: null, title: "Not found" });
    container = shell.viewEl;
    container.className = "vx-view";
  }

  const ctx = {
    params: found?.params || {},
    query: new URLSearchParams(location.search),
    route: route || {},
    navigate,
    isCurrent: () => token === renderToken,
  };

  let view;
  try {
    view = await loadView(viewName);
  } catch (err) {
    console.error(err);
    view = await loadView("error");
  }
  if (token !== renderToken) return;
  container.replaceChildren();
  setTitle(route?.title ?? "Not found");
  try {
    const result = await view(container, ctx);
    if (token !== renderToken) { if (typeof result === "function") result(); return; }
    cleanup = typeof result === "function" ? result : null;
  } catch (err) {
    console.error(err);
    if (token === renderToken) (await loadView("error"))(container, { ...ctx, error: err });
  }
  if (!prefersReducedMotion()) {
    container.classList.remove("vx-view-enter");
    void container.offsetWidth;
    container.classList.add("vx-view-enter");
  }
  window.scrollTo({ top: 0 });
  const heading = container.querySelector("h1");
  if (heading && !firstRender && !container.contains(document.activeElement)) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  firstRender = false;
  announce(document.title);
}

export function startRouter() {
  window.addEventListener("popstate", render);
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target || a.hasAttribute("download") || a.dataset.native !== undefined) return;
    const url = new URL(a.href, location.href);
    if (url.hash && url.pathname === location.pathname && url.search === location.search) {
      // In-page anchor (e.g. the skip link): move focus, don't re-render.
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (target) { e.preventDefault(); target.focus(); target.scrollIntoView({ block: "start" }); }
      return;
    }
    if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/")) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  return render();
}

export function resetShell() { shell = null; }
