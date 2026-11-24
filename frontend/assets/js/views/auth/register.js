import { html, $ } from "../../core/dom.js";
import { post } from "../../core/api.js";
import { authLayout, passwordField, textField, bindReveal, strength } from "../../components/auth-layout.js";
import { setBusy, showFieldErrors, clearFieldErrors, formError } from "../../components/feedback.js";

export default function register(root, ctx) {
  const card = authLayout(root, html`
    <div><h1>Create your account</h1><p class="sub">A private workspace for searching, saving and organising documents.</p></div>
    <form novalidate data-register>
      <div data-form-error hidden></div>
      ${textField({ id: "name", name: "name", label: "Full name", autocomplete: "name", maxlength: 80 })}
      ${textField({ id: "email", name: "email", label: "Email", type: "email", autocomplete: "email" })}
      ${passwordField({ id: "password", name: "password", label: "Password", autocomplete: "new-password", hint: "At least 10 characters, with a letter and a number.", describedby: "pw-strength-label" })}
      <div class="vx-strength" data-score="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <span class="visually-hidden" id="pw-strength-label" aria-live="polite"></span>
      ${passwordField({ id: "confirm", name: "confirm_password", label: "Confirm password", autocomplete: "new-password" })}
      <div class="vx-field">
        <label class="vx-check"><input type="checkbox" name="accept_terms" aria-describedby="terms-err">
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener">terms of use</a>.</span></label>
        <div class="vx-error" id="terms-err" data-error-for="accept_terms" role="alert"></div>
      </div>
      <button type="submit" class="vx-btn primary block">Create account</button>
    </form>
    <p class="alt">Already have an account? <a href="/login">Sign in</a></p>`);

  const form = $("[data-register]", card);
  bindReveal(form);
  $("#name", form).focus();
  const meter = $(".vx-strength", form);
  const live = $("#pw-strength-label", form);
  form.password.addEventListener("input", () => {
    const s = strength(form.password.value);
    meter.dataset.score = String(s);
    live.textContent = form.password.value ? `Password strength: ${["too short", "weak", "fair", "good", "strong"][s]}` : "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    formError(form, null);
    const data = {
      name: form.elements.name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
      confirm_password: form.confirm_password.value,
      accept_terms: form.accept_terms.checked,
    };
    const local = {};
    if (data.name.length < 2) local.name = "Enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) local.email = "Enter a valid email address.";
    if (data.password.length < 10 || !/[A-Za-z]/.test(data.password) || !/\d/.test(data.password)) local.password = "Use at least 10 characters, including a letter and a number.";
    if (data.password !== data.confirm_password) local.confirm_password = "Passwords don't match.";
    if (!data.accept_terms) local.accept_terms = "Accept the terms to create an account.";
    if (Object.keys(local).length) { showFieldErrors(form, { fields: local }); return; }
    const btn = form.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      await post("/api/auth/register", data);
      const next = ctx.query.get("next");
      ctx.navigate(`/verify-pending?email=${encodeURIComponent(data.email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`, { replace: true });
    } catch (err) {
      setBusy(btn, false);
      if (err.code === "email_taken") {
        showFieldErrors(form, { fields: { email: err.message } });
      } else if (!showFieldErrors(form, err)) formError(form, err.message);
    }
  });
}
