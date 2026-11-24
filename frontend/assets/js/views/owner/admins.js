import { html, mount, $, on, initials } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get, post } from "../../core/api.js";
import { datetime, relative, plural } from "../../core/format.js";
import { confirmDialog, toast, toastError, setBusy, showFieldErrors, clearFieldErrors, formError } from "../../components/feedback.js";
import { empty, errorBlock, loadingList, pageHead } from "../../components/states.js";

const TABS = [["pending", "Pending"], ["accepted", "Accepted"], ["expired", "Expired"], ["revoked", "Revoked"]];
const BADGE = { pending: "accent", accepted: "ok", expired: "warn", revoked: "danger" };

export default async function admins(root, ctx) {
  let tab = "pending";
  let invites = [];
  let adminList = [];
  let ttl = 72;
  mount(root, html`${pageHead({ eyebrow: "Governance", title: "Admin management", lede: "Only the Owner can grant or remove Admin access. Each invitation is tied to one email address, expires, and works once." })}
    <div class="vx-split">
      <div class="vx-stack-lg">
        <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Invitations</h2></div>
          <div class="vx-tabs px-3" role="tablist" aria-label="Invitation status" data-tabs></div>
          <div data-invites>${loadingList(3)}</div></section>
        <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Current Admins</h2><span class="meta tabular" data-admin-count></span></div>
          <div data-admins>${loadingList(2)}</div></section>
      </div>
      <aside class="vx-stack">
        <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-3">Invite an Admin</h2>
          <form class="vx-stack" novalidate data-invite>
            <div data-form-error hidden></div>
            <div class="vx-field"><label class="vx-label" for="inv-email">Email address</label>
              <input class="vx-input" type="email" id="inv-email" name="email" autocomplete="off" required aria-describedby="inv-email-err inv-hint">
              <div class="vx-hint" id="inv-hint" data-ttl>The person signs in or registers with this address, then opens the link.</div>
              <div class="vx-error" id="inv-email-err" data-error-for="email" role="alert"></div></div>
            <button type="submit" class="vx-btn primary">${icon("send", "sm")} Send invitation</button>
          </form></section>
        <div class="vx-notice">${icon("shield")}<div>Admins manage the corpus, the index and members. They can't invite Admins, remove Admins or change ownership. The Owner is set by the server's <span class="mono">OWNER_EMAIL</span>, never through the interface.</div></div>
      </aside>
    </div>`);

  const invBox = $("[data-invites]", root);
  const admBox = $("[data-admins]", root);
  const tabs = $("[data-tabs]", root);

  const renderInvites = () => {
    const counts = Object.fromEntries(TABS.map(([id]) => [id, invites.filter((i) => i.status === id).length]));
    mount(tabs, html`${TABS.map(([id, l]) => html`<button type="button" class="vx-tab" role="tab" aria-selected="${tab === id}" data-tab="${id}">${l} <span class="count">${counts[id]}</span></button>`)}`);
    const shown = invites.filter((i) => i.status === tab);
    mount(invBox, shown.length ? html`<ul class="vx-list">${shown.map((i) => html`<li>
        <div class="lead-ico">${icon("mail", "sm")}</div>
        <div class="grow"><div class="title mono">${i.email}</div>
          <div class="sub"><span class="vx-badge ${BADGE[i.status]}">${i.status}</span>
            <span>Sent ${relative(i.last_sent_at)}${i.sent_count > 1 ? ` · ${i.sent_count}×` : ""}</span>
            ${i.status === "pending" ? html`<span aria-hidden="true">·</span><span>Expires ${relative(i.expires_at)}</span>` : ""}
            ${i.status === "expired" ? html`<span aria-hidden="true">·</span><span>Expired ${relative(i.expires_at)}</span>` : ""}
            ${i.status === "accepted" ? html`<span aria-hidden="true">·</span><span>Accepted ${datetime(i.accepted_at)}</span>` : ""}
            ${i.status === "revoked" ? html`<span aria-hidden="true">·</span><span>Revoked ${datetime(i.revoked_at)}</span>` : ""}</div></div>
        ${["pending", "expired"].includes(i.status) ? html`<div class="acts">
          <button type="button" class="vx-btn sm" data-resend="${i.id}">${icon("send", "sm")} Resend</button>
          <button type="button" class="vx-btn sm danger" data-revoke="${i.id}" data-email="${i.email}">Revoke</button></div>` : ""}</li>`)}</ul>`
      : html`<div class="p-4">${empty({ glyph: "✉", title: `No ${tab} invitations`, body: tab === "pending" ? "Invite someone using the form. Pending invitations appear here until they're accepted, revoked or expire." : "" })}</div>`);
  };

  const renderAdmins = () => {
    $("[data-admin-count]", root).textContent = plural(adminList.length, "admin");
    mount(admBox, adminList.length ? html`<ul class="vx-list">${adminList.map((a) => html`<li>
        <span class="vx-avatar" aria-hidden="true">${initials(a.name)}</span>
        <div class="grow"><div class="title">${a.name}</div><div class="sub"><span>${a.email}</span><span aria-hidden="true">·</span><span>Last sign-in ${a.last_login_at ? relative(a.last_login_at) : "never"}</span></div></div>
        <div class="acts"><button type="button" class="vx-btn sm danger" data-demote="${a.id}" data-name="${a.name}">Remove Admin</button></div></li>`)}</ul>`
      : html`<div class="p-4">${empty({ glyph: "∅", title: "No Admins yet", body: "Accepted invitations make their recipients Admins." })}</div>`);
  };

  const load = async () => {
    try {
      const [inv, adm] = await Promise.all([get("/api/owner/invitations"), get("/api/owner/admins")]);
      if (!ctx.isCurrent()) return;
      invites = inv.items; ttl = inv.ttl_hours; adminList = adm.items;
      $("[data-ttl]", root).textContent = `The link expires after ${ttl} hours and works once. They sign in or register with this exact address first.`;
      renderInvites(); renderAdmins();
    } catch (err) { mount(invBox, errorBlock(err)); $("[data-retry]", invBox)?.addEventListener("click", load); }
  };

  const form = $("[data-invite]", root);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form); formError(form, null);
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFieldErrors(form, { fields: { email: "Enter a valid email address." } }); return; }
    const btn = form.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      const r = await post("/api/owner/invitations", { email });
      form.reset();
      tab = "pending";
      toast(html`Invitation created for <strong>${r.invitation.email}</strong>. ${r.delivery.provider === "development-mailbox" ? "No email is sent: the link is printed in the server console." : "Not delivered: no email provider is configured."}`, { timeout: 7000 });
      load();
    } catch (err) { if (!showFieldErrors(form, err)) formError(form, err.message); }
    finally { setBusy(btn, false); }
  });

  const offs = [
    on(tabs, "click", "[data-tab]", (e, b) => { tab = b.dataset.tab; renderInvites(); }),
    on(invBox, "click", "[data-resend]", async (e, b) => {
      setBusy(b, true);
      try { const r = await post(`/api/owner/invitations/${b.dataset.resend}/resend`); toast(`New link issued to ${r.invitation.email}. The previous link no longer works.`); tab = "pending"; load(); }
      catch (err) { setBusy(b, false); toastError(err); }
    }),
    on(invBox, "click", "[data-revoke]", async (e, b) => {
      if (!(await confirmDialog({ title: "Revoke invitation?", message: `The invitation for ${b.dataset.email} will stop working immediately.`, confirmLabel: "Revoke" }))) return;
      try { await post(`/api/owner/invitations/${b.dataset.revoke}/revoke`); toast("Invitation revoked.", { tone: "info" }); load(); } catch (err) { toastError(err); }
    }),
    on(admBox, "click", "[data-demote]", async (e, b) => {
      if (!(await confirmDialog({ title: "Remove Admin access?", message: `${b.dataset.name} will become a standard member straight away and lose access to every administration page.`, confirmLabel: "Remove Admin" }))) return;
      try { await post(`/api/owner/admins/${b.dataset.demote}/remove`); toast(`${b.dataset.name} is now a member.`, { tone: "info" }); load(); } catch (err) { toastError(err); }
    }),
  ];
  await load();
  return () => offs.forEach((o) => o());
}
