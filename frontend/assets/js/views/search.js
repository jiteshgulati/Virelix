import { html, mount, $, $$, on, highlight, announce, setTitle } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, post, qs } from "../core/api.js";
import { session } from "../core/store.js";
import { updateQuery, currentPath } from "../core/router.js";
import { date, num, plural, sourceLabel, modeLabel } from "../core/format.js";
import { searchbar, bindSearchbar } from "../components/searchbar.js";
import { createFilterPanel, countActive } from "../components/filter-panel.js";
import { toggleSave, collectionPicker, copyLink } from "../components/workspace.js";
import { toast, toastError, setBusy } from "../components/feedback.js";
import { empty, errorBlock, unavailable } from "../components/states.js";

const TABS = [
  { id: "all", label: "All", icon: "layers" },
  { id: "overview", label: "AI Overview", icon: "quote" },
  { id: "web", label: "Web", icon: "globe" },
  { id: "academic", label: "Academic", icon: "graduation" },
  { id: "code", label: "Code", icon: "code" },
  { id: "images", label: "Images", icon: "image" },
  { id: "videos", label: "Videos", icon: "video" },
  { id: "books", label: "Books", icon: "book" },
];
const UNAVAILABLE = {
  web: { iconName: "globe", title: "Web results aren't connected", body: "Virelix searches its shared corpus and your private attachments. No web search provider is integrated, so there are no web results to show.", points: ["Your query still runs against the corpus under All.", "Your private attachments are included when “My attachments” is selected."] },
  academic: { iconName: "graduation", title: "No academic index is connected", body: "Scholarly databases (papers, citations, journals) aren't integrated. The shared corpus contains academic-style articles, which appear under All.", points: ["Use the Subject filter to narrow the corpus, e.g. Information Retrieval.", "Scholarly sources aren't connected."] },
  code: { iconName: "code", title: "Code search isn't available", body: "There's no source-code index. Virelix currently indexes plain-text documents only.", points: ["Technical articles about algorithms and data structures appear under All."] },
  images: { iconName: "image", title: "Image search isn't available", body: "Virelix doesn't process images. Image-based search isn't available.", points: ["Only .txt documents are supported."] },
  videos: { iconName: "video", title: "Video search isn't available", body: "No video source is connected and media isn't indexed.", points: ["Only .txt documents are supported."] },
  books: { iconName: "book", title: "Book search isn't connected", body: "No catalogue or book provider is integrated. Long-form documents you add to the corpus appear under All.", points: ["Admins can add .txt documents to the shared corpus."] },
};
const SORTS = [
  ["coverage", "Most terms matched"], ["title_asc", "Title A–Z"], ["title_desc", "Title Z–A"], ["date_desc", "Newest first"], ["date_asc", "Oldest first"],
];
const FKEY = "vx-search-filters";

function readFilters(query, prefs) {
  let stored = {};
  try { stored = JSON.parse(sessionStorage.getItem(FKEY) || "{}"); } catch { /* ignore */ }
  const list = (v) => (v ? v.split(",").filter(Boolean) : null);
  return {
    sources: list(query.get("sources")) || stored.sources || prefs.default_sources,
    mode: query.get("mode") || stored.mode || prefs.default_mode,
    categories: list(query.get("categories")) || stored.categories || [],
  };
}

function pageList(page, pages) {
  const out = new Set([1, pages, page, page - 1, page + 1]);
  const list = [...out].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const withGaps = [];
  list.forEach((p, i) => { if (i && p - list[i - 1] > 1) withGaps.push("…"); withGaps.push(p); });
  return withGaps;
}

export default async function search(root, ctx) {
  root.classList.add("wide");
  const prefs = session.user.prefs;
  const defaults = { sources: prefs.default_sources, mode: prefs.default_mode, categories: [] };
  const state = {
    q: (ctx.query.get("q") || "").trim(),
    tab: TABS.some((t) => t.id === ctx.query.get("tab")) ? ctx.query.get("tab") : "all",
    sort: SORTS.some(([v]) => v === ctx.query.get("sort")) ? ctx.query.get("sort") : "coverage",
    page: Math.max(1, parseInt(ctx.query.get("page") || "1", 10) || 1),
    filters: readFilters(ctx.query, prefs),
    record: true,
  };
  let controller = null;
  let facets = { sources: [], categories: [], document_types: [] };
  let filterPanel = null;

  mount(root, html`
    <div class="vx-results-head">
      <h1 class="visually-hidden" data-h1>Search</h1>
      <div class="vx-results-tools">
        ${searchbar({ value: state.q, attach: false, id: "results-q" })}
        <div class="vx-filter-anchor" data-filter-anchor>
          <button type="button" class="vx-btn vx-filter-btn" data-filter-trigger>${icon("filter", "sm")} Filter <span class="n" data-filter-count hidden></span></button>
        </div>
        <div class="dropdown">
          <button type="button" class="vx-btn" data-bs-toggle="dropdown" aria-expanded="false" data-sort-btn>${icon("sort", "sm")} <span data-sort-label></span></button>
          <div class="dropdown-menu dropdown-menu-end" data-sort-menu role="menu"></div>
        </div>
      </div>
      <div class="vx-tabs vx-results-tabs" role="tablist" aria-label="Result categories" data-tabs></div>
    </div>
    <div class="vx-results-body" id="results-panel" role="tabpanel" data-body tabindex="-1"></div>
    <div class="vx-followup" data-followup hidden>
      <form data-followup-form novalidate>
        ${icon("plus", "sm")}
        <label class="visually-hidden" for="followup">Refine this search with more words</label>
        <input id="followup" name="followup" maxlength="200" autocomplete="off" placeholder="Refine — add words to this search">
        <button type="submit" class="vx-btn primary sm">Refine</button>
      </form>
      <div class="note">Follow-ups add terms to your current query. Conversational follow-up questions arrive with AI Answers, which isn't available yet.</div>
    </div>`);

  const body = $("[data-body]", root);
  const tabsEl = $("[data-tabs]", root);
  const { input } = bindSearchbar(root, {
    onSubmit: (q) => { state.q = q; state.page = 1; state.record = true; sync(); run(); },
  });
  if (!state.q) input.focus();

  // ---------- chrome ----------
  function renderTabs() {
    tabsEl.hidden = !state.q;
    mount(tabsEl, html`${TABS.map((t) => html`<button type="button" class="vx-tab" role="tab" id="tab-${t.id}" data-tab="${t.id}"
      aria-selected="${state.tab === t.id}" aria-controls="results-panel" tabindex="${state.tab === t.id ? 0 : -1}">
      ${icon(t.icon, "sm")} ${t.label}${UNAVAILABLE[t.id] ? html` <span class="vx-stamp" aria-label="not connected">n/a</span>` : ""}</button>`)}`);
    body.setAttribute("aria-labelledby", `tab-${state.tab}`);
  }
  function renderSort() {
    $("[data-sort-label]", root).textContent = SORTS.find(([v]) => v === state.sort)[1];
    mount($("[data-sort-menu]", root), html`<h6 class="dropdown-header">Order results by</h6>${SORTS.map(([v, l]) => html`
      <button type="button" class="dropdown-item" role="menuitemradio" aria-checked="${state.sort === v}" data-sort="${v}">
      ${state.sort === v ? icon("check", "sm") : html`<span class="vx-i sm"></span>`} ${l}</button>`)}
      <div class="dropdown-divider"></div><div class="px-3 pb-1 meta">Results aren't ranked by relevance yet.</div>`);
    const disabled = !state.q || state.tab !== "all";
    $("[data-sort-btn]", root).disabled = disabled;
  }
  function renderFilterCount() {
    const n = countActive(state.filters, defaults);
    const el = $("[data-filter-count]", root);
    el.hidden = !n;
    el.textContent = String(n);
    $("[data-filter-trigger]", root).setAttribute("aria-label", n ? `Filter, ${n} active` : "Filter");
  }
  function sync() {
    updateQuery({ q: state.q, tab: state.tab !== "all" ? state.tab : "", sort: state.sort !== "coverage" ? state.sort : "",
      page: state.page > 1 ? state.page : "", mode: state.filters.mode !== defaults.mode ? state.filters.mode : "",
      sources: state.filters.sources.join() !== defaults.sources.join() ? state.filters.sources : "",
      categories: state.filters.categories });
    try { sessionStorage.setItem(FKEY, JSON.stringify(state.filters)); } catch { /* ignore */ }
    setTitle(state.q ? `“${state.q}”` : "Search");
    renderTabs();
    renderSort();
    renderFilterCount();
    $("[data-followup]", root).hidden = !state.q || state.tab !== "all";
  }

  // ---------- content ----------
  async function run() {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    if (!state.q) return renderLanding();
    if (UNAVAILABLE[state.tab]) {
      mount(body, unavailable({ ...UNAVAILABLE[state.tab], stamp: "Not connected", actions: html`<button type="button" class="vx-btn" data-tab-go="all">${icon("layers", "sm")} See corpus results</button>` }));
      return;
    }
    body.setAttribute("aria-busy", "true");
    mount(body, html`<div class="vx-results-meta"><div class="vx-skeleton vx-skel-line w-50"></div></div>${Array.from({ length: 4 }, () => html`
      <div class="vx-result"><span></span><div><div class="vx-skeleton vx-skel-line w-25"></div><div class="vx-skeleton vx-skel-line w-50"></div><div class="vx-skeleton vx-skel-line"></div><div class="vx-skeleton vx-skel-line w-75"></div></div></div>`)}`);
    try {
      if (state.tab === "overview") await runOverview(signal);
      else await runAll(signal);
    } catch (err) {
      if (err.name === "AbortError") return;
      mount(body, err.code === "invalid_query"
        ? empty({ glyph: "?", title: "That query can't be searched", body: `${err.message} Try words or numbers, e.g. “inverted index”.` })
        : errorBlock(err));
    } finally {
      if (!signal.aborted) body.removeAttribute("aria-busy");
    }
  }

  function renderLanding() {
    mount(body, html`<div class="vx-stack-lg">
      <div><div class="eyebrow mb-2">Search</div><h2 class="page-title">What are you looking for?</h2>
        <p class="lede mt-2">Type words that should appear in a document. Results come from the shared corpus and your private attachments.</p></div>
      <div class="vx-grid-3">${[["all", "All terms", "inverted index → documents containing both words."], ["any", "Any term", "hashing OR sorting → documents with either."], ["phrase", "Exact phrase", "“search engine” → the words together, in order."]]
        .map(([m, t, d]) => html`<div class="vx-panel vx-panel-pad"><div class="fw-semibold">${t}</div><p class="meta mt-1">${d}</p></div>`)}</div>
      <div class="vx-notice">${icon("info")}<div><strong>Document search preview.</strong> Every document is checked for your words, and each result shows exactly which ones matched. Results aren't ranked by relevance yet.</div></div>
    </div>`);
  }

  async function runAll(signal) {
    const params = { q: state.q, mode: state.filters.mode, sort: state.sort, page: state.page, per_page: prefs.per_page,
      sources: state.filters.sources, categories: state.filters.categories, record: state.record && state.page === 1 ? 1 : "", tab: "all" };
    const data = await get(`/api/search${qs(params)}`, { signal });
    state.record = false;
    if (data.page !== state.page) { state.page = data.page; sync(); }
    const showEx = prefs.show_excerpts !== false;
    const showTerms = prefs.show_matched_terms !== false;
    const offset = (data.page - 1) * data.per_page;
    const applied = html`${state.filters.mode !== defaults.mode ? html`<span class="vx-badge">${modeLabel(state.filters.mode)}</span>` : ""}
      ${state.filters.sources.join() !== defaults.sources.join() ? state.filters.sources.map((s) => html`<span class="vx-badge">${sourceLabel(s)}</span>`) : ""}
      ${state.filters.categories.map((c) => html`<span class="vx-badge accent">${c}</span>`)}`;
    const hasApplied = countActive(state.filters, defaults) > 0;
    const how = { all: "contain all of", any: "contain any of", phrase: "contain the phrase" }[data.mode];

    mount(body, html`
      <div class="vx-results-meta">
        <div><strong class="tabular">${plural(data.total, "document")}</strong> ${how}
          ${data.mode === "phrase" ? html`<span class="vx-term">${data.terms.join(" ")}</span>` : data.terms.map((t) => html` <span class="vx-term">${t}</span>`)}
          <span class="ms-1">· searched ${num(data.searched)}</span></div>
        <button type="button" class="vx-btn sm quiet" data-bs-toggle="popover" data-method>${icon("info", "sm")} How results are chosen</button>
      </div>
      ${hasApplied ? html`<div class="vx-applied">${applied}<button type="button" class="vx-btn sm quiet" data-clear-filters>Clear filters</button></div>` : ""}
      ${data.terms_without_matches.length && data.total ? html`<div class="vx-notice">${icon("info")}<div>No document contains ${data.terms_without_matches.map((t) => html`<span class="vx-term missing">${t}</span> `)}</div></div>` : ""}
      ${data.total ? html`<ol class="vx-results" start="${offset + 1}" aria-label="Results">${data.results.map((r, i) => resultItem(r, offset + i + 1, data, showEx, showTerms))}</ol>
        ${data.pages > 1 ? html`<nav class="vx-results-foot" aria-label="Result pages"><span class="meta tabular">Showing ${num(offset + 1)}–${num(offset + data.results.length)} of ${num(data.total)}</span>
          <ul class="pagination">
            <li class="page-item ${data.page === 1 ? "disabled" : ""}"><button class="page-link" data-page="${data.page - 1}" aria-label="Previous page" ${data.page === 1 ? "disabled" : ""}>${icon("arrowLeft", "sm")}</button></li>
            ${pageList(data.page, data.pages).map((p) => p === "…" ? html`<li class="page-item disabled"><span class="page-link">…</span></li>`
              : html`<li class="page-item ${p === data.page ? "active" : ""}"><button class="page-link" data-page="${p}" ${p === data.page ? html`aria-current="page"` : ""} aria-label="Page ${p}">${p}</button></li>`)}
            <li class="page-item ${data.page === data.pages ? "disabled" : ""}"><button class="page-link" data-page="${data.page + 1}" aria-label="Next page" ${data.page === data.pages ? "disabled" : ""}>${icon("arrowRight", "sm")}</button></li>
          </ul></nav>` : ""}`
      : noResults(data)}`);
    const pop = $("[data-method]", body);
    if (pop) new window.bootstrap.Popover(pop, { content: data.method, placement: "bottom", trigger: "focus click", customClass: "vx-popover" });
    announce(`${data.total} documents found`);
  }

  function noResults(data) {
    const suggestions = [];
    if (data.mode === "all" && data.terms.length > 1) suggestions.push(html`<button type="button" class="vx-btn" data-mode-go="any">Match any term instead</button>`);
    if (data.mode === "phrase") suggestions.push(html`<button type="button" class="vx-btn" data-mode-go="all">Match all terms anywhere</button>`);
    if (countActive(state.filters, defaults)) suggestions.push(html`<button type="button" class="vx-btn" data-clear-filters>Clear filters</button>`);
    return empty({ glyph: "∅", title: "No documents match", center: false,
      body: data.terms_without_matches.length
        ? `None of the searched documents contain: ${data.terms_without_matches.join(", ")}. Check the spelling or try different words.`
        : "Each word appears somewhere, but no single document satisfies this matching mode and these filters.",
      actions: suggestions });
  }

  function resultItem(r, n, data, showEx, showTerms) {
    const terms = r.matched_terms;
    const href = r.source === "corpus"
      ? `/documents/${encodeURIComponent(r.doc_id)}${qs({ terms: terms.join(" "), from: currentPath() })}`
      : `/attachments/${encodeURIComponent(r.doc_id)}${qs({ terms: terms.join(" "), from: currentPath() })}`;
    const isCorpus = r.source === "corpus";
    return html`<li class="vx-result" data-doc="${r.doc_id}">
      <span class="ord" aria-hidden="true">${String(n).padStart(2, "0")}</span>
      <div>
        <div class="src">${isCorpus ? html`<span>${sourceLabel("corpus")}</span>` : html`<span class="private">${icon("lock", "sm")} Private attachment</span>`}
          ${r.category ? html`<span class="dot"></span><span>${r.category}</span>` : ""}
          ${r.date ? html`<span class="dot"></span><span>${date(r.date)}</span>` : ""}
          <span class="dot"></span><span class="mono">${r.filename}</span></div>
        <h3><a href="${href}">${highlight(r.title, terms)}</a></h3>
        ${showEx ? html`<p class="excerpt"><span class="kind">${r.excerpt_kind === "summary" ? "Summary" : "Opening"}</span>${highlight(r.excerpt, terms)}</p>` : ""}
        <div class="foot">
          ${showTerms ? html`<div class="vx-provenance"><span class="lbl">matched ${terms.length}/${data.terms.length}</span>
            ${terms.map((t) => html`<span class="vx-term">${t}</span>`)}${r.missing_terms.map((t) => html`<span class="vx-term missing" title="Not in this document">${t}</span>`)}</div>` : html`<span></span>`}
          <div class="acts">
            ${isCorpus ? html`<button type="button" class="vx-btn sm quiet" data-save="${r.doc_id}" aria-pressed="${r.saved}" aria-label="${r.saved ? "Remove from Saved Results" : "Save result"}">${icon("bookmark", "sm")}<span data-label>${r.saved ? "Saved" : "Save"}</span></button>
              <button type="button" class="vx-btn sm quiet" data-collect="${r.doc_id}" data-title="${r.title}">${icon("stack", "sm")}<span class="hide-xs">Collection</span></button>` : ""}
            <div class="dropdown"><button type="button" class="vx-btn icon sm quiet" data-bs-toggle="dropdown" aria-expanded="false" aria-label="More actions for ${r.title}">${icon("more", "sm")}</button>
              <div class="dropdown-menu dropdown-menu-end">
                <a class="dropdown-item" href="${href}">${icon("eye", "sm")} View document</a>
                <a class="dropdown-item" href="${href}" target="_blank" rel="noopener">${icon("arrowUpRight", "sm")} Open in new tab</a>
                <button type="button" class="dropdown-item" data-copy="${isCorpus ? `/documents/${r.doc_id}` : `/attachments/${r.doc_id}`}">${icon("link", "sm")} Copy link</button>
                ${!isCorpus ? html`<div class="dropdown-divider"></div><div class="px-3 py-1 meta">Private attachments are temporary, so they can't be saved or collected.</div>` : ""}
              </div></div>
          </div>
        </div>
      </div></li>`;
  }

  async function runOverview(signal) {
    const data = await get(`/api/search/overview${qs({ q: state.q, mode: state.filters.mode })}`, { signal });
    if (!data.passages.length) {
      mount(body, empty({ glyph: "“", title: "Nothing to quote for this query", body: data.matching_documents
        ? "Matching documents were found, but no single sentence contains your terms. Open the results under All."
        : "No shared-corpus document matches this query.", actions: html`<button type="button" class="vx-btn" data-tab-go="all">See all results</button>` }));
      return;
    }
    const refIndex = Object.fromEntries(data.references.map((r, i) => [r.doc_id, i + 1]));
    mount(body, html`<article class="vx-overview" aria-labelledby="ov-title">
      <div class="vx-overview-head"><div class="vx-row gap-2"><h2 class="section-title" id="ov-title">Extractive preview</h2>
        <span class="vx-stamp accent">Not generative AI</span></div>
        <button type="button" class="vx-btn sm" data-save-overview>${icon("bookmark", "sm")} Save answer</button></div>
      <div class="vx-overview-body">
        <p class="meta">${data.method} Drawn from ${plural(data.matching_documents, "matching document")} in the shared corpus.</p>
        ${data.passages.map((p) => html`<div class="vx-quote"><span class="n">[${refIndex[p.doc_id]}]</span>
          <div><blockquote>${highlight(p.text, p.matched_terms)}</blockquote>
          <cite><a href="/documents/${encodeURIComponent(p.doc_id)}${qs({ terms: p.matched_terms.join(" "), from: currentPath() })}">${p.title}</a> · sentence ${p.sentence_index + 1}</cite></div></div>`)}
      </div>
      <ol class="vx-refs" aria-label="References">${data.references.map((r, i) => html`<li><span class="n">[${i + 1}]</span>
        <a href="/documents/${encodeURIComponent(r.doc_id)}">${r.title}</a><span class="meta">${sourceLabel(r.source)}</span></li>`)}</ol>
    </article>
    <div class="vx-notice">${icon("sparkle")}<div><strong>This isn't a generated answer.</strong> Every sentence above is quoted from a document in the shared corpus. AI Answers isn't available yet.</div></div>`);
  }

  // ---------- events ----------
  const offs = [
    on(tabsEl, "click", "[data-tab]", (e, btn) => selectTab(btn.dataset.tab)),
    on(tabsEl, "keydown", "[data-tab]", (e, btn) => {
      const ids = TABS.map((t) => t.id);
      let i = ids.indexOf(btn.dataset.tab);
      if (e.key === "ArrowRight") i = (i + 1) % ids.length;
      else if (e.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = ids.length - 1;
      else return;
      e.preventDefault();
      selectTab(ids[i]);
      $(`[data-tab="${ids[i]}"]`, tabsEl).focus();
    }),
    on(root, "click", "[data-tab-go]", (e, btn) => selectTab(btn.dataset.tabGo)),
    on(root, "click", "[data-sort]", (e, btn) => { state.sort = btn.dataset.sort; state.page = 1; sync(); run(); }),
    on(body, "click", "[data-page]", (e, btn) => {
      state.page = parseInt(btn.dataset.page, 10);
      sync(); run();
      body.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }),
    on(body, "click", "[data-mode-go]", (e, btn) => applyFilters({ ...state.filters, mode: btn.dataset.modeGo })),
    on(body, "click", "[data-clear-filters]", () => applyFilters(structuredClone(defaults))),
    on(body, "click", "[data-save]", (e, btn) => toggleSave(btn, btn.dataset.save, state.q)),
    on(body, "click", "[data-collect]", (e, btn) => collectionPicker(btn.dataset.collect, btn.dataset.title)),
    on(body, "click", "[data-copy]", (e, btn) => copyLink(btn.dataset.copy)),
    on(body, "click", "[data-save-overview]", async (e, btn) => {
      setBusy(btn, true);
      try {
        await post("/api/saved/overview", { query: state.q, mode: state.filters.mode });
        setBusy(btn, false);
        btn.disabled = true;
        btn.textContent = "Saved";
        toast(html`Preview saved. <a href="/saved">View Saved Results</a>`);
      } catch (err) { setBusy(btn, false); toastError(err); }
    }),
  ];
  $("[data-followup-form]", root).addEventListener("submit", (e) => {
    e.preventDefault();
    const extra = e.target.followup.value.trim();
    if (!extra) { e.target.followup.focus(); return; }
    e.target.followup.value = "";
    state.q = `${state.q} ${extra}`.slice(0, 300);
    input.value = state.q;
    input.dispatchEvent(new Event("input"));
    state.page = 1; state.record = true;
    sync(); run();
  });

  function selectTab(id) {
    if (state.tab === id) return;
    state.tab = id;
    state.page = 1;
    sync(); run();
  }
  function applyFilters(next) {
    state.filters = next;
    filterPanel?.setValue(next);
    state.page = 1; state.record = true;
    sync(); run();
    toast("Filters applied.", { tone: "info", timeout: 2000 });
  }

  sync();
  const runPromise = run();
  try {
    facets = await get("/api/search/facets");
    if (!ctx.isCurrent()) return;
    filterPanel = createFilterPanel($("[data-filter-anchor]", root), { facets, value: state.filters, defaults, onApply: applyFilters });
  } catch (err) {
    $("[data-filter-trigger]", root).disabled = true;
  }
  await runPromise;

  return () => {
    controller?.abort();
    offs.forEach((off) => off());
    filterPanel?.destroy();
    $$("[data-method]", root).forEach((el) => window.bootstrap.Popover.getInstance(el)?.dispose());
  };
}
