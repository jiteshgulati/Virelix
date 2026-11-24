// Application shell: sidebar navigation, top bar, notifications, account menu, mobile drawer.
import { html, mount, on, initials, $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { session } from "../core/store.js";
import { get, post, patch, del } from "../core/api.js";
import { navigate, resetShell } from "../core/router.js";
import { syncSession } from "../core/sync.js";
import { applyPrefs } from "../core/prefs.js";
import { relative, roleLabel, safePath } from "../core/format.js";
import { toast, toastError } from "./feedback.js";

const WORKSPACE = [
  { id: "home", href: "/", label: "Home", icon: "home" },
  { id: "search", href: "/search", label: "Search", icon: "search" },
  { id: "history", href: "/history", label: "Search history", icon: "history" },
  { id: "saved", href: "/saved", label: "Saved results", icon: "bookmark" },
  { id: "collections", href: "/collections", label: "Collections", icon: "stack" },
  { id: "files", href: "/files", label: "Your files", icon: "paperclip" },
];
const ADMIN = [
  { id: "admin", href: "/admin", label: "Overview", icon: "activity" },
  { id: "admin-docs", href: "/admin/documents", label: "Global documents", icon: "folder" },
  { id: "admin-index", href: "/admin/index", label: "Index management", icon: "index" },
  { id: "admin-users", href: "/admin/users", label: "Users", icon: "users" },
  { id: "admin-analytics", href: "/admin/analytics", label: "Search analytics", icon: "chart" },
  { id: "admin-quality", href: "/admin/quality", label: "Search quality", icon: "target" },
  { id: "admin-system", href: "/admin/system", label: "System", icon: "monitor" },
];
const OWNER = [
  { id: "owner-admins", href: "/owner/admins", label: "Admin management", icon: "key" },
  { id: "owner-platform", href: "/owner/platform", label: "Ownership & platform", icon: "crown" },
];
const FOOT = [
  { id: "settings", href: "/settings", label: "Settings", icon: "settings" },
  { id: "help", href: "/help", label: "Help", icon: "help" },
];
const SECTION = (nav) => (nav?.startsWith("owner") ? "Governance" : nav?.startsWith("admin") ? "Administration" : "Workspace");

function navList(items, collapsed) {
  return html`<ul class="vx-nav">${items.map((i) => html`<li><a href="${i.href}" data-nav="${i.id}"
    ${collapsed ? html`data-bs-toggle="tooltip" data-bs-placement="right" data-bs-title="${i.label}"` : ""}>
    ${icon(i.icon)}<span class="nav-text">${i.label}</span></a></li>`)}</ul>`;
}

function navGroups(user, collapsed = false) {
  const role = user.role;
  return html`
    <div class="vx-nav-group"><div class="vx-nav-label"><span>Workspace</span></div>${navList(WORKSPACE, collapsed)}</div>
    ${role !== "user" ? html`<div class="vx-nav-group"><div class="vx-nav-label"><span>Administration</span></div>${navList(ADMIN, collapsed)}</div>` : ""}
    ${role === "owner" ? html`<div class="vx-nav-group"><div class="vx-nav-label"><span>Governance</span></div>${navList(OWNER, collapsed)}</div>` : ""}`;
}

export function wordmark(size = "sm", href = "/") {
  return html`<a class="vx-wordmark ${size}" href="${href}" aria-label="Virelix home">Vi<span class="rest">reli</span><span class="x">x</span></a>`;
}

export function createShell(outer) {
  const root = document.createElement("div");
  outer.replaceChildren(root);
  const user = session.user;
  const collapsed = document.documentElement.dataset.sidebar === "collapsed";
  mount(root, html`
  <div class="vx-app">
    <aside class="vx-sidebar desktop" aria-label="Primary">
      <div class="vx-sidebar-head">
        ${wordmark()}
        <button type="button" class="vx-btn icon sm quiet" data-toggle-sidebar aria-label="${collapsed ? "Expand sidebar" : "Collapse sidebar"}" aria-pressed="${collapsed}">${icon("panel", "sm")}</button>
      </div>
      <nav class="vx-sidebar-scroll" aria-label="Main navigation" data-sidebar-nav>${navGroups(user, collapsed)}</nav>
      <div class="vx-sidebar-foot">${navList(FOOT, collapsed)}</div>
    </aside>

    <div class="offcanvas offcanvas-start" tabindex="-1" id="vx-drawer" aria-labelledby="vx-drawer-title">
      <div class="offcanvas-header">
        <h2 class="visually-hidden" id="vx-drawer-title">Navigation</h2>${wordmark()}
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close navigation"></button>
      </div>
      <nav class="offcanvas-body vx-sidebar-scroll" aria-label="Mobile navigation">${navGroups(user)}
        <div class="vx-nav-group">${navList(FOOT)}</div></nav>
    </div>

    <div class="vx-main">
      <header class="vx-topbar" data-topbar>
        <button type="button" class="vx-btn icon quiet mobile-only" data-bs-toggle="offcanvas" data-bs-target="#vx-drawer" aria-controls="vx-drawer" aria-label="Open navigation">${icon("menu")}</button>
        <div class="crumb"><span class="trail" data-crumb-section></span><span class="trail" aria-hidden="true">/</span><strong data-crumb-title></strong></div>
        <div class="spacer"></div>
        <a class="vx-btn icon quiet" href="/help" aria-label="Help">${icon("help")}</a>
        <div class="dropdown">
          <button type="button" class="vx-btn icon quiet vx-bell" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false" aria-label="Notifications" data-bell>
            ${icon("bell")}<span class="dot" data-unread hidden></span></button>
          <div class="dropdown-menu dropdown-menu-end vx-notifs" data-notifs></div>
        </div>
        <div class="dropdown">
          <button type="button" class="vx-account-btn" data-bs-toggle="dropdown" aria-expanded="false" data-account>
            <span class="vx-avatar" aria-hidden="true" data-avatar></span><span class="name" data-account-name></span><span class="visually-hidden"> account menu</span></button>
          <div class="dropdown-menu dropdown-menu-end" data-account-menu></div>
        </div>
      </header>
      <main id="main" tabindex="-1"><div class="vx-view" data-view></div></main>
    </div>
  </div>`);

  const viewEl = $("[data-view]", root);
  const topbar = $("[data-topbar]", root);
  const drawerEl = $("#vx-drawer", root);
  const drawer = window.bootstrap.Offcanvas.getOrCreateInstance(drawerEl);
  let tooltips = [];

  const initTooltips = () => {
    tooltips.forEach((t) => t.dispose());
    tooltips = document.documentElement.dataset.sidebar === "collapsed"
      ? Array.from(root.querySelectorAll('.vx-sidebar [data-bs-toggle="tooltip"]')).map((el) => new window.bootstrap.Tooltip(el))
      : [];
  };

  const renderAccount = () => {
    const u = session.user;
    if (!u) return;
    $("[data-avatar]", root).textContent = initials(u.name);
    $("[data-account-name]", root).textContent = u.name.split(" ")[0];
    mount($("[data-account-menu]", root), html`
      <div class="px-3 pt-2 pb-3"><div class="fw-semibold text-truncate">${u.name}</div>
        <div class="meta text-truncate">${u.email}</div>
        <div class="mt-2"><span class="vx-role-chip">${roleLabel(u.role)}</span></div></div>
      <div class="dropdown-divider"></div>
      <a class="dropdown-item" href="/settings/account">${icon("user", "sm")} Profile &amp; account</a>
      <a class="dropdown-item" href="/settings/appearance">${icon("palette", "sm")} Appearance</a>
      <a class="dropdown-item" href="/settings">${icon("settings", "sm")} Settings</a>
      <a class="dropdown-item" href="/help">${icon("help", "sm")} Help</a>
      <div class="dropdown-divider"></div>
      <button type="button" class="dropdown-item" data-logout>${icon("logout", "sm")} Sign out</button>`);
  };

  const renderUnread = () => {
    const dot = $("[data-unread]", root);
    const n = session.unread;
    dot.hidden = !n;
    dot.textContent = n > 9 ? "9+" : String(n);
    $("[data-bell]", root).setAttribute("aria-label", n ? `Notifications, ${n} unread` : "Notifications");
  };

  const loadNotifications = async () => {
    const box = $("[data-notifs]", root);
    mount(box, html`<header><strong>Notifications</strong></header><div class="list p-3"><div class="vx-skeleton vx-skel-line"></div><div class="vx-skeleton vx-skel-line w-75"></div></div>`);
    try {
      const data = await get("/api/notifications");
      session.set({ unread: data.unread });
      renderUnread();
      mount(box, html`<header><strong>Notifications</strong>
        <div class="vx-row gap-1">
          <button type="button" class="vx-btn sm quiet" data-mark-read ${data.unread ? "" : "disabled"}>Mark all read</button>
          <button type="button" class="vx-btn sm quiet" data-clear-notifs ${data.items.length ? "" : "disabled"}>Clear</button></div></header>
        <div class="list">${data.items.length ? data.items.map((n) => {
          const inner = html`<span class="pip" aria-hidden="true"></span><div><div class="t">${n.title}</div>${n.body ? html`<div class="b">${n.body}</div>` : ""}<div class="w">${relative(n.created_at)}${n.read ? "" : " · unread"}</div></div>`;
          const link = safePath(n.link);
          return link ? html`<a class="vx-notif ${n.read ? "" : "unread"}" href="${link}">${inner}</a>` : html`<div class="vx-notif ${n.read ? "" : "unread"}">${inner}</div>`;
        }) : html`<div class="p-4 text-center"><div class="meta">You're all caught up.</div><div class="meta mt-1">Account, security and role changes appear here.</div></div>`}</div>
        <footer>In-app only. Virelix doesn't send email or push notifications.</footer>`);
    } catch (err) {
      mount(box, html`<header><strong>Notifications</strong></header><div class="p-3"><div class="vx-notice danger">${icon("alert")}<div>${err.message}</div></div></div>`);
    }
  };

  const refreshUnread = async () => {
    try { const d = await get("/api/notifications", { quiet401: true }); session.set({ unread: d.unread }); renderUnread(); } catch { /* ignore */ }
  };

  // events
  const offs = [];
  offs.push(on(root, "click", "[data-logout]", async () => {
    try { await post("/api/auth/logout"); } catch { /* session may already be gone */ }
    session.set({ user: null, unread: 0 });
    resetShell();
    navigate("/login", { replace: true });
    toast("You've been signed out.", { tone: "info" });
  }));
  offs.push(on(root, "click", "[data-toggle-sidebar]", async (e, btn) => {
    const next = document.documentElement.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
    applyPrefs({ sidebar: next });
    lastSidebar = next;
    btn.setAttribute("aria-pressed", String(next === "collapsed"));
    btn.setAttribute("aria-label", next === "collapsed" ? "Expand sidebar" : "Collapse sidebar");
    rebuildNav();
    try {
      const r = await patch("/api/me/prefs", { sidebar: next });
      session.set({ user: { ...session.user, prefs: r.prefs } });
    } catch (err) { toastError(err); }
  }));
  offs.push(on(root, "click", "[data-mark-read]", async () => {
    try { await post("/api/notifications/read", {}); await loadNotifications(); } catch (err) { toastError(err); }
  }));
  offs.push(on(root, "click", "[data-clear-notifs]", async () => {
    try { await del("/api/notifications"); await loadNotifications(); } catch (err) { toastError(err); }
  }));
  $("[data-bell]", root).addEventListener("show.bs.dropdown", loadNotifications);
  drawerEl.addEventListener("click", (e) => { if (e.target.closest("a[href]")) drawer.hide(); });
  const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  const alive = () => document.body.contains(root);

  function rebuildNav() {
    const isCollapsed = document.documentElement.dataset.sidebar === "collapsed";
    mount($("[data-sidebar-nav]", root), navGroups(session.user, isCollapsed));
    mount($(".vx-sidebar-foot", root), navList(FOOT, isCollapsed));
    markActive(current);
    initTooltips();
  }

  let current = null;
  let lastRefresh = 0;
  function markActive(route) {
    root.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === route?.nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  let lastSidebar = document.documentElement.dataset.sidebar;
  renderAccount();
  renderUnread();
  initTooltips();
  const unsub = session.subscribe(() => {
    if (!alive()) { unsub(); window.removeEventListener("scroll", onScroll); tooltips.forEach((t) => t.dispose()); return; }
    renderAccount(); renderUnread();
    if (document.documentElement.dataset.sidebar !== lastSidebar) {
      lastSidebar = document.documentElement.dataset.sidebar;
      const btn = $("[data-toggle-sidebar]", root);
      btn.setAttribute("aria-pressed", String(lastSidebar === "collapsed"));
      btn.setAttribute("aria-label", lastSidebar === "collapsed" ? "Expand sidebar" : "Collapse sidebar");
      rebuildNav();
    }
  });

  return {
    viewEl,
    update(route) {
      current = route;
      markActive(route);
      $("[data-crumb-section]", root).textContent = SECTION(route.nav);
      $("[data-crumb-title]", root).textContent = route.title || "Home";
      if (Date.now() - lastRefresh > 15000) { lastRefresh = Date.now(); syncSession(); }
    },
    refreshUnread,
  };
}
