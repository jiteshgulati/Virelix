// Search field with single clear control, optional attachment + (unavailable) voice controls.
import { html, $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { toast } from "./feedback.js";

export function searchbar({ value = "", size = "", attach = false, voice = false, id = "q", label = "Search documents" } = {}) {
  return html`<form class="vx-searchbar ${size}" role="search" data-searchbar novalidate>
    <span class="lead">${icon("search")}</span>
    <label class="visually-hidden" for="${id}">${label}</label>
    <input type="search" id="${id}" name="q" value="${value}" placeholder="Search the corpus and your files" autocomplete="off"
      spellcheck="false" maxlength="300" data-search-input enterkeyhint="search" aria-describedby="${id}-hint">
    <span class="visually-hidden" id="${id}-hint">Press slash to focus search from anywhere.</span>
    <button type="button" class="vx-btn icon quiet" data-clear aria-label="Clear search" ${value ? "" : "hidden"}>${icon("x", "sm")}</button>
    ${attach || voice ? html`<span class="sep hide-xs" aria-hidden="true"></span>` : ""}
    ${attach ? html`<label class="vx-btn icon quiet" data-attach-label title="Attach a private .txt file">
        ${icon("paperclip")}<span class="visually-hidden">Attach a private text file</span>
        <input type="file" accept=".txt,text/plain" multiple class="visually-hidden" data-attach-input></label>` : ""}
    ${voice ? html`<button type="button" class="vx-btn icon quiet hide-xs" aria-disabled="true" data-voice
        aria-label="Voice search (not available yet)" title="Voice search isn't available yet">${icon("micOff")}</button>` : ""}
    <button type="submit" class="vx-btn primary submit">${icon("arrowRight", "sm")}<span class="visually-hidden">Search</span></button>
  </form>`;
}

/** Wire clear/voice behaviour. onSubmit receives the trimmed query. */
export function bindSearchbar(root, { onSubmit, onClear } = {}) {
  const form = $("[data-searchbar]", root);
  const input = $("[data-search-input]", form);
  const clear = $("[data-clear]", form);
  const sync = () => { clear.hidden = !input.value; };
  input.addEventListener("input", sync);
  clear.addEventListener("click", () => {
    input.value = "";
    sync();
    input.focus();
    onClear?.();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) {
      input.focus();
      input.setAttribute("aria-invalid", "true");
      toast("Type something to search for.", { tone: "info" });
      return;
    }
    input.removeAttribute("aria-invalid");
    onSubmit?.(q);
  });
  $("[data-voice]", form)?.addEventListener("click", () => {
    toast("Voice search isn't available yet. Type your query instead.", { tone: "info" });
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); clear.click(); } });
  return { form, input };
}
