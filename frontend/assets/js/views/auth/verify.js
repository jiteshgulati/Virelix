import { html, $, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { post } from "../../core/api.js";
import { session } from "../../core/store.js";
import { authLayout } from "../../components/auth-layout.js";
import { setBusy } from "../../components/feedback.js";

export default async function verify(root, ctx) {
  const token = ctx.query.get("token") || "";
  const card = authLayout(root, html`<div data-state class="vx-state" aria-live="polite">
    <div class="seal">${icon("mail", "lg")}</div><div><h1>Verifying your email…</h1><p class="sub">One moment.</p></div></div>`);
  const state = $("[data-state]", card);
  // Remove the single-use token from the address bar and history.
  history.replaceState({}, "", "/verify-email");
  if (!token) return renderFailure({ code: "token_invalid", message: "This verification link is incomplete." });
  try {
    const r = await post("/api/auth/verify-email", { token });
    const signedIn = !!session.user;
    mount(state, html`<div class="seal">${icon("check", "lg")}</div>
      <div><h1>Email verified</h1><p class="sub"><strong>${r.email}</strong> is confirmed.
      ${r.role === "owner" ? "This account matches the configured platform owner and now holds Owner access." : "Your account is active."}</p></div>
      <a class="vx-btn primary" href="${signedIn ? "/" : `/login?email=${encodeURIComponent(r.email)}&verified=1`}">${signedIn ? "Go to Virelix" : "Continue to sign in"}</a>`);
  } catch (err) { renderFailure(err); }

  function renderFailure(err) {
    const expired = err.code === "token_expired";
    const used = err.code === "token_used";
    mount(state, html`<div class="seal ${used ? "warn" : "danger"}">${icon(used ? "info" : "alert", "lg")}</div>
      <div><h1>${used ? "Link already used" : expired ? "Link expired" : "Link not valid"}</h1>
      <p class="sub">${err.message} ${used ? "If you verified already, you can sign in." : "Request a fresh link below."}</p></div>
      <form class="vx-stack w-100" novalidate data-resend>
        <div class="vx-field"><label class="vx-label" for="email">Email</label>
          <input class="vx-input" type="email" id="email" name="email" autocomplete="email" required></div>
        <div class="vx-row"><button class="vx-btn primary" type="submit">Send a new link</button><a class="vx-btn quiet" href="/login">Sign in</a></div>
        <div data-msg></div></form>`);
    const form = $("[data-resend]", state);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]");
      setBusy(btn, true);
      try {
        await post("/api/auth/resend-verification", { email: form.email.value.trim() });
        ctx.navigate(`/verify-pending?email=${encodeURIComponent(form.email.value.trim())}&resent=1`);
      } catch (ex) {
        setBusy(btn, false);
        mount($("[data-msg]", form), html`<div class="vx-notice danger" role="alert">${icon("alert")}<div>${ex.message}</div></div>`);
      }
    });
  }
}
