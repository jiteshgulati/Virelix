import { html, mount, $, on } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, del, upload, qs } from "../core/api.js";
import { session } from "../core/store.js";
import { relative, bytes, num, modeLabel } from "../core/format.js";
import { wordmark } from "../components/shell.js";
import { searchbar, bindSearchbar } from "../components/searchbar.js";
import { toast, toastError } from "../components/feedback.js";

const ENTRIES = [
  { href: "/answers", icon: "sparkle", name: "AI Answers", desc: "Generated answers with citations.", stamp: "Not available" },
  { href: "/files", icon: "paperclip", name: "Search your files", desc: "Attach .txt files and search them privately." },
  { href: "/research", icon: "compass", name: "Research Mode", desc: "Multi-step investigation across sources.", stamp: "Not available" },
  { href: "/collections", icon: "stack", name: "Collections", desc: "Group documents into reading lists." },
];

export default async function home(root, ctx) {
  root.className = "vx-home";
  const first = session.user.name.split(" ")[0];
  mount(root, html`<div class="vx-home-inner">
    <div class="vx-home-brand">
      <h1 class="visually-hidden">Search Virelix</h1>
      ${wordmark("lg")}
      <p class="tagline">Good to see you, ${first}. Search the shared corpus and your private files.</p>
    </div>
    <div>
      ${searchbar({ size: "lg", attach: true, voice: true, id: "home-q", label: "Search Virelix" })}
      <div class="attach-row mt-3"><div class="vx-chips" data-attachments aria-live="polite"></div>
        <a class="vx-stamp text-decoration-none" href="/help#search" title="How search works">Document search preview</a></div>
    </div>
    <nav class="vx-entries" aria-label="Ways to work">${ENTRIES.map((e) => html`<a class="vx-entry" href="${e.href}">
      ${icon(e.icon)}<span class="name">${e.name}</span><span class="desc">${e.desc}</span>
      ${e.stamp ? html`<span class="vx-stamp">${e.stamp}</span>` : ""}</a>`)}</nav>
    <div class="vx-home-foot">
      <section aria-labelledby="recent-h"><div class="d-flex justify-content-between align-items-baseline">
        <h2 class="eyebrow" id="recent-h">Recent searches</h2><a class="meta" href="/history">All history</a></div>
        <div data-recent><div class="vx-skeleton vx-skel-line w-75 mt-3"></div><div class="vx-skeleton vx-skel-line w-50"></div></div></section>
      <section aria-labelledby="corpus-h"><h2 class="eyebrow" id="corpus-h">In the corpus</h2><div data-corpus class="mt-3"></div></section>
    </div>
  </div>`);

  bindSearchbar(root, { onSubmit: (q) => ctx.navigate(`/search${qs({ q })}`) });
  $("[data-search-input]", root).focus();

  const chips = $("[data-attachments]", root);
  const renderAttachments = (items) => {
    mount(chips, items.length ? html`${items.map((a) => html`<span class="vx-chip">${icon("paperclip", "sm")}
      <span class="label" title="${a.filename}">${a.filename}</span><span class="meta">${bytes(a.size_bytes)}</span>
      <button type="button" data-remove-att="${a.id}" aria-label="Remove ${a.filename}">${icon("x", "sm")}</button></span>`)}
      <span class="meta">Private · included in your searches</span>` : "");
  };
  const loadAttachments = async () => {
    try { renderAttachments((await get("/api/attachments")).items); } catch { /* non-critical */ }
  };
  $("[data-attach-input]", root).addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const file of files) {
      try {
        await upload("/api/attachments", file);
        toast(html`Attached <strong>${file.name}</strong> privately.`);
      } catch (err) { toastError(err); }
    }
    loadAttachments();
  });
  const off = on(root, "click", "[data-remove-att]", async (e, btn) => {
    try { await del(`/api/attachments/${btn.dataset.removeAtt}`); toast("Attachment removed.", { tone: "info" }); loadAttachments(); }
    catch (err) { toastError(err); }
  });

  const [hist, facets] = await Promise.allSettled([get("/api/history"), get("/api/search/facets")]);
  if (!ctx.isCurrent()) return off;
  const recent = hist.status === "fulfilled" ? hist.value.items.slice(0, 5) : [];
  mount($("[data-recent]", root), hist.status === "rejected"
    ? html`<p class="meta mt-3">History couldn't be loaded.</p>`
    : recent.length ? html`<ul class="vx-recent">${recent.map((h) => html`<li><a href="/search${qs({ q: h.query, mode: h.mode !== "all" ? h.mode : "" })}">
        ${icon("history", "sm")}<span class="q">${h.query}</span><span class="meta tabular">${relative(h.at)}</span></a></li>`)}</ul>`
      : html`<p class="meta mt-3">${hist.value.recording ? "Searches you run will appear here." : "History recording is off in Privacy settings."}</p>`);
  if (facets.status === "fulfilled") {
    const f = facets.value;
    const corpus = f.sources.find((s) => s.id === "corpus");
    mount($("[data-corpus]", root), html`<p class="meta"><span class="figure d-block mb-2">${num(corpus.count)}</span>
      shared documents across ${f.categories.length} subjects</p>
      <div class="vx-chips mt-3">${f.categories.slice(0, 6).map((c) => html`<a class="vx-badge text-decoration-none" href="/search${qs({ q: c.name, mode: "any", categories: c.name })}">${c.name}</a>`)}</div>`);
  }
  loadAttachments();
  return off;
}
