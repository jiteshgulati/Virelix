// Toasts, confirmation dialogs and text prompts built on Bootstrap's accessible primitives.
import { html, mount, esc } from "../core/dom.js";
import { icon } from "../core/icons.js";

const Bootstrap = window.bootstrap;

export function toast(message, { tone = "success", action = null, timeout = 4200 } = {}) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.setAttribute("role", tone === "danger" ? "alert" : "status");
  el.setAttribute("aria-live", tone === "danger" ? "assertive" : "polite");
  mount(el, html`<div class="toast-body"><span class="tone" aria-hidden="true"></span>
    <div class="flex-grow-1">${message}</div>
    ${action ? html`<button type="button" class="vx-btn sm quiet" data-act>${action.label}</button>` : ""}
    <button type="button" class="vx-btn icon sm quiet" data-bs-dismiss="toast" aria-label="Dismiss">${icon("x", "sm")}</button></div>`);
  host.appendChild(el);
  if (action) el.querySelector("[data-act]").addEventListener("click", () => { action.run(); t.hide(); });
  const t = new Bootstrap.Toast(el, { delay: timeout, autohide: timeout > 0 });
  el.addEventListener("hidden.bs.toast", () => el.remove());
  t.show();
  return t;
}

export function toastError(err, fallback = "Something went wrong.") {
  toast(err?.message || fallback, { tone: "danger", timeout: 6500 });
}

function modalShell({ title, body, footer, size = "" }) {
  const wrap = document.createElement("div");
  wrap.className = "modal fade";
  wrap.tabIndex = -1;
  const id = `m-${Math.random().toString(36).slice(2, 8)}`;
  wrap.setAttribute("aria-labelledby", id);
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("role", "dialog");
  mount(wrap, html`<div class="modal-dialog modal-dialog-centered ${size}"><div class="modal-content">
    <div class="modal-header"><h2 class="modal-title" id="${id}">${title}</h2>
      <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
    <div class="modal-body">${body}</div>
    ${footer ? html`<div class="modal-footer">${footer}</div>` : ""}
  </div></div>`);
  document.body.appendChild(wrap);
  return wrap;
}

/** Open a modal and resolve with whatever `resolve` is called with (null on dismiss). */
export function openModal({ title, body, footer, size, onMount }) {
  const opener = document.activeElement;
  return new Promise((resolve) => {
    const el = modalShell({ title, body, footer, size });
    const modal = new Bootstrap.Modal(el);
    let value = null;
    const done = (v) => { value = v; modal.hide(); };
    el.addEventListener("shown.bs.modal", () => {
      const focusable = el.querySelector("[autofocus], .modal-body input, .modal-body select, .modal-body button, .modal-footer .primary, .modal-footer .danger-solid");
      focusable?.focus();
    });
    el.addEventListener("hidden.bs.modal", () => {
      modal.dispose();
      el.remove();
      if (opener && document.contains(opener)) opener.focus();
      resolve(value);
    });
    onMount?.(el, done);
    modal.show();
  });
}

export async function confirmDialog({ title, message, confirmLabel = "Confirm", tone = "danger", detail = "" }) {
  const result = await openModal({
    title,
    body: html`<p class="text-wrap-pretty">${message}</p>${detail ? html`<p class="meta mt-2">${detail}</p>` : ""}`,
    footer: html`<button type="button" class="vx-btn" data-bs-dismiss="modal">Cancel</button>
      <button type="button" class="vx-btn ${tone === "danger" ? "danger-solid" : "primary"}" data-ok>${confirmLabel}</button>`,
    onMount: (el, done) => el.querySelector("[data-ok]").addEventListener("click", () => done(true)),
  });
  return result === true;
}

/** Single text field prompt with inline validation via an async submit handler. */
export function promptDialog({ title, label, value = "", placeholder = "", confirmLabel = "Save", hint = "", maxlength = 60, submit, extra = "" }) {
  return openModal({
    title,
    body: html`<form class="vx-stack" novalidate data-form>
      <div class="vx-field"><label class="vx-label" for="prompt-input">${label}</label>
        <input class="vx-input" id="prompt-input" name="value" value="${value}" placeholder="${placeholder}" maxlength="${maxlength}" autocomplete="off" required aria-describedby="prompt-err prompt-hint" autofocus>
        ${hint ? html`<div class="vx-hint" id="prompt-hint">${hint}</div>` : ""}
        <div class="vx-error" id="prompt-err" role="alert"></div></div>${extra}</form>`,
    footer: html`<button type="button" class="vx-btn" data-bs-dismiss="modal">Cancel</button>
      <button type="submit" class="vx-btn primary" data-ok>${confirmLabel}</button>`,
    onMount: (el, done) => {
      const form = el.querySelector("[data-form]");
      const input = el.querySelector("#prompt-input");
      const err = el.querySelector("#prompt-err");
      const btn = el.querySelector("[data-ok]");
      const go = async (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) { err.textContent = `${label} is required.`; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        setBusy(btn, true);
        try {
          const out = submit ? await submit(v, el) : v;
          done(out ?? v);
        } catch (ex) {
          err.textContent = ex.fields?.name || ex.message;
          input.setAttribute("aria-invalid", "true");
          input.focus();
        } finally { setBusy(btn, false); }
      };
      form.addEventListener("submit", go);
      btn.addEventListener("click", go);
    },
  });
}

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.classList.add("is-loading");
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    btn.insertAdjacentHTML("afterbegin", '<span class="spinner" aria-hidden="true"></span>');
    if (label) btn.lastChild.textContent = label;
  } else {
    btn.classList.remove("is-loading");
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
    if (btn.dataset.label !== undefined) { btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
  }
}

/** Show field errors from an ApiError on a form; returns true if any were shown. */
export function showFieldErrors(form, err) {
  clearFieldErrors(form);
  const fields = err?.fields || {};
  let first = null;
  for (const [name, msg] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (input) { input.setAttribute("aria-invalid", "true"); first ||= input; }
    if (slot) slot.textContent = msg;
  }
  first?.focus();
  return !!first;
}

export function clearFieldErrors(form) {
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  form.querySelectorAll("[data-error-for]").forEach((el) => { el.textContent = ""; });
}

export function formError(form, message, tone = "danger") {
  const slot = form.querySelector("[data-form-error]");
  if (!slot) return;
  if (!message) { slot.hidden = true; slot.replaceChildren(); return; }
  slot.hidden = false;
  mount(slot, html`<div class="vx-notice ${tone}" role="alert">${icon(tone === "danger" ? "alert" : "info")}<div>${message}</div></div>`);
}

export const escapeText = esc;
