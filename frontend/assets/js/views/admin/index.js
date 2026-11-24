import { html, mount, $, on } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get, post, qs } from "../../core/api.js";
import { num, datetime, plural } from "../../core/format.js";
import { confirmDialog, toast, toastError, setBusy } from "../../components/feedback.js";
import { empty, errorBlock, loading, pageHead } from "../../components/states.js";
import { indexStateBadge } from "./overview.js";

export default async function indexView(root, ctx) {
  root.classList.add("wide");
  const st = { tab: "vocabulary", q: "", sort: "term", page: 1, term: null };
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "Index management",
    lede: "Inspect the inverted index built from the shared corpus: vocabulary, document frequencies, and postings with term frequencies and positions.",
    actions: html`<button type="button" class="vx-btn primary" data-build>${icon("refresh", "sm")} Rebuild index</button>` })}
    <div class="vx-notice mb-5">${icon("info")}<div><strong>Inspection only.</strong> Search results don't use this index for ranking yet. Rebuild it after adding or removing documents.</div></div>
    <div data-status>${loading(4)}</div>
    <div class="vx-tabs mt-5 mb-4" role="tablist" aria-label="Index views" data-tabs>
      <button type="button" class="vx-tab" role="tab" aria-selected="true" data-tab="vocabulary">${icon("index", "sm")} Vocabulary</button>
      <button type="button" class="vx-tab" role="tab" aria-selected="false" data-tab="documents">${icon("file", "sm")} Documents</button>
    </div>
    <div data-pane></div>`);
  const status = $("[data-status]", root);
  const pane = $("[data-pane]", root);
  let info = null;

  const renderStatus = () => {
    const s = info.stats;
    mount(status, html`${info.error ? html`<div class="vx-notice danger mb-3">${icon("alert")}<div>${info.error}</div></div>` : ""}
      ${info.state === "stale" ? html`<div class="vx-notice warn mb-3">${icon("alert")}<div><strong>Out of date.</strong> Documents were added, changed or removed since the last build. Rebuild to bring the index in line with the corpus.</div></div>` : ""}
      <div class="vx-figures">
        <div><div class="eyebrow">State</div><div class="mt-1">${indexStateBadge(info.state)}</div><div class="note">${s ? `Built ${datetime(s.built_at)} in ${s.build_ms} ms` : "Never built"}</div></div>
        <div><div class="eyebrow">Documents</div><div class="figure">${s ? num(s.documents) : "—"}</div><div class="note">of ${num(info.corpus_documents)} in the corpus</div></div>
        <div><div class="eyebrow">Vocabulary</div><div class="figure">${s ? num(s.vocabulary_size) : "—"}</div><div class="note">${s ? `${num(s.hapax_terms)} appear exactly once` : "distinct terms"}</div></div>
        <div><div class="eyebrow">Postings</div><div class="figure">${s ? num(s.postings) : "—"}</div><div class="note">${s ? `${num(s.total_tokens)} tokens · avg ${s.average_document_length} per doc` : "term–document pairs"}</div></div>
      </div>
      ${s ? html`<p class="meta mt-3">Stop-word removal: <strong>${s.settings.remove_stopwords ? "on" : "off"}</strong> · format v${s.format_version} · title and body tokens are both indexed.</p>` : ""}`);
  };

  const renderPane = async () => {
    if (!info.stats) {
      mount(pane, empty({ glyph: "∅", title: "Nothing to inspect yet", body: "Build the index to populate the vocabulary and postings from the shared corpus.",
        actions: html`<button type="button" class="vx-btn primary" data-build-empty>${icon("refresh", "sm")} Build index</button>` }));
      return;
    }
    if (st.tab === "documents") return renderDocs();
    mount(pane, html`<div class="vx-split">
      <section class="vx-panel"><div class="vx-panel-head">
        <form class="vx-row flex-grow-1" data-vf novalidate role="search"><label class="visually-hidden" for="vq">Filter terms</label>
          <input class="vx-input" id="vq" name="q" value="${st.q}" placeholder="Filter terms, e.g. index" autocomplete="off" spellcheck="false">
          <label class="visually-hidden" for="vs">Sort terms</label>
          <select class="vx-select w-auto" id="vs" name="sort">${[["term", "A–Z"], ["df", "Document frequency"], ["cf", "Collection frequency"]].map(([v, l]) => html`<option value="${v}" ${st.sort === v ? "selected" : ""}>${l}</option>`)}</select></form></div>
        <div data-vocab>${loading(6)}</div></section>
      <section class="vx-panel" aria-live="polite"><div class="vx-panel-head"><h2 class="section-title">Postings</h2></div><div class="vx-panel-body" data-postings>
        <p class="meta">Choose a term to see the documents it appears in, with term frequency and token positions.</p></div></section>
    </div>`);
    const vf = $("[data-vf]", pane);
    let t;
    vf.addEventListener("input", (e) => { if (e.target.name === "q") { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 1; loadVocab(); }, 200); } });
    vf.addEventListener("change", (e) => { if (e.target.name === "sort") { st.sort = e.target.value; st.page = 1; loadVocab(); } });
    vf.addEventListener("submit", (e) => e.preventDefault());
    await loadVocab();
    if (st.term) loadPostings(st.term);
  };

  const loadVocab = async () => {
    const slot = $("[data-vocab]", pane);
    try {
      const v = await get(`/api/admin/index/vocabulary${qs({ q: st.q, sort: st.sort, page: st.page, per_page: 40 })}`);
      mount(slot, v.terms.length ? html`<div class="vx-table-wrap"><table class="vx-table">
          <caption class="visually-hidden">Vocabulary terms</caption>
          <thead><tr><th>Term</th><th class="num">DF</th><th>Spread</th><th class="num">CF</th></tr></thead>
          <tbody>${v.terms.map((r) => html`<tr><td><button type="button" class="vx-term-btn" data-term="${r.term}" aria-pressed="${st.term === r.term}">${r.term}</button></td>
            <td class="num">${num(r.df)}</td><td><div class="vx-bar" role="img" aria-label="${r.df} of ${info.stats.documents} documents"><i data-w="${Math.round((r.df / info.stats.documents) * 100)}"></i></div></td>
            <td class="num">${num(r.cf)}</td></tr>`)}</tbody></table></div>
          <div class="d-flex justify-content-between align-items-center p-3 gap-2 flex-wrap"><span class="meta tabular">${plural(v.total, "term")} · page ${v.page} of ${v.pages}</span>
            <div class="vx-row gap-1"><button type="button" class="vx-btn sm" data-vpage="${v.page - 1}" ${v.page <= 1 ? "disabled" : ""}>${icon("arrowLeft", "sm")} Prev</button>
            <button type="button" class="vx-btn sm" data-vpage="${v.page + 1}" ${v.page >= v.pages ? "disabled" : ""}>Next ${icon("arrowRight", "sm")}</button></div></div>
          <p class="meta px-3 pb-3">DF = documents containing the term. CF = total occurrences across the corpus.</p>`
        : html`<div class="p-4">${empty({ glyph: "∅", title: "No terms match", body: `Nothing in the vocabulary contains “${st.q}”.` })}</div>`);
      slot.querySelectorAll(".vx-bar i").forEach((i) => { i.style.width = `${Math.max(2, Number(i.dataset.w))}%`; });
    } catch (err) { mount(slot, html`<div class="p-3">${errorBlock(err, false)}</div>`); }
  };

  const loadPostings = async (term) => {
    st.term = term;
    pane.querySelectorAll("[data-term]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.term === term)));
    const slot = $("[data-postings]", pane);
    mount(slot, loading(4));
    try {
      const p = await get(`/api/admin/index/postings${qs({ term })}`);
      mount(slot, html`<div class="d-flex align-items-baseline gap-2 mb-3"><span class="vx-term">${p.term}</span><span class="meta tabular">df ${p.df} · cf ${p.cf}</span></div>
        ${p.postings.length ? html`<ul class="vx-list">${p.postings.map((x) => html`<li class="px-0 align-items-start"><div class="grow">
            <a class="title" href="/documents/${encodeURIComponent(x.doc_id)}${qs({ terms: p.term, from: "/admin/index" })}">${x.title}</a>
            <div class="sub mono">${x.doc_id}</div>
            <div class="sub mono mt-1">positions ${x.positions.join(", ")}${x.positions_total > x.positions.length ? ` … +${x.positions_total - x.positions.length}` : ""}</div></div>
            <div class="text-end"><div class="figure fs-5">${x.tf}</div><div class="meta">tf</div></div></li>`)}</ul>`
          : html`<p class="meta">No postings — the term isn't in the vocabulary.</p>`}`);
    } catch (err) { mount(slot, errorBlock(err, false)); }
  };

  const renderDocs = async () => {
    mount(pane, loading(5));
    try {
      const { items } = await get("/api/admin/index/documents");
      mount(pane, html`<div class="vx-panel"><div class="vx-table-wrap"><table class="vx-table stack"><caption class="visually-hidden">Indexed documents</caption>
        <thead><tr><th>Document</th><th>Subject</th><th class="num">Tokens</th><th class="num">Unique terms</th><th>ID</th></tr></thead>
        <tbody>${items.map((d) => html`<tr><td data-label="Document"><a class="row-title" href="/documents/${encodeURIComponent(d.doc_id)}">${d.title}</a><div class="meta mono">${d.filename}</div></td>
          <td data-label="Subject">${d.category || "—"}</td><td class="num" data-label="Tokens">${num(d.length)}</td><td class="num" data-label="Unique">${num(d.unique_terms)}</td>
          <td data-label="ID" class="mono meta">${d.doc_id}</td></tr>`)}</tbody></table></div></div>`);
    } catch (err) { mount(pane, errorBlock(err, false)); }
  };

  const build = async (btn) => {
    const removeStop = await openStopwordChoice();
    if (removeStop === null) return;
    setBusy(btn, true);
    try {
      info = await post("/api/admin/index/rebuild", { remove_stopwords: removeStop });
      toast(`Index built: ${num(info.stats.vocabulary_size)} terms from ${plural(info.stats.documents, "document")} in ${info.stats.build_ms} ms.`);
      renderStatus(); st.page = 1; renderPane();
    } catch (err) { toastError(err); }
    finally { setBusy(btn, false); }
  };

  async function openStopwordChoice() {
    const ok = await confirmDialog({ title: info?.stats ? "Rebuild the document index?" : "Build the document index?", tone: "primary", confirmLabel: info?.stats ? "Rebuild" : "Build",
      message: "Every document in the shared corpus is tokenised and its postings recorded. The previous build is replaced.",
      detail: "Stop words such as “the” and “of” are kept in the index." });
    return ok ? false : null;
  }

  const offs = [
    on(root, "click", "[data-build], [data-build-empty]", (e, b) => build(b)),
    on(root, "click", "[data-tab]", (e, b) => {
      st.tab = b.dataset.tab;
      root.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      renderPane();
    }),
    on(pane, "click", "[data-term]", (e, b) => loadPostings(b.dataset.term)),
    on(pane, "click", "[data-vpage]", (e, b) => { st.page = parseInt(b.dataset.vpage, 10); loadVocab(); }),
  ];

  try { info = await get("/api/admin/index"); }
  catch (err) { mount(status, errorBlock(err)); return () => offs.forEach((o) => o()); }
  if (!ctx.isCurrent()) return;
  renderStatus();
  await renderPane();
  return () => offs.forEach((o) => o());
}
