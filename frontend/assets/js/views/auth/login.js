import { html, $ } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { post } from "../../core/api.js";
import { session } from "../../core/store.js";
import { applyPrefs } from "../../core/prefs.js";
import { authLayout, passwordField, textField, bindReveal, safeNext } from "../../components/auth-layout.js";
import { setBusy, showFieldErrors, clearFieldErrors, formError, toast } from "../../components/feedback.js";

export default function login(root, ctx) {
  const next = safeNext(ctx.query.get("next"));
  const card = authLayout(root, html`
    <div><h1>Sign in</h1><p class="sub">Welcome back to your Virelix workspace.</p></div>
    <form novalidate data-login>
      <div data-form-error hidden></div>
      ${textField({ id: "email", name: "email", label: "Email", type: "email", autocomplete: "email", value: ctx.query.get("email") || "" })}
      ${passwordField({ id: "password", name: "password", label: "Password", autocomplete: "current-password" })}
      <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
        <label class="vx-check"><input type="checkbox" name="remember"> Remember me for 30 days</label>
        <a href="/forgot-password" class="small">Forgot password?</a>
      </div>
      <button type="submit" class="vx-btn primary block">Sign in</button>
    </form>
    <p class="alt">New to Virelix? <a href="/register${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}">Create an account</a></p>`);

  const form = $("[data-login]", card);
  bindReveal(form);
  if (!ctx.query.get("email")) $("#email", form).focus(); else $("#password", form).focus();
  if (ctx.query.get("reset") === "1") formError(form, "Password updated. Sign in with your new password.", "ok");
  if (ctx.query.get("verified") === "1") formError(form, "Email verified. You can sign in now.", "ok");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    formError(form, null);
    const email = form.email.value.trim();
    const password = form.password.value;
    const local = {};
    if (!email) local.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) local.email = "Enter a valid email address.";
    if (!password) local.password = "Enter your password.";
    if (Object.keys(local).length) { showFieldErrors(form, { fields: local }); return; }
    const btn = form.querySelector("[type=submit]");
    setBusy(btn, true);
    try {
      const res = await post("/api/auth/login", { email, password, remember: form.remember.checked });
      session.set({ user: res.user, unread: res.user.unread_notifications || 0 });
      applyPrefs(res.user.prefs);
      toast(html`Signed in as <strong>${res.user.name}</strong>.`);
      ctx.navigate(next, { replace: true });
    } catch (err) {
      setBusy(btn, false);
      if (err.code === "email_unverified") {
        formError(form, html`${err.message} <button type="button" class="vx-btn sm ms-1" data-resend>${icon("send", "sm")} Resend link</button>`, "warn");
        $("[data-resend]", form).addEventListener("click", async (ev) => {
          const b = ev.currentTarget;
          setBusy(b, true);
          try {
            await post("/api/auth/resend-verification", { email });
            ctx.navigate(`/verify-pending?email=${encodeURIComponent(email)}&resent=1`);
          } catch (ex) { setBusy(b, false); formError(form, ex.message); }
        });
      } else if (!showFieldErrors(form, err)) {
        formError(form, err.message);
        if (err.code === "invalid_credentials") form.password.select();
      }
    }
  });
}
