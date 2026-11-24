// Floating filter panel: overlays results (never reflows them), traps focus, Escape/outside dismissal.
import { html, mount, $, $$ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { num } from "../core/format.js";

export const DEFAULT_FILTERS = { sources: ["corpus", "attachments"], mode: "all", categories: [] };

export function countActive(f, defaults) {
  let n = 0;
  if ([...f.sources].sort().join() !== [...defaults.sources].sort().join()) n++;
  if (f.mode !== defaults.mode) n++;
  n += f.categories.length;
  return n;
}

export function createFilterPanel(anchor, { facets, value, defaults, onApply }) {
  const trigger = $("[data-filter-trigger]", anchor);
  const panel = document.createElement("div");
  panel.className = "vx-filter-panel";
  panel.id = "filter-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "filter-title");
  anchor.appendChild(panel);
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");
  let scrim = null;
  let draft = structuredClone(value);

  const render = () => {
    const src = Object.fromEntries(facets.sources.map((s) => [s.id, s]));
    mount(panel, html`<header><h2 id="filter-title">Filters</h2>
        <button type="button" class="vx-btn icon sm quiet" data-close aria-label="Close filters">${icon("x", "sm")}</button></header>
      <div class="body">
        <fieldset><legend>Sources</legend>
          ${["corpus", "attachments"].map((id) => html`<label class="opt vx-check"><span class="d-flex gap-2 align-items-center">
            <input type="checkbox" name="sources" value="${id}" ${draft.sources.includes(id) ? "checked" : ""}>${src[id]?.label}</span>
            <span class="count">${num(src[id]?.count ?? 0)}</span></label>`)}
          <div class="vx-hint">Web, academic and media sources aren't connected.</div>
          <div class="vx-error" data-src-err role="alert"></div>
        </fieldset>
        <fieldset><legend>Matching</legend>
          ${[["all", "All terms", "Every word in your query must appear."], ["any", "Any term", "At least one word must appear."], ["phrase", "Exact phrase", "Words must appear together, in order."]]
            .map(([v, l, d]) => html`<label class="vx-check"><input type="radio" name="mode" value="${v}" ${draft.mode === v ? "checked" : ""}>
              <span><span class="d-block fw-medium text-body">${l}</span><span class="vx-hint">${d}</span></span></label>`)}
        </fieldset>
        <fieldset><legend>Subject</legend>
          ${facets.categories.length ? facets.categories.map((c) => html`<label class="opt vx-check"><span class="d-flex gap-2 align-items-center">
            <input type="checkbox" name="categories" value="${c.name}" ${draft.categories.includes(c.name) ? "checked" : ""}>${c.name}</span>
            <span class="count">${num(c.count)}</span></label>`) : html`<p class="vx-hint">No subject metadata in the corpus.</p>`}
          <div class="vx-hint">Subject filters apply to shared-corpus documents with matching metadata.</div>
        </fieldset>
        <fieldset><legend>Document type</legend>
          ${facets.document_types.map((t) => html`<label class="opt vx-check"><span class="d-flex gap-2 align-items-center">
            <input type="checkbox" ${t.supported ? "checked" : ""} disabled>${t.label}</span>
            <span class="vx-stamp">${t.supported ? "Supported" : "Not supported"}</span></label>`)}
        </fieldset>
      </div>
      <footer><button type="button" class="vx-btn quiet" data-reset>Reset</button>
        <div class="vx-row gap-2"><button type="button" class="vx-btn" data-close>Cancel</button>
        <button type="button" class="vx-btn primary" data-apply>Apply filters</button></div></footer>`);
  };

  const readDraft = () => ({
    sources: $$('input[name="sources"]:checked', panel).map((i) => i.value),
    mode: $('input[name="mode"]:checked', panel)?.value || "all",
    categories: $$('input[name="categories"]:checked', panel).map((i) => i.value),
  });

  const focusables = () => $$("button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])", panel);
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      const els = focusables();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  function open() {
    draft = structuredClone(value);
    render();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    scrim = document.createElement("div");
    scrim.className = "vx-scrim";
    scrim.addEventListener("click", close);
    anchor.insertBefore(scrim, panel); // same stacking context as the panel, directly beneath it
    panel.addEventListener("keydown", onKey);
    ($("input:checked", panel) || focusables()[0])?.focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    scrim?.remove();
    scrim = null;
    panel.removeEventListener("keydown", onKey);
    if (restoreFocus) trigger.focus();
  }

  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
    else if (e.target.closest("[data-reset]")) { draft = structuredClone(defaults); render(); focusables()[0]?.focus(); }
    else if (e.target.closest("[data-apply]")) {
      const next = readDraft();
      if (!next.sources.length) {
        $("[data-src-err]", panel).textContent = "Choose at least one source.";
        $('input[name="sources"]', panel).focus();
        return;
      }
      value = next;
      close();
      onApply(structuredClone(next));
    }
  });
  trigger.addEventListener("click", () => (panel.hidden ? open() : close()));

  return {
    open, close,
    setValue(v) { value = structuredClone(v); },
    destroy() { close({ restoreFocus: false }); panel.remove(); },
  };
}
