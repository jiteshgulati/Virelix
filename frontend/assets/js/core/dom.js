// Safe templating: every interpolated value is HTML-escaped unless wrapped in raw().
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"'`]/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

function render(v) {
  if (v === null || v === undefined) return "";
  if (v === true || v === false) return String(v); // aria-pressed="${flag}" etc.
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function mount(el, tpl) {
  el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegated listener: on(root, "click", "[data-action=save]", (e, el) => ...) */
export function on(root, type, selector, handler, opts) {
  const fn = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

/** Highlight whole-token matches of `terms` in text, returning escaped HTML. */
/** Highlight whole-word matches of `terms`. Matching runs on the *raw* text and every
 *  segment is escaped separately, so terms such as "amp" or "39" can never match inside
 *  an HTML entity and no markup from the text survives. */
export function highlight(text, terms) {
  const source = String(text ?? "");
  const words = (terms || []).filter(Boolean).map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return raw(esc(source));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  let out = "";
  let last = 0;
  for (const m of source.matchAll(re)) {
    out += esc(source.slice(last, m.index)) + `<mark class="vx-mark">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return raw(out + esc(source.slice(last)));
}

/** Mark server-supplied ``[start, end)`` ranges. Every segment is escaped; only <mark> is added. */
export function highlightRanges(text, ranges) {
  const source = String(text ?? "");
  let out = "";
  let last = 0;
  for (const [start, end] of ranges || []) {
    if (!(Number.isInteger(start) && Number.isInteger(end)) || start < last || end <= start || end > source.length) continue;
    out += esc(source.slice(last, start)) + `<mark class="vx-mark">${esc(source.slice(start, end))}</mark>`;
    last = end;
  }
  return raw(out + esc(source.slice(last)));
}

export function announce(message) {
  const el = document.getElementById("sr-status");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = message; }, 30);
}

export function setTitle(title) {
  document.title = title ? `${title} · Virelix` : "Virelix";
}

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "·";
}
