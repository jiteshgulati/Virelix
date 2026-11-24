import { html, mount, $, $$, on } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, post, patch, del } from "../core/api.js";
import { session } from "../core/store.js";
import { applyPrefs } from "../core/prefs.js";
import { datetime, relative, roleLabel, plural } from "../core/format.js";
import { navigate } from "../core/router.js";
import { passwordField, bindReveal, strength } from "../components/auth-layout.js";
import { confirmDialog, toast, toastError, setBusy, showFieldErrors, clearFieldErrors, formError } from "../components/feedback.js";
import { errorBlock } from "../components/states.js";

const SECTIONS = [
  { id: "account", label: "Account", icon: "user" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "privacy", label: "Privacy & security", icon: "shield" },
  { id: "search", label: "Search preferences", icon: "search" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "display", label: "Display", icon: "sliders" },
];
const ACCENTS = [["viridian", "Viridian"], ["lapis", "Lapis"], ["oxblood", "Oxblood"], ["ochre", "Ochre"], ["plum", "Plum"], ["graphite", "Graphite"]];

export default function settings(root, ctx) {
  const section = SECTIONS.some((s) => s.id === ctx.params.section) ? ctx.params.section : "account";
  if (ctx.params.section && ctx.params.section !== section) { navigate("/settings", { replace: true }); return; }
  mount(root, html`<header class="vx-page-head"><div class="titles"><div class="eyebrow">Settings</div>
      <h1 class="page-title">${SECTIONS.find((s) => s.id === section).label}</h1></div></header>
    <div class="vx-settings">
      <nav class="vx-subnav" aria-label="Settings sections">${SECTIONS.map((s) => html`<a href="/settings/${s.id}" ${s.id === section ? html`aria-current="page"` : ""}>${icon(s.icon, "sm")} ${s.label}</a>`)}</nav>
      <div data-section></div>
    </div>`);
  const slot = $("[data-section]", root);
  const renderers = { account, appearance, privacy, search: searchPrefs, notifications, display };
  return renderers[section](slot, ctx);
}

const prefs = () => session.user.prefs;

async function savePrefs(changes, { quiet = false } = {}) {
  const before = { ...prefs() };
  applyPrefs(changes);
  try {
    const r = await patch("/api/me/prefs", changes);
    session.set({ user: { ...session.user, prefs: r.prefs } });
    if (!quiet) toast("Preference saved.", { timeout: 1800 });
    return true;
  } catch (err) {
    applyPrefs(before);
    toastError(err);
    return false;
  }
}

function setting({ title, desc = "", control, stacked = false }) {
  return html`<div class="vx-setting ${stacked ? "stacked" : ""}"><div><div class="t">${title}</div>${desc ? html`<div class="d">${desc}</div>` : ""}</div><div>${control}</div></div>`;
}

function segment(name, value, options, label) {
  return html`<div class="vx-segment" role="radiogroup" aria-label="${label}">${options.map(([v, l]) => html`<label>
    <input type="radio" name="${name}" value="${v}" ${String(value) === String(v) ? "checked" : ""}><span>${l}</span></label>`)}</div>`;
}

function toggle(name, checked, label) {
  return html`<label class="vx-switch"><span class="visually-hidden">${label}</span><input type="checkbox" role="switch" name="${name}" ${checked ? "checked" : ""}></label>`;
}

/** Bind radio/checkbox changes inside slot to preference updates. */
function bindPrefInputs(slot, cast = {}) {
  slot.addEventListener("change", async (e) => {
    const input = e.target;
    if (!input.name || input.closest("form[data-own]")) return;
    let value;
    if (input.type === "checkbox" && input.dataset.group) {
      value = $$(`input[name="${input.name}"]:checked`, slot).map((i) => i.value);
      if (!value.length) { input.checked = true; toast("Keep at least one source selected.", { tone: "info" }); return; }
    } else if (input.type === "checkbox") value = input.checked;
    else value = cast[input.name] ? cast[input.name](input.value) : input.value;
    const ok = await savePrefs({ [input.name]: value });
    if (!ok) { if (input.type === "checkbox") input.checked = !input.checked; }
  });
}

// ---------------------------------------------------------------- account
function account(slot) {
  const u = session.user;
  mount(slot, html`<div class="vx-stack-lg">
    <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Profile</h2></div>
      <form class="vx-panel-body vx-stack" novalidate data-profile data-own>
        <div data-form-error hidden></div>
        <div class="vx-grid-2">
          <div class="vx-field"><label class="vx-label" for="pf-name">Full name</label>
            <input class="vx-input" id="pf-name" name="name" value="${u.name}" maxlength="80" autocomplete="name" required aria-describedby="pf-name-err">
            <div class="vx-error" id="pf-name-err" data-error-for="name" role="alert"></div></div>
          <div class="vx-field"><label class="vx-label" for="pf-email">Email</label>
            <input class="vx-input" id="pf-email" value="${u.email}" readonly aria-describedby="pf-email-hint">
            <div class="vx-hint" id="pf-email-hint">${u.email_verified ? "Verified." : "Not verified."} Email changes aren't supported in this version.</div></div>
        </div>
        <dl class="vx-ledger"><div><dt>Role</dt><dd><span class="vx-role-chip">${roleLabel(u.role)}</span></dd></div>
          <div><dt>Member since</dt><dd>${datetime(u.created_at)}</dd></div>
          <div><dt>Last sign-in</dt><dd>${datetime(u.last_login_at)}</dd></div></dl>
        <div><button type="submit" class="vx-btn primary">Save profile</button></div>
      </form></section>
    <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Change password</h2><span class="meta">Last changed ${relative(u.password_changed_at)}</span></div>
      <form class="vx-panel-body vx-stack" novalidate data-password data-own>
        <div data-form-error hidden></div>
        ${passwordField({ id: "pw-current", name: "current_password", label: "Current password", autocomplete: "current-password" })}
        <div class="vx-grid-2">
          <div>${passwordField({ id: "pw-new", name: "new_password", label: "New password", autocomplete: "new-password", hint: "At least 10 characters, with a letter and a number." })}
            <div class="vx-strength mt-2" data-score="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
          ${passwordField({ id: "pw-confirm", name: "confirm_password", label: "Confirm new password", autocomplete: "new-password" })}
        </div>
        <p class="meta">Other signed-in sessions are signed out when your password changes. This one stays signed in.</p>
        <div><button type="submit" class="vx-btn primary">Update password</button></div>
      </form></section>
  </div>`);

  const pf = $("[data-profile]", slot);
  pf.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(pf); formError(pf, null);
    const name = pf.elements.name.value.trim();
    if (name.length < 2) { showFieldErrors(pf, { fields: { name: "Enter your full name." } }); return; }
    const btn = pf.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      const me = await patch("/api/me", { name });
      session.set({ user: { ...session.user, name: me.name } });
      toast("Profile updated.");
    } catch (err) { if (!showFieldErrors(pf, err)) formError(pf, err.message); }
    finally { setBusy(btn, false); }
  });

  const pw = $("[data-password]", slot);
  bindReveal(pw);
  pw.new_password.addEventListener("input", () => { $(".vx-strength", pw).dataset.score = String(strength(pw.new_password.value)); });
  pw.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(pw); formError(pw, null);
    const data = { current_password: pw.current_password.value, new_password: pw.new_password.value, confirm_password: pw.confirm_password.value };
    const local = {};
    if (!data.current_password) local.current_password = "Enter your current password.";
    if (data.new_password !== data.confirm_password) local.confirm_password = "Passwords don't match.";
    if (Object.keys(local).length) { showFieldErrors(pw, { fields: local }); return; }
    const btn = pw.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      await post("/api/me/password", data);
      pw.reset();
      $(".vx-strength", pw).dataset.score = "0";
      toast("Password updated. Other sessions were signed out.");
    } catch (err) { if (!showFieldErrors(pw, err)) formError(pw, err.message); }
    finally { setBusy(btn, false); }
  });
}

// ------------------------------------------------------------- appearance
function appearance(slot) {
  const p = prefs();
  mount(slot, html`<div class="vx-panel vx-panel-pad">
    ${setting({ title: "Theme", desc: "System follows your device's light or dark setting.", stacked: true, control: html`<div class="vx-theme-cards" role="radiogroup" aria-label="Theme">
      ${[["light", "Light"], ["dark", "Dark"], ["oled", "OLED black"], ["system", "System"]].map(([v, l]) => html`<label class="vx-theme-card">
        <input type="radio" name="theme" value="${v}" ${p.theme === v ? "checked" : ""}><span class="swatch sw-${v}" aria-hidden="true"><i></i><i></i><i></i></span><span class="lbl">${l}</span></label>`)}</div>` })}
    ${setting({ title: "Accent", desc: "Used for links, focus rings and the active item. One accent at a time.", control: html`<div class="vx-accents" role="radiogroup" aria-label="Accent colour">
      ${ACCENTS.map(([v, l]) => html`<label class="vx-accent" title="${l}"><input type="radio" name="accent" value="${v}" ${p.accent === v ? "checked" : ""} aria-label="${l}"><span class="ac-${v}"></span></label>`)}</div>` })}
    ${setting({ title: "Text size", desc: "Scales interface and reading text together.", control: segment("text_size", p.text_size, [["sm", "Small"], ["md", "Default"], ["lg", "Large"]], "Text size") })}
    ${setting({ title: "Density", desc: "Compact reduces padding in lists and tables.", control: segment("density", p.density, [["comfortable", "Comfortable"], ["compact", "Compact"]], "Interface density") })}
    ${setting({ title: "Sidebar", desc: "Collapsed shows icons only on wide screens.", control: segment("sidebar", p.sidebar, [["expanded", "Expanded"], ["collapsed", "Collapsed"]], "Sidebar") })}
    ${setting({ title: "Motion", desc: "Reduce turns off page and panel animation. System follows your device setting.", control: segment("motion", p.motion, [["system", "System"], ["reduce", "Reduce"], ["full", "Full"]], "Motion") })}
  </div>`);
  bindPrefInputs(slot);
}

// ---------------------------------------------------------------- privacy
async function privacy(slot) {
  const p = prefs();
  mount(slot, html`<div class="vx-stack-lg">
    <section class="vx-panel vx-panel-pad">
      ${setting({ title: "Save search history", desc: "Keep a private list of searches you submit. Turning this off stops new entries; existing history stays until you clear it.", control: toggle("save_history", p.save_history, "Save search history") })}
      ${setting({ title: "Clear search history", desc: "Permanently delete every saved search.", control: html`<button type="button" class="vx-btn danger" data-clear-history>${icon("trash", "sm")} Clear history</button>` })}
      ${setting({ title: "Private attachments", desc: "Delete every file you've attached. Attachments expire after 24 hours anyway.", control: html`<button type="button" class="vx-btn danger" data-clear-att>${icon("trash", "sm")} Clear attachments</button>` })}
    </section>
    <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Active sessions</h2>
      <button type="button" class="vx-btn sm" data-revoke-others>${icon("logout", "sm")} Sign out other sessions</button></div>
      <div data-sessions class="vx-panel-body"><div class="vx-skeleton vx-skel-line w-75"></div></div></section>
    <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">How your account is protected</h2>
      <dl class="vx-ledger"><div><dt>Password storage</dt><dd>Salted scrypt hash. Virelix never stores your password itself.</dd></div>
        <div><dt>Session cookie</dt><dd>HttpOnly, SameSite=Strict, revoked server-side on sign-out.</dd></div>
        <div><dt>Request protection</dt><dd>CSRF token and origin check on every change.</dd></div>
        <div><dt>Sign-in throttling</dt><dd>Five failed attempts lock sign-in for 15 minutes.</dd></div></dl></section>
  </div>`);
  bindPrefInputs(slot);
  const box = $("[data-sessions]", slot);
  const loadSessions = async () => {
    try {
      const { sessions } = await get("/api/me/sessions");
      mount(box, html`<ul class="vx-list">${sessions.map((s) => html`<li class="px-0">
        <div class="lead-ico">${icon("monitor", "sm")}</div>
        <div class="grow"><div class="title text-truncate">${browserName(s.user_agent)} ${s.current ? html`<span class="vx-badge ok ms-1"><span class="pip"></span>This session</span>` : ""}</div>
          <div class="sub"><span>Signed in ${relative(s.created_at)}</span><span aria-hidden="true">·</span><span>Active ${relative(s.last_seen)}</span>
          <span aria-hidden="true">·</span><span>${s.remember ? "Remembered 30 days" : "Ends when browser session ends"}</span></div></div>
        ${s.current ? "" : html`<div class="acts"><button type="button" class="vx-btn sm" data-revoke="${s.id}">Sign out</button></div>`}</li>`)}</ul>`);
      $("[data-revoke-others]", slot).disabled = sessions.length < 2;
    } catch (err) { mount(box, errorBlock(err, false)); }
  };
  const offs = [
    on(slot, "click", "[data-revoke]", async (e, btn) => {
      try { await del(`/api/me/sessions/${btn.dataset.revoke}`); toast("Session signed out."); loadSessions(); } catch (err) { toastError(err); }
    }),
    on(slot, "click", "[data-revoke-others]", async () => {
      if (!(await confirmDialog({ title: "Sign out other sessions?", message: "Every other browser or device signed in to this account will be signed out.", confirmLabel: "Sign out others" }))) return;
      try { const r = await post("/api/me/sessions/revoke-others"); toast(`Signed out ${plural(r.revoked, "session")}.`); loadSessions(); } catch (err) { toastError(err); }
    }),
    on(slot, "click", "[data-clear-history]", async () => {
      if (!(await confirmDialog({ title: "Clear search history?", message: "All saved searches will be permanently deleted.", confirmLabel: "Clear history" }))) return;
      try { const r = await del("/api/history"); toast(`Cleared ${plural(r.removed, "search", "searches")}.`, { tone: "info" }); } catch (err) { toastError(err); }
    }),
    on(slot, "click", "[data-clear-att]", async () => {
      if (!(await confirmDialog({ title: "Clear attachments?", message: "Every private file you've attached will be deleted.", confirmLabel: "Clear attachments" }))) return;
      try { const r = await del("/api/attachments"); toast(`Removed ${plural(r.removed, "file")}.`, { tone: "info" }); } catch (err) { toastError(err); }
    }),
  ];
  await loadSessions();
  return () => offs.forEach((o) => o());
}

function browserName(ua = "") {
  const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} on ${os}` : b;
}

// ------------------------------------------------------ search preferences
function searchPrefs(slot) {
  const p = prefs();
  mount(slot, html`<div class="vx-panel vx-panel-pad">
    ${setting({ title: "Default matching", desc: "Used when you start a new search. You can still change it in the filter panel.", control: segment("default_mode", p.default_mode, [["any", "Any term"], ["all", "All terms"], ["phrase", "Exact phrase"]], "Default matching mode") })}
    ${setting({ title: "Results per page", control: segment("per_page", p.per_page, [[10, "10"], [20, "20"], [30, "30"]], "Results per page") })}
    ${setting({ title: "Default sources", desc: "Which collections a new search looks in.", control: html`<div class="vx-stack gap-2">
      <label class="vx-check"><input type="checkbox" name="default_sources" value="corpus" data-group ${p.default_sources.includes("corpus") ? "checked" : ""}> Shared corpus</label>
      <label class="vx-check"><input type="checkbox" name="default_sources" value="attachments" data-group ${p.default_sources.includes("attachments") ? "checked" : ""}> My attachments</label></div>` })}
    <div class="vx-notice mt-4">${icon("info")}<div>Results are ranked by term frequency: how many times your words occur in each document. You can sort by title or date from the results page.</div></div>
  </div>`);
  bindPrefInputs(slot, { per_page: (v) => parseInt(v, 10) });
}

// ---------------------------------------------------------- notifications
function notifications(slot) {
  const p = prefs();
  const admin = session.hasRole("admin");
  mount(slot, html`<div class="vx-stack-lg"><div class="vx-notice">${icon("info")}<div><strong>In-app only.</strong> Virelix shows notifications under the bell icon. It doesn't send email, SMS or push notifications.</div></div>
    <div class="vx-panel vx-panel-pad">
      ${setting({ title: "Security", desc: "Password changes and resets.", control: toggle("notify_security", p.notify_security, "Security notifications") })}
      ${setting({ title: "Role changes", desc: "When you gain or lose Admin access, or an invitation you sent is accepted.", control: toggle("notify_roles", p.notify_roles, "Role notifications") })}
      ${admin ? setting({ title: "Corpus changes", desc: "When another administrator adds or removes shared documents.", control: toggle("notify_corpus", p.notify_corpus, "Corpus notifications") }) : ""}
    </div></div>`);
  bindPrefInputs(slot);
}

// ---------------------------------------------------------------- display
function display(slot) {
  const p = prefs();
  mount(slot, html`<div class="vx-panel vx-panel-pad">
    ${setting({ title: "Show excerpts", desc: "Show each result's opening lines in search results.", control: toggle("show_excerpts", p.show_excerpts, "Show excerpts") })}
    ${setting({ title: "Show matched terms", desc: "Show which query words each result contains, and which it lacks.", control: toggle("show_matched_terms", p.show_matched_terms, "Show matched terms") })}
  </div>`);
  bindPrefInputs(slot);
}
