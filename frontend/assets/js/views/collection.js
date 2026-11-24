import { html, mount, $, on, setTitle } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, patch, del, qs } from "../core/api.js";
import { relative, plural, datetime } from "../core/format.js";
import { confirmDialog, promptDialog, toast, toastError } from "../components/feedback.js";
import { empty, errorBlock, loadingList } from "../components/states.js";

export default async function collection(root, ctx) {
  const id = ctx.params.id;
  mount(root, html`<a class="vx-doc-back" href="/collections">${icon("arrowLeft", "sm")} All collections</a><div data-body>${loadingList(3)}</div>`);
  const body = $("[data-body]", root);
  let col;

  const render = () => {
    setTitle(col.name);
    mount(body, html`<header class="vx-page-head"><div class="titles"><div class="eyebrow">Collection</div>
        <h1 class="page-title">${col.name}</h1>
        <p class="lede">${col.description || html`<span class="muted">No description.</span>`}</p>
        <p class="meta tabular">${plural(col.items.length, "document")} · created ${datetime(col.created_at)} · updated ${relative(col.updated_at)}</p></div>
      <div class="actions"><button type="button" class="vx-btn" data-rename>${icon("edit", "sm")} Rename</button>
        <button type="button" class="vx-btn danger" data-delete>${icon("trash", "sm")} Delete</button></div></header>
      ${col.items.length ? html`<div class="vx-panel"><ul class="vx-list">${col.items.map((i) => html`<li>
          <div class="lead-ico">${icon("file", "sm")}</div>
          <div class="grow">${i.available ? html`<a class="title" href="/documents/${encodeURIComponent(i.doc_id)}${qs({ from: `/collections/${col.id}` })}">${i.title}</a>` : html`<span class="title">${i.title}</span>`}
            <div class="sub">${i.category ? html`<span>${i.category}</span><span aria-hidden="true">·</span>` : ""}<span>Added ${relative(i.added_at)}</span>
              ${i.available ? "" : html`<span class="vx-badge danger">No longer in corpus</span>`}</div></div>
          <div class="acts">${i.available ? html`<a class="vx-btn sm" href="/documents/${encodeURIComponent(i.doc_id)}${qs({ from: `/collections/${col.id}` })}">${icon("eye", "sm")}<span class="hide-xs">View</span></a>` : ""}
            <button type="button" class="vx-btn icon sm quiet" data-remove="${i.doc_id}" data-name="${i.title}" aria-label="Remove ${i.title} from this collection">${icon("x", "sm")}</button></div></li>`)}</ul></div>`
        : empty({ glyph: "❏", title: "This collection is empty", body: "Open a search result or document and choose Add to collection.",
            actions: html`<a class="vx-btn primary" href="/search">${icon("search", "sm")} Find documents</a><a class="vx-btn" href="/saved">From Saved Results</a>` })}`);
  };

  const load = async () => {
    try { col = await get(`/api/collections/${encodeURIComponent(id)}`); if (ctx.isCurrent()) render(); }
    catch (err) {
      if (err.status === 404) mount(body, empty({ glyph: "❏", title: "Collection not found", body: "It may have been deleted.", actions: html`<a class="vx-btn" href="/collections">All collections</a>` }));
      else { mount(body, errorBlock(err)); $("[data-retry]", body)?.addEventListener("click", load); }
    }
  };

  const offs = [
    on(body, "click", "[data-rename]", async () => {
      const r = await promptDialog({ title: "Rename collection", label: "Name", value: col.name, confirmLabel: "Rename",
        submit: (name) => patch(`/api/collections/${col.id}`, { name }) });
      if (r && r.id) { col.name = r.name; col.updated_at = r.updated_at; render(); toast("Collection renamed."); }
    }),
    on(body, "click", "[data-delete]", async () => {
      if (!(await confirmDialog({ title: "Delete this collection?", message: `“${col.name}” and its list of ${plural(col.items.length, "document")} will be deleted. The documents themselves stay in the corpus and in Saved Results.`, confirmLabel: "Delete collection" }))) return;
      try { await del(`/api/collections/${col.id}`); toast("Collection deleted.", { tone: "info" }); ctx.navigate("/collections"); }
      catch (err) { toastError(err); }
    }),
    on(body, "click", "[data-remove]", async (e, btn) => {
      if (!(await confirmDialog({ title: "Remove from collection?", message: `“${btn.dataset.name}” will be removed from “${col.name}”.`, confirmLabel: "Remove" }))) return;
      try { await del(`/api/collections/${col.id}/items/${encodeURIComponent(btn.dataset.remove)}`); col.items = col.items.filter((i) => i.doc_id !== btn.dataset.remove); render(); toast("Removed.", { tone: "info" }); }
      catch (err) { toastError(err); }
    }),
  ];
  await load();
  return () => offs.forEach((o) => o());
}
