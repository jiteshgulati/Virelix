import { html, $, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get, post } from "../../core/api.js";
import { authLayout } from "../../components/auth-layout.js";
import { setBusy, toast, toastError } from "../../components/feedback.js";

export default async function pending(root, ctx) {
  const email = ctx.query.get("email") || "";
  let dev = false;
  try { dev = !!(await get("/api/auth/session")).dev_mailbox; } catch { /* offline */ }
  const card = authLayout(root, html`
    <div class="vx-state">
      <div class="seal">${icon("mail", "lg")}</div>
      <div><h1>Verify your email</h1>
        <p class="sub">${email ? html`We issued a verification link for <strong>${email}</strong>.` : "We issued a verification link for your account."}
        It expires in 24 hours and works once.</p></div>
    </div>
    ${dev ? html`<div class="vx-notice warn">${icon("info")}<div><strong>Email isn't delivered by this installation.</strong> Nothing was sent to a real inbox.
      The verification link is printed in the server console. If you run Virelix yourself, open it from there; otherwise ask the server operator.</div></div>`
      : html`<div class="vx-notice warn">${icon("info")}<div>This server has no email provider configured. Ask the administrator for help verifying your account.</div></div>`}
    <div class="vx-row">
      <button type="button" class="vx-btn" data-resend ${email ? "" : "disabled"}>${icon("send", "sm")} Resend link</button>
    </div>
    <div data-msg></div>
    <p class="alt">Verified already? <a href="/login${email ? `?email=${encodeURIComponent(email)}` : ""}">Sign in</a></p>`);
  if (ctx.query.get("resent") === "1") toast("A new verification link was issued.");
  $("[data-resend]", card).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true);
    try {
      const r = await post("/api/auth/resend-verification", { email });
      mount($("[data-msg]", card), html`<div class="vx-notice ok" role="status">${icon("check")}<div>${r.message}</div></div>`);
    } catch (err) { toastError(err); }
    finally { setBusy(btn, false); }
  });
}
