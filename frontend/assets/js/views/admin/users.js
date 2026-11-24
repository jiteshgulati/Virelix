import { html, mount, $, on, initials } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get, post, qs } from "../../core/api.js";
import { session } from "../../core/store.js";
import { datetime, relative, roleLabel, plural } from "../../core/format.js";
import { openModal, toast, toastError, setBusy, confirmDialog } from "../../components/feedback.js";
import { empty, errorBlock, loadingList, pageHead } from "../../components/states.js";

const statusBadge = (u) => u.status === "suspended" ? html`<span class="vx-badge danger"><span class="pip"></span>Suspended</span>`
  : !u.email_verified ? html`<span class="vx-badge warn"><span class="pip"></span>Unverified</span>` : html`<span class="vx-badge ok"><span class="pip"></span>Active</span>`;

export default async function users(root, ctx) {
  root.classList.add("wide");
  const st = { q: "", role: "", status: "" };
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "Users",
    lede: "Account details visible to administrators. Members' history, saved items, collections and attachments stay private and aren't shown here." })}
    <div class="vx-panel"><div class="vx-panel-head">
      <form class="vx-row flex-grow-1" data-filters role="search" novalidate>
        <label class="visually-hidden" for="uq">Search users</label>
        <input class="vx-input" id="uq" name="q" placeholder="Search by name or email" autocomplete="off">
        <label class="visually-hidden" for="ur">Role</label>
        <select class="vx-select w-auto" id="ur" name="role"><option value="">All roles</option><option value="user">Members</option><option value="admin">Admins</option><option value="owner">Owner</option></select>
        <label class="visually-hidden" for="us">Status</label>
        <select class="vx-select w-auto" id="us" name="status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="unverified">Unverified</option></select>
      </form><span class="meta tabular" data-count></span></div>
      <div data-table>${loadingList(5)}</div></div>`);
  const table = $("[data-table]", root);
  let items = [];

  const load = async () => {
    try {
      items = (await get(`/api/admin/users${qs(st)}`)).items;
      if (!ctx.isCurrent()) return;
      $("[data-count]", root).textContent = plural(items.length, "account");
      mount(table, items.length ? html`<div class="vx-table-wrap"><table class="vx-table stack"><caption class="visually-hidden">User accounts</caption>
        <thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Joined</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${items.map((u) => html`<tr>
          <td data-label="Account"><div class="d-flex align-items-center gap-3"><span class="vx-avatar" aria-hidden="true">${initials(u.name)}</span>
            <div class="min-w-0"><button type="button" class="row-title btn btn-link p-0 text-start" data-open="${u.id}">${u.name}${u.id === session.user.id ? " (you)" : ""}</button><div class="meta">${u.email}</div></div></div></td>
          <td data-label="Role"><span class="vx-role-chip">${roleLabel(u.role)}</span></td>
          <td data-label="Status">${statusBadge(u)}</td>
          <td data-label="Last sign-in" class="meta">${u.last_login_at ? relative(u.last_login_at) : "Never"}</td>
          <td data-label="Joined" class="meta">${datetime(u.created_at)}</td>
          <td class="actions"><button type="button" class="vx-btn sm quiet" data-open="${u.id}">Details</button>
            ${u.manageable ? (u.status === "active" ? html`<button type="button" class="vx-btn sm danger" data-suspend="${u.id}">Suspend</button>`
              : html`<button type="button" class="vx-btn sm" data-reactivate="${u.id}">Reactivate</button>`) : ""}</td></tr>`)}</tbody></table></div>`
        : html`<div class="p-4">${empty({ glyph: "∅", title: "No accounts match", body: "Try a different search or filter." })}</div>`);
    } catch (err) { mount(table, html`<div class="p-4">${errorBlock(err)}</div>`); $("[data-retry]", table)?.addEventListener("click", load); }
  };

  const suspend = async (id) => {
    const u = items.find((x) => x.id === id);
    const reason = await openModal({ title: "Suspend this account?",
      body: html`<p><strong>${u.name}</strong> (${u.email}) will be signed out everywhere and won't be able to sign in until reactivated. Their data is kept.</p>
        <div class="vx-field mt-3"><label class="vx-label" for="reason">Reason <span class="muted">(optional, visible to administrators)</span></label>
        <input class="vx-input" id="reason" maxlength="200" autocomplete="off"></div>`,
      footer: html`<button type="button" class="vx-btn" data-bs-dismiss="modal">Cancel</button><button type="button" class="vx-btn danger-solid" data-ok>Suspend account</button>`,
      onMount: (el, done) => $("[data-ok]", el).addEventListener("click", () => done({ reason: $("#reason", el).value.trim() })) });
    if (!reason) return;
    try { await post(`/api/admin/users/${id}/suspend`, reason); toast(`${u.name} is suspended.`, { tone: "info" }); load(); } catch (err) { toastError(err); }
  };
  const reactivate = async (id) => {
    const u = items.find((x) => x.id === id);
    if (!(await confirmDialog({ title: "Reactivate this account?", message: `${u.name} will be able to sign in again.`, confirmLabel: "Reactivate", tone: "primary" }))) return;
    try { await post(`/api/admin/users/${id}/reactivate`); toast(`${u.name} is active again.`); load(); } catch (err) { toastError(err); }
  };
  const details = (id) => openModal({ title: "Account details", body: html`<div data-d>${loadingList(2)}</div>`,
    footer: html`<button type="button" class="vx-btn primary" data-bs-dismiss="modal">Close</button>`,
    onMount: async (el) => {
      try {
        const u = await get(`/api/admin/users/${id}`);
        mount($("[data-d]", el), html`<div class="d-flex align-items-center gap-3 mb-4"><span class="vx-avatar" aria-hidden="true">${initials(u.name)}</span>
          <div><div class="fw-semibold">${u.name}</div><div class="meta">${u.email}</div></div></div>
          <dl class="vx-ledger"><div><dt>Role</dt><dd>${roleLabel(u.role)}</dd></div><div><dt>Status</dt><dd>${statusBadge(u)}</dd></div>
            <div><dt>Email verified</dt><dd>${u.email_verified ? datetime(u.verified_at) : "Not yet"}</dd></div>
            <div><dt>Joined</dt><dd>${datetime(u.created_at)}</dd></div><div><dt>Last sign-in</dt><dd>${datetime(u.last_login_at)}</dd></div>
            <div><dt>Active sessions</dt><dd class="tabular">${u.active_sessions}</dd></div>
            ${u.status === "suspended" ? html`<div><dt>Suspended</dt><dd>${datetime(u.suspended_at)}${u.suspension_reason ? html` · ${u.suspension_reason}` : ""}</dd></div>` : ""}</dl>
          ${!u.manageable ? html`<div class="vx-notice mt-3">${icon("lock")}<div>${u.id === session.user.id ? "You can't suspend your own account." : "Admin and Owner accounts can't be suspended here. The Owner can remove Admin access first."}</div></div>` : ""}`);
      } catch (err) { mount($("[data-d]", el), errorBlock(err, false)); }
    } });

  let t;
  const filters = $("[data-filters]", root);
  filters.addEventListener("input", (e) => { if (e.target.name === "q") { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 220); } });
  filters.addEventListener("change", (e) => { if (e.target.name !== "q") { st[e.target.name] = e.target.value; load(); } });
  filters.addEventListener("submit", (e) => e.preventDefault());
  const offs = [
    on(table, "click", "[data-open]", (e, b) => details(b.dataset.open)),
    on(table, "click", "[data-suspend]", (e, b) => suspend(b.dataset.suspend)),
    on(table, "click", "[data-reactivate]", (e, b) => reactivate(b.dataset.reactivate)),
  ];
  await load();
  return () => offs.forEach((o) => o());
}
