import { html, mount, $, on, highlight } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, del, qs } from "../core/api.js";
import { date, relative, plural } from "../core/format.js";
import { collectionPicker } from "../components/workspace.js";
import { confirmDialog, toast, toastError } from "../components/feedback.js";
import { empty, errorBlock, loadingList, pageHead } from "../components/states.js";

export default async function saved(root, ctx) {
  let filter = ["all", "document", "overview"].includes(ctx.query.get("type")) ? ctx.query.get("type") : "all";
  mount(root, html`${pageHead({ eyebrow: "Workspace", title: "Saved results", lede: "Documents and extractive previews you've kept. Save from search results or any document." })}
    <div class="vx-tabs mb-4" role="tablist" aria-label="Saved item type" data-filter></div>
    <div data-body>${loadingList(4)}</div>`);
  const body = $("[data-body]", root);
  const tabs = $("[data-filter]", root);
  let items = [];

  const render = () => {
    const counts = { all: items.length, document: items.filter((i) => i.kind === "document").length, overview: items.filter((i) => i.kind === "overview").length };
    mount(tabs, html`${[["all", "All"], ["document", "Documents"], ["overview", "Previews"]].map(([id, l]) => html`<button type="button" class="vx-tab" role="tab"
      aria-selected="${filter === id}" data-type="${id}">${l} <span class="count">${counts[id]}</span></button>`)}`);
    const shown = items.filter((i) => filter === "all" || i.kind === filter);
    if (!shown.length) {
      mount(body, empty({ glyph: "❦", title: items.length ? "Nothing of this type" : "Nothing saved yet",
        body: items.length ? "Switch tabs to see your other saved items." : "Use Save on a search result or document to keep it here. Extractive previews can be saved from the AI Overview tab.",
        actions: items.length ? "" : html`<a class="vx-btn primary" href="/search">${icon("search", "sm")} Search documents</a>` }));
      return;
    }
    mount(body, html`<div class="vx-panel"><ul class="vx-list">${shown.map((s) => s.kind === "document" ? docRow(s) : overviewRow(s))}</ul></div>`);
  };

  const docRow = (s) => html`<li data-id="${s.id}">
    <div class="lead-ico">${icon("file", "sm")}</div>
    <div class="grow">${s.available ? html`<a class="title" href="/documents/${encodeURIComponent(s.doc_id)}${qs({ from: "/saved" })}">${s.title}</a>` : html`<span class="title">${s.title}</span>`}
      <div class="sub">${s.category ? html`<span>${s.category}</span><span aria-hidden="true">·</span>` : ""}<span>Saved ${relative(s.saved_at)}</span>
        ${s.query ? html`<span aria-hidden="true">·</span><span>from “${s.query}”</span>` : ""}
        ${s.available ? "" : html`<span class="vx-badge danger">No longer in corpus</span>`}</div>
      ${s.excerpt ? html`<p class="meta mt-2 text-truncate-2">${s.excerpt}</p>` : ""}</div>
    <div class="acts">
      ${s.available ? html`<a class="vx-btn sm" href="/documents/${encodeURIComponent(s.doc_id)}${qs({ from: "/saved" })}">${icon("eye", "sm")}<span class="hide-xs">View</span></a>
        <button type="button" class="vx-btn icon sm quiet" data-collect="${s.doc_id}" data-title="${s.title}" aria-label="Add ${s.title} to a collection">${icon("stack", "sm")}</button>` : ""}
      <button type="button" class="vx-btn icon sm quiet" data-remove="${s.id}" data-name="${s.title}" aria-label="Remove ${s.title} from Saved Results">${icon("trash", "sm")}</button></div></li>`;

  const overviewRow = (s) => html`<li data-id="${s.id}" class="align-items-start">
    <div class="lead-ico">${icon("quote", "sm")}</div>
    <div class="grow"><div class="title">${s.title}</div>
      <div class="sub"><span class="vx-stamp">Extractive preview</span><span>Saved ${relative(s.saved_at)}</span></div>
      <details class="mt-2"><summary class="meta">Show ${plural(s.passages.length, "passage")} and ${plural(s.references.length, "reference")}</summary>
        <div class="vx-stack mt-3">${s.passages.map((p) => html`<div class="vx-quote"><span class="n">${icon("quote", "sm")}</span><div>
          <blockquote>${highlight(p.text, p.matched_terms)}</blockquote>
          <cite><a href="/documents/${encodeURIComponent(p.doc_id)}${qs({ terms: p.matched_terms.join(" "), from: "/saved" })}">${p.title}</a></cite></div></div>`)}</div></details></div>
    <div class="acts"><a class="vx-btn sm" href="/search${qs({ q: s.query, tab: "overview", mode: s.mode !== "all" ? s.mode : "" })}">${icon("refresh", "sm")}<span class="hide-xs">Re-run</span></a>
      <button type="button" class="vx-btn icon sm quiet" data-remove="${s.id}" data-name="${s.title}" aria-label="Remove preview from Saved Results">${icon("trash", "sm")}</button></div></li>`;

  const load = async () => {
    try { items = (await get("/api/saved")).items; render(); }
    catch (err) { mount(body, errorBlock(err)); $("[data-retry]", body)?.addEventListener("click", load); }
  };

  const offs = [
    on(tabs, "click", "[data-type]", (e, btn) => { filter = btn.dataset.type; render(); }),
    on(body, "click", "[data-collect]", (e, btn) => collectionPicker(btn.dataset.collect, btn.dataset.title)),
    on(body, "click", "[data-remove]", async (e, btn) => {
      if (!(await confirmDialog({ title: "Remove saved item?", message: `“${btn.dataset.name}” will be removed from Saved Results. Collections aren't affected.`, confirmLabel: "Remove" }))) return;
      try {
        await del(`/api/saved/${btn.dataset.remove}`);
        items = items.filter((i) => i.id !== btn.dataset.remove);
        render();
        toast("Removed from Saved Results.", { tone: "info" });
      } catch (err) { toastError(err); }
    }),
  ];
  await load();
  return () => offs.forEach((o) => o());
}
