import { html, mount, $, on } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, del, qs } from "../core/api.js";
import { time, dayGroup, plural, modeLabel, sourceLabel } from "../core/format.js";
import { confirmDialog, toast, toastError } from "../components/feedback.js";
import { empty, errorBlock, loadingList, pageHead } from "../components/states.js";

export default async function history(root, ctx) {
  mount(root, html`${pageHead({ eyebrow: "Workspace", title: "Search history", lede: "Searches you've run. Your history is private: administrators can't see it, and it isn't used for analytics.",
    actions: html`<button type="button" class="vx-btn danger" data-clear disabled>${icon("trash", "sm")} Clear history</button>` })}
    <div data-body>${loadingList(5)}</div>`);
  const body = $("[data-body]", root);
  const clearBtn = $("[data-clear]", root);
  let items = [];
  let recording = true;

  const render = () => {
    clearBtn.disabled = !items.length;
    const notice = recording ? "" : html`<div class="vx-notice warn mb-4">${icon("info")}<div><strong>Recording is off.</strong> New searches aren't being saved. <a href="/settings/privacy">Change in Privacy settings</a>.</div></div>`;
    if (!items.length) {
      mount(body, html`${notice}${empty({ glyph: "⌕", title: "No searches yet", body: recording ? "Each search you run is listed here so you can reopen it later." : "Turn recording back on to keep a history of your searches.",
        actions: html`<a class="vx-btn primary" href="/search">${icon("search", "sm")} Start searching</a>` })}`);
      return;
    }
    const groups = [];
    for (const h of items) {
      const g = dayGroup(h.at);
      if (!groups.length || groups[groups.length - 1].label !== g) groups.push({ label: g, rows: [] });
      groups[groups.length - 1].rows.push(h);
    }
    mount(body, html`${notice}<div class="vx-panel">${groups.map((g) => html`<div class="vx-group-label">${g.label}</div>
      <ul class="vx-list">${g.rows.map((h) => {
        const href = `/search${qs({ q: h.query, mode: h.mode, sort: h.sort !== "coverage" ? h.sort : "", sources: h.sources?.length === 1 ? h.sources : "", categories: h.categories })}`;
        return html`<li data-id="${h.id}"><div class="lead-ico">${icon("search", "sm")}</div>
          <div class="grow"><a class="title" href="${href}">${h.query}</a>
            <div class="sub"><span class="tabular">${time(h.at)}</span><span aria-hidden="true">·</span><span class="tabular">${plural(h.result_count, "result")}</span>
              <span aria-hidden="true">·</span><span>${modeLabel(h.mode)}</span>
              ${h.sources?.length === 1 ? html`<span class="vx-badge">${sourceLabel(h.sources[0])}</span>` : ""}
              ${(h.categories || []).map((c) => html`<span class="vx-badge accent">${c}</span>`)}</div></div>
          <div class="acts"><a class="vx-btn sm" href="${href}">${icon("refresh", "sm")}<span class="hide-xs">Reopen</span></a>
            <button type="button" class="vx-btn icon sm quiet" data-delete="${h.id}" aria-label="Delete “${h.query}” from history">${icon("x", "sm")}</button></div></li>`;
      })}</ul>`)}</div>
      <p class="meta mt-3 tabular">${plural(items.length, "search", "searches")} kept · up to 300 are retained.</p>`);
  };

  const load = async () => {
    try {
      const d = await get("/api/history");
      items = d.items; recording = d.recording;
      render();
    } catch (err) {
      mount(body, errorBlock(err));
      $("[data-retry]", body)?.addEventListener("click", load);
    }
  };

  const off = on(body, "click", "[data-delete]", async (e, btn) => {
    btn.disabled = true;
    try {
      await del(`/api/history/${btn.dataset.delete}`);
      items = items.filter((h) => h.id !== btn.dataset.delete);
      render();
      toast("Removed from history.", { tone: "info" });
    } catch (err) { btn.disabled = false; toastError(err); }
  });
  clearBtn.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Clear search history?", message: `All ${plural(items.length, "search", "searches")} will be permanently deleted.`, confirmLabel: "Clear history" }))) return;
    try { const r = await del("/api/history"); items = []; render(); toast(`Cleared ${plural(r.removed, "search", "searches")}.`, { tone: "info" }); }
    catch (err) { toastError(err); }
  });
  await load();
  return off;
}
