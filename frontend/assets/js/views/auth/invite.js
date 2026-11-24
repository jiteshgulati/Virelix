import { html, $, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get, post } from "../../core/api.js";
import { session } from "../../core/store.js";
import { resetShell } from "../../core/router.js";
import { datetime } from "../../core/format.js";
import { authLayout } from "../../components/auth-layout.js";
import { setBusy, toast } from "../../components/feedback.js";

export default async function invite(root, ctx) {
  const token = ctx.query.get("token") || "";
  const here = `/invite?token=${encodeURIComponent(token)}`;
  const card = authLayout(root, html`<div data-body class="vx-state"><div class="seal">${icon("key", "lg")}</div><div><h1>Admin invitation</h1><p class="sub">Checking the invitation…</p></div></div>`);
  const body = $("[data-body]", card);
  const fail = (title, message, actions = html`<a class="vx-btn" href="/">Go to Virelix</a>`) => mount(body, html`
    <div class="seal danger">${icon("alert", "lg")}</div><div><h1>${title}</h1><p class="sub">${message}</p></div><div class="vx-row">${actions}</div>`);

  let info;
  try {
    info = await get(`/api/invitations/peek?token=${encodeURIComponent(token)}`);
  } catch (err) {
    return fail("Invitation not valid", err.message);
  }
  if (info.status !== "pending") {
    return fail(`Invitation ${info.status}`, `This invitation is ${info.status} and can't be used. Ask the platform Owner to send a new one.`);
  }
  const user = session.user;
  if (!user) {
    mount(body, html`<div class="seal">${icon("key", "lg")}</div>
      <div><h1>You're invited to administer Virelix</h1>
      <p class="sub">This invitation is for <strong class="mono">${info.email}</strong> and expires ${datetime(info.expires_at)}. Sign in with that account — or create it — to accept.</p></div>
      <div class="vx-row"><a class="vx-btn primary" href="/login?next=${encodeURIComponent(here)}">Sign in to accept</a>
      <a class="vx-btn" href="/register?next=${encodeURIComponent(here)}">Create the account</a></div>
      <p class="meta">New accounts start as standard members and must verify their email first.</p>`);
    return;
  }
  if (user.email !== info.email) {
    fail("Different account", html`You're signed in as <strong>${user.email}</strong>, but this invitation is for <strong class="mono">${info.email}</strong>. Sign out and sign in with the invited account.`,
      html`<button type="button" class="vx-btn primary" data-switch>Sign out and switch</button><a class="vx-btn" href="/">Stay signed in</a>`);
    bindSwitch();
    return;
  }
  if (user.role !== "user") {
    return fail("Already an administrator", "Your account already has administrative access.", html`<a class="vx-btn primary" href="/admin">Open administration</a>`);
  }
  mount(body, html`<div class="seal">${icon("key", "lg")}</div>
    <div><h1>Accept Admin access?</h1>
    <p class="sub">As an Admin you'll manage the shared document corpus, the document index and user accounts. Only the Owner can grant or remove this role.</p></div>
    <dl class="vx-ledger w-100"><div><dt>Account</dt><dd>${user.email}</dd></div><div><dt>Expires</dt><dd>${datetime(info.expires_at)}</dd></div></dl>
    <div class="vx-row"><button type="button" class="vx-btn primary" data-accept>Accept invitation</button><a class="vx-btn quiet" href="/">Not now</a></div>
    <div data-msg></div>`);
  $("[data-accept]", body).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true);
    try {
      const r = await post("/api/invitations/accept", { token });
      session.set({ user: r.user });
      resetShell();
      toast("You're now an Admin.");
      ctx.navigate("/admin", { replace: true });
    } catch (err) {
      setBusy(btn, false);
      mount($("[data-msg]", body), html`<div class="vx-notice danger" role="alert">${icon("alert")}<div>${err.message}</div></div>`);
    }
  });

  function bindSwitch() {
    $("[data-switch]", body)?.addEventListener("click", async () => {
      try { await post("/api/auth/logout"); } catch { /* ignore */ }
      session.set({ user: null });
      resetShell();
      ctx.navigate(`/login?next=${encodeURIComponent(here)}&email=${encodeURIComponent(info.email)}`);
    });
  }
}
