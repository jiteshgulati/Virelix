import { html, $, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { post } from "../../core/api.js";
import { authLayout, textField } from "../../components/auth-layout.js";
import { setBusy, showFieldErrors, clearFieldErrors, formError } from "../../components/feedback.js";

export default function forgot(root) {
  const card = authLayout(root, html`
    <div><h1>Reset your password</h1><p class="sub">Enter the email you use for Virelix. If an active account matches, we'll issue a reset link that works once for 30 minutes.</p></div>
    <form novalidate data-forgot>
      <div data-form-error hidden></div>
      ${textField({ id: "email", name: "email", label: "Email", type: "email", autocomplete: "email" })}
      <button type="submit" class="vx-btn primary block">Send reset link</button>
    </form>
    <p class="alt"><a href="/login">Back to sign in</a></p>`);
  const form = $("[data-forgot]", card);
  form.email.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    formError(form, null);
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFieldErrors(form, { fields: { email: "Enter a valid email address." } }); return; }
    const btn = form.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      const r = await post("/api/auth/forgot-password", { email });
      mount(card, html`<div class="vx-state"><div class="seal">${icon("key", "lg")}</div>
        <div><h1>Check for the reset link</h1><p class="sub">${r.message}</p></div></div>
        <div class="vx-notice warn">${icon("info")}<div>${r.delivery?.message}</div></div>
        <div class="vx-row">
        <a class="vx-btn" href="/login">Back to sign in</a></div>`);
    } catch (err) {
      setBusy(btn, false);
      if (!showFieldErrors(form, err)) formError(form, err.message);
    }
  });
}
