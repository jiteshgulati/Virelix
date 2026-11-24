// Two-column auth layout. The aside sets a keyword-in-context concordance of "index",
// quoted from the Virelix sample corpus — the product's own subject, as type.
import { html, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { wordmark } from "./shell.js";

const KWIC = [
  ["An inverted", "index", "maps every term in a collection"],
  ["Building an", "index", "starts with preprocessing"],
  ["Building the", "index", "with and without a stop list"],
  ["A B-tree", "index", "on a column lets the database find"],
  ["Most databases also offer full-text", "indexes", "which are inverted indexes"],
  ["which are inverted", "indexes", "over text columns"],
  ["back-of-book", "indexes", "and concordances listed where"],
  ["the inverted", "index", "remains central, often as the first stage"],
];

export function authLayout(root, content) {
  mount(root, html`<div class="vx-auth">
    <aside class="vx-auth-aside" aria-label="About Virelix">
      ${wordmark("sm")}
      <div class="colophon">
        <p>Every term, <em>every place</em> it appears — set out plainly.</p>
        <div class="vx-concordance" aria-hidden="true">${KWIC.map(([l, k, r]) => html`<div><span class="l">${l}</span><span class="k">${k}</span><span class="r">${r}</span></div>`)}</div>
      </div>
      <div class="foot"><span>Shared corpus · Private files · Every match shown</span></div>
    </aside>
    <main class="vx-auth-main" id="main" tabindex="-1">
      <div class="vx-auth-card">
        <div class="vx-auth-mobile-brand">${wordmark("sm", "/login")}</div>
        ${content}
      </div>
    </main>
  </div>`);
  return root.querySelector(".vx-auth-card");
}

export function passwordField({ id, name, label, autocomplete, hint = "", describedby = "" }) {
  return html`<div class="vx-field">
    <label class="vx-label" for="${id}">${label}</label>
    <div class="vx-input-wrap">
      <input class="vx-input" type="password" id="${id}" name="${name}" autocomplete="${autocomplete}" required
        aria-describedby="${id}-err ${hint ? `${id}-hint` : ""} ${describedby}" maxlength="128">
      <button type="button" class="vx-btn icon sm quiet vx-reveal" data-reveal="${id}" aria-label="Show password" aria-pressed="false">${icon("eye", "sm")}</button>
    </div>
    ${hint ? html`<div class="vx-hint" id="${id}-hint">${hint}</div>` : ""}
    <div class="vx-error" id="${id}-err" data-error-for="${name}" role="alert"></div>
  </div>`;
}

export function bindReveal(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reveal]");
    if (!btn) return;
    const input = root.querySelector(`#${btn.dataset.reveal}`);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    mount(btn, icon(show ? "eyeOff" : "eye", "sm"));
  });
}

export function textField({ id, name, label, type = "text", autocomplete = "", value = "", hint = "", maxlength = 254 }) {
  return html`<div class="vx-field">
    <label class="vx-label" for="${id}">${label}</label>
    <input class="vx-input" type="${type}" id="${id}" name="${name}" autocomplete="${autocomplete}" value="${value}" required maxlength="${maxlength}"
      aria-describedby="${id}-err ${hint ? `${id}-hint` : ""}">
    ${hint ? html`<div class="vx-hint" id="${id}-hint">${hint}</div>` : ""}
    <div class="vx-error" id="${id}-err" data-error-for="${name}" role="alert"></div>
  </div>`;
}

export function safeNext(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) return "/";
  return value;
}

export function strength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || /[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  return pw.length < 10 ? Math.min(s, 1) : s;
}
