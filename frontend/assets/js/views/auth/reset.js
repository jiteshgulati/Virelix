import { html, $, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { post } from "../../core/api.js";
import { session } from "../../core/store.js";
import { resetShell } from "../../core/router.js";
import { authLayout, passwordField, bindReveal, strength } from "../../components/auth-layout.js";
import { setBusy, showFieldErrors, clearFieldErrors, formError } from "../../components/feedback.js";

export default async function reset(root, ctx) {
  const token = ctx.query.get("token") || "";
  history.replaceState({}, "", "/reset-password");
  const card = authLayout(root, html`<div data-body><h1>Choose a new password</h1><p class="sub">Checking your link…</p></div>`);
  const body = $("[data-body]", card);

  let info;
  try {
    if (!token) throw Object.assign(new Error("This reset link is incomplete."), { code: "token_invalid" });
    info = await post("/api/auth/reset-password/check", { token });
  } catch (err) {
    mount(body, html`<div class="vx-state"><div class="seal danger">${icon("alert", "lg")}</div>
      <div><h1>${err.code === "token_expired" ? "Link expired" : err.code === "token_used" ? "Link already used" : "Link not valid"}</h1>
      <p class="sub">${err.message}</p></div>
      <div class="vx-row"><a class="vx-btn primary" href="/forgot-password">Request a new link</a><a class="vx-btn quiet" href="/login">Sign in</a></div></div>`);
    return;
  }

  mount(body, html`<div><h1>Choose a new password</h1><p class="sub">For <span class="mono">${info.email}</span>. Saving signs out every session on this account.</p></div>
    <form novalidate data-reset class="mt-4 vx-stack">
      <div data-form-error hidden></div>
      ${passwordField({ id: "password", name: "password", label: "New password", autocomplete: "new-password", hint: "At least 10 characters, with a letter and a number." })}
      <div class="vx-strength" data-score="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      ${passwordField({ id: "confirm", name: "confirm_password", label: "Confirm new password", autocomplete: "new-password" })}
      <button type="submit" class="vx-btn primary block">Update password</button>
    </form>`);
  const form = $("[data-reset]", body);
  bindReveal(form);
  form.password.focus();
  form.password.addEventListener("input", () => { $(".vx-strength", form).dataset.score = String(strength(form.password.value)); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    formError(form, null);
    if (form.password.value !== form.confirm_password.value) {
      showFieldErrors(form, { fields: { confirm_password: "Passwords don't match." } });
      return;
    }
    const btn = form.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      await post("/api/auth/reset-password", { token, password: form.password.value, confirm_password: form.confirm_password.value });
      session.set({ user: null, unread: 0 });
      resetShell();
      ctx.navigate("/login?reset=1", { replace: true });
    } catch (err) {
      setBusy(btn, false);
      if (!showFieldErrors(form, err)) formError(form, err.message);
    }
  });
}
