import { html, mount, $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, post } from "../core/api.js";
import { relative, plural } from "../core/format.js";
import { promptDialog, toast } from "../components/feedback.js";
import { empty, errorBlock, pageHead } from "../components/states.js";

export async function createCollection(ctx) {
  const col = await promptDialog({ title: "New collection", label: "Name", placeholder: "e.g. Retrieval reading list", confirmLabel: "Create collection",
    hint: "Up to 60 characters. Names must be unique.", submit: (name) => post("/api/collections", { name }) });
  if (col && col.id) { toast(html`Created “${col.name}”.`); ctx.navigate(`/collections/${col.id}`); }
}

export default async function collections(root, ctx) {
  mount(root, html`${pageHead({ eyebrow: "Workspace", title: "Collections", lede: "Group documents from the shared corpus into reading lists.",
    actions: html`<button type="button" class="vx-btn primary" data-new>${icon("plus", "sm")} New collection</button>` })}
    <div data-body><div class="vx-cards">${Array.from({ length: 3 }, () => html`<div class="vx-card"><div class="vx-skeleton vx-skel-line w-50"></div><div class="vx-skeleton vx-skel-line w-25"></div></div>`)}</div></div>`);
  const body = $("[data-body]", root);
  $("[data-new]", root).addEventListener("click", () => createCollection(ctx));

  const load = async () => {
    try {
      const { items } = await get("/api/collections");
      if (!ctx.isCurrent()) return;
      mount(body, items.length ? html`<div class="vx-cards">${items.map((c) => html`<a class="vx-card stack" href="/collections/${c.id}">
          <span class="name">${c.name}</span>${c.description ? html`<span class="desc">${c.description}</span>` : ""}
          <span class="count">${plural(c.item_count, "document")} · updated ${relative(c.updated_at)}</span></a>`)}</div>`
        : empty({ glyph: "❏", title: "No collections yet", body: "Create a collection, then add documents from search results, Saved Results or the document viewer.",
            actions: html`<button type="button" class="vx-btn primary" data-new-empty>${icon("plus", "sm")} New collection</button>` }));
      $("[data-new-empty]", body)?.addEventListener("click", () => createCollection(ctx));
    } catch (err) { mount(body, errorBlock(err)); $("[data-retry]", body)?.addEventListener("click", load); }
  };
  await load();
}
