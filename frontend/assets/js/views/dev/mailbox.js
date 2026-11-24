// Developer-only page. Not linked from the application. Requires the key the server prints to its
// local console; the server also refuses requests that don't come from this machine.
import { html, mount, $ } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { api } from "../../core/api.js";
import { datetime, safePath } from "../../core/format.js";
import { authLayout } from "../../components/auth-layout.js";
import { confirmDialog, toastError } from "../../components/feedback.js";

const KIND = { verify: "Email verification", reset: "Password reset", invite: "Admin invitation" };
const STORE = "vx-dev-mailbox-key";

export default async function mailbox(root) {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("key");
  if (fromHash) {
    sessionStorage.setItem(STORE, fromHash);
    history.replaceState({}, "", "/dev/mailbox"); // keep the key out of the visible address
  }
  const card = authLayout(root, html`<div><div class="eyebrow">Developer tool</div><h1 class="mt-2">Development mailbox</h1>
    <p class="sub">No email provider is connected. Messages Virelix would send are kept here and printed to the server console; nothing reaches a real inbox. Opening a link proves access to this machine, not control of the email address.</p></div>
    <div data-body></div>`);
  card.classList.add("vx-mailbox");
  const body = $("[data-body]", card);
  const key = () => sessionStorage.getItem(STORE) || "";
  const call = (method) => api("/api/dev/mailbox", { method, headers: { "X-Dev-Mailbox-Key": key() } });

  const askKey = (message = "") => {
    mount(body, html`<form class="vx-stack" data-key novalidate>
      ${message ? html`<div class="vx-notice danger" role="alert">${icon("lock")}<div>${message}</div></div>` : ""}
      <div class="vx-field"><label class="vx-label" for="dev-key">Developer key</label>
        <input class="vx-input mono" id="dev-key" name="key" autocomplete="off" spellcheck="false" required aria-describedby="dev-key-hint">
        <div class="vx-hint" id="dev-key-hint">Printed in the server console when Virelix starts, after <span class="mono">/dev/mailbox#key=</span>.</div></div>
      <div class="vx-row"><button type="submit" class="vx-btn primary">Open mailbox</button><a class="vx-btn quiet" href="/login">Sign in</a></div></form>`);
    const form = $("[data-key]", body);
    form.key.focus();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.key.value.trim()) { form.key.setAttribute("aria-invalid", "true"); return; }
      sessionStorage.setItem(STORE, form.key.value.trim());
      load();
    });
  };

  const load = async () => {
    if (!key()) return askKey();
    let d;
    try { d = await call("GET"); }
    catch (err) {
      if (err.code === "dev_key_required") { sessionStorage.removeItem(STORE); return askKey("That key wasn't accepted."); }
      return mount(body, html`<div class="vx-notice danger" role="alert">${icon("lock")}<div>${err.status === 404 ? "The development mailbox is disabled on this server." : err.message}</div></div>`);
    }
    mount(body, html`<div class="vx-row mb-3"><button type="button" class="vx-btn" data-refresh>${icon("refresh", "sm")} Refresh</button>
      <button type="button" class="vx-btn danger" data-clear ${d.messages.length ? "" : "disabled"}>${icon("trash", "sm")} Clear</button><a class="vx-btn quiet" href="/login">Sign in</a></div>
      ${d.messages.length ? html`<div class="vx-panel"><ul class="vx-list">${d.messages.map((m) => {
        const link = m.link ? safePath(new URL(m.link).pathname + new URL(m.link).search) : null;
        return html`<li class="align-items-start"><div class="lead-ico">${icon("mail", "sm")}</div>
        <div class="grow"><div class="title">${m.subject}</div>
          <div class="sub"><span class="mono">${m.to}</span><span aria-hidden="true">·</span><span>${KIND[m.kind] || m.kind}</span><span aria-hidden="true">·</span><span>${datetime(m.created_at)}</span></div>
          ${link ? html`<a class="vx-btn sm primary mt-3" href="${link}" data-native>${icon("arrowUpRight", "sm")} Open link</a>` : ""}</div></li>`;
      })}</ul></div>` : html`<div class="vx-notice">${icon("info")}<div>The mailbox is empty.</div></div>`}`);
    $("[data-refresh]", body).addEventListener("click", load);
    $("[data-clear]", body).addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Clear the mailbox?", message: "All stored development messages will be deleted. Links in them keep working until they expire.", confirmLabel: "Clear" }))) return;
      try { await call("DELETE"); load(); } catch (err) { toastError(err); }
    });
  };
  await load();
}
