import { html, mount, $ } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get } from "../../core/api.js";
import { datetime, num } from "../../core/format.js";
import { errorBlock, loading, pageHead } from "../../components/states.js";

const CONFLICTS = {
  multiple_owners: "More than one account holds the Owner role.",
  owner_without_configuration: "An Owner account exists but OWNER_EMAIL isn't set.",
  configuration_mismatch: "The established Owner account doesn't match OWNER_EMAIL.",
  owner_unverified: "The Owner account isn't verified.",
};

const ACTIONS = {
  owner_granted: "Owner role granted", owner_revoked: "Owner role revoked", admin_invited: "Admin invited", admin_invite_resent: "Invitation resent",
  admin_invite_revoked: "Invitation revoked", admin_invite_accepted: "Invitation accepted", admin_removed: "Admin removed",
  user_suspended: "User suspended", user_reactivated: "User reactivated", document_uploaded: "Document uploaded", document_removed: "Document removed",
  index_initialized: "Index built", corpus_reloaded: "Corpus reloaded",
  owner_conflict_detected: "Owner configuration conflict detected", owner_released: "Owner role released (manual)",
};

export default async function platform(root, ctx) {
  root.classList.add("wide");
  mount(root, html`${pageHead({ eyebrow: "Governance", title: "Ownership & platform", lede: "Who controls this installation, how it's secured, and every privileged action taken on it." })}<div data-body>${loading(6)}</div>`);
  const body = $("[data-body]", root);
  let p, audit;
  try { [p, audit] = await Promise.all([get("/api/owner/platform"), get("/api/owner/audit?limit=200")]); }
  catch (err) { mount(body, errorBlock(err, false)); return; }
  if (!ctx.isCurrent()) return;
  mount(body, html`<div class="vx-stack-lg">
    <div class="vx-grid-2">
      <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Ownership</h2><dl class="vx-ledger">
        <div><dt>Product</dt><dd>${p.product} <span class="mono meta">${p.version}</span></dd></div>
        <div><dt>Owner account</dt><dd>${p.owner.account.name} · ${p.owner.account.email}</dd></div>
        <div><dt>Designated by</dt><dd>${p.owner.source} <span class="mono meta">(${p.owner.email_masked})</span></dd></div>
        <div><dt>Environment</dt><dd class="mono">${p.environment}</dd></div>
        <div><dt>Accounts</dt><dd class="tabular">${num(p.counts.users)} total · ${num(p.counts.admins)} admin · ${num(p.counts.suspended)} suspended</dd></div></dl>
        ${p.owner.state.conflict ? html`<div class="vx-notice danger mt-3">${icon("alert")}<div><strong>Owner configuration conflict.</strong> ${CONFLICTS[p.owner.state.conflict]} No privileges were changed automatically.</div></div>` : ""}
        <div class="vx-notice mt-3">${icon("lock")}<div>Ownership is never transferred automatically, and it can't be changed from the interface. A deliberate handover is done by the server operator with <span class="mono">scripts/owner_recovery.py</span> while the server is stopped.</div></div></section>
      <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Security posture</h2><dl class="vx-ledger">
        <div><dt>Passwords</dt><dd>${p.security.password_hashing}</dd></div>
        <div><dt>Session cookie</dt><dd>HttpOnly · SameSite=${p.security.session_cookie.same_site} · Secure ${p.security.session_cookie.secure ? html`<span class="vx-badge ok">on</span>` : html`<span class="vx-badge warn">off (HTTP dev)</span>`}</dd></div>
        <div><dt>CSRF</dt><dd>${p.security.csrf}</dd></div>
        <div><dt>Signing key</dt><dd>${p.security.secret_key}</dd></div>
        <div><dt>Login throttle</dt><dd>${p.security.login_throttle}</dd></div>
        <div><dt>Email delivery</dt><dd>${p.security.email_delivery}</dd></div></dl></section>
    </div>
    <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Capabilities</h2>
      <dl class="vx-ledger">${p.capabilities.map((c) => html`<div><dt>${c.name}</dt><dd>${c.available
        ? html`<span class="vx-badge ok"><span class="pip"></span>Available</span>` : html`<span class="vx-badge"><span class="pip"></span>Not available</span>`}
        <span class="meta ms-1">${c.detail}</span></dd></div>`)}</dl></section>
    <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Privileged-action log</h2><span class="meta tabular">${num(audit.items.length)} most recent</span></div>
      ${audit.items.length ? html`<div class="vx-table-wrap"><table class="vx-table stack"><caption class="visually-hidden">Audit log</caption>
        <thead><tr><th>When</th><th>Action</th><th>Target</th><th>By</th></tr></thead>
        <tbody>${audit.items.map((a) => html`<tr><td data-label="When" class="meta tabular">${datetime(a.at)}</td>
          <td data-label="Action">${ACTIONS[a.action] || a.action}</td><td data-label="Target" class="mono">${a.target}</td>
          <td data-label="By">${a.actor_email} <span class="vx-role-chip">${a.actor_role}</span></td></tr>`)}</tbody></table></div>`
        : html`<div class="p-4 meta">No privileged actions recorded yet.</div>`}</section>
  </div>`);
}
