import { html, mount, $, $$, on } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get, post, upload, qs } from "../../core/api.js";
import { num, bytes, date, datetime, plural } from "../../core/format.js";
import { openModal, confirmDialog, toast, toastError, setBusy } from "../../components/feedback.js";
import { empty, errorBlock, loadingList, pageHead } from "../../components/states.js";

export default async function documents(root, ctx) {
  root.classList.add("wide");
  const st = { q: ctx.query.get("q") || "", category: ctx.query.get("category") || "", sort: ctx.query.get("sort") || "title_asc", selected: new Set() };
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "Global documents", lede: "The shared corpus every member searches. Only Admins and the Owner can change it. Private attachments never appear here.",
    actions: html`<button type="button" class="vx-btn" data-reload>${icon("refresh", "sm")} Reload from disk</button>
      <label class="vx-btn primary">${icon("upload", "sm")} Upload .txt<input type="file" accept=".txt,text/plain" multiple class="visually-hidden" data-upload></label>` })}
    <div class="vx-panel">
      <div class="vx-panel-head">
        <form class="vx-row flex-grow-1" data-filters role="search" novalidate>
          <label class="visually-hidden" for="doc-q">Search documents</label>
          <input class="vx-input" id="doc-q" name="q" placeholder="Search title, filename or tag" value="${st.q}" autocomplete="off">
          <label class="visually-hidden" for="doc-cat">Subject</label>
          <select class="vx-select w-auto" id="doc-cat" name="category"><option value="">All subjects</option></select>
          <label class="visually-hidden" for="doc-sort">Sort</label>
          <select class="vx-select w-auto" id="doc-sort" name="sort">
            ${[["title_asc", "Title A–Z"], ["title_desc", "Title Z–A"], ["modified_desc", "Recently modified"], ["size_desc", "Largest"], ["size_asc", "Smallest"], ["words_desc", "Most words"]]
              .map(([v, l]) => html`<option value="${v}" ${st.sort === v ? "selected" : ""}>${l}</option>`)}</select>
        </form>
        <div class="vx-row" data-bulk hidden><span class="meta tabular" data-sel-count></span>
          <button type="button" class="vx-btn sm danger" data-remove-selected>${icon("trash", "sm")} Remove selected</button>
          <button type="button" class="vx-btn sm quiet" data-clear-sel>Clear</button></div>
      </div>
      <div data-table>${loadingList(6)}</div>
    </div>
    <p class="meta mt-3" data-foot></p>`);
  const table = $("[data-table]", root);
  const filters = $("[data-filters]", root);
  let items = [];
  let limits = null;

  const renderBulk = () => {
    const n = st.selected.size;
    $("[data-bulk]", root).hidden = !n;
    $("[data-sel-count]", root).textContent = `${n} selected`;
    $$("[data-pick]", table).forEach((cb) => { cb.checked = st.selected.has(cb.value); cb.closest("tr").classList.toggle("is-selected", cb.checked); });
    const all = $("[data-pick-all]", table);
    if (all) { all.checked = n > 0 && n === items.length; all.indeterminate = n > 0 && n < items.length; }
  };

  const render = () => {
    if (!items.length) {
      mount(table, html`<div class="p-4">${empty({ glyph: "∅", title: st.q || st.category ? "No documents match" : "The corpus is empty",
        body: st.q || st.category ? "Try a different search or subject." : "Upload .txt files to give members something to search." })}</div>`);
      renderBulk();
      return;
    }
    mount(table, html`<div class="vx-table-wrap"><table class="vx-table stack">
      <caption class="visually-hidden">Shared corpus documents</caption>
      <thead><tr><th class="check"><label class="vx-check"><input type="checkbox" data-pick-all aria-label="Select all documents"></label></th>
        <th>Document</th><th>Subject</th><th class="num">Words</th><th class="num">Size</th><th>Modified</th><th class="actions"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${items.map((d) => html`<tr>
        <td class="check"><label class="vx-check"><input type="checkbox" data-pick value="${d.doc_id}" aria-label="Select ${d.title}"></label></td>
        <td data-label="Document"><button type="button" class="row-title btn btn-link p-0 text-start" data-preview="${d.doc_id}">${d.title}</button>
          <div class="meta mono">${d.filename}${d.warnings.length ? html` <span class="vx-badge warn" title="${d.warnings.join(" ")}">encoding</span>` : ""}</div></td>
        <td data-label="Subject">${d.metadata.category || html`<span class="muted">—</span>`}</td>
        <td class="num" data-label="Words">${num(d.word_count)}</td>
        <td class="num" data-label="Size">${bytes(d.size_bytes)}</td>
        <td data-label="Modified" class="meta">${date(d.modified)}</td>
        <td class="actions"><button type="button" class="vx-btn sm quiet" data-preview="${d.doc_id}">${icon("eye", "sm")} Preview</button>
          <button type="button" class="vx-btn icon sm quiet" data-remove="${d.doc_id}" aria-label="Remove ${d.title}">${icon("trash", "sm")}</button></td></tr>`)}</tbody></table></div>`);
    renderBulk();
  };

  const load = async () => {
    try {
      const d = await get(`/api/admin/documents${qs({ q: st.q, category: st.category, sort: st.sort })}`);
      if (!ctx.isCurrent()) return;
      items = d.items; limits = d.limits;
      st.selected = new Set([...st.selected].filter((id) => items.some((i) => i.doc_id === id)));
      const sel = $("#doc-cat", root);
      if (sel.options.length === 1) d.categories.forEach((c) => sel.add(new Option(`${c.name} (${c.count})`, c.name, false, c.name === st.category)));
      const c = d.overview.counts;
      mount($("[data-foot]", root), html`${plural(items.length, "document")} shown · ${num(c.loaded)} loaded · ${num(c.skipped)} skipped. Uploads: ${limits.types.join(", ")} up to ${bytes(limits.max_bytes)}. Removed files move to the server's removed-documents folder.`);
      render();
    } catch (err) { mount(table, html`<div class="p-4">${errorBlock(err)}</div>`); $("[data-retry]", table)?.addEventListener("click", load); }
  };

  let t = null;
  filters.addEventListener("input", (e) => { if (e.target.name === "q") { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 220); } });
  filters.addEventListener("change", (e) => { if (e.target.name !== "q") { st[e.target.name] = e.target.value; load(); } });
  filters.addEventListener("submit", (e) => { e.preventDefault(); st.q = filters.q.value.trim(); load(); });

  const remove = async (ids) => {
    const docs = items.filter((i) => ids.includes(i.doc_id));
    const ok = await confirmDialog({ title: ids.length > 1 ? `Remove ${ids.length} documents?` : "Remove this document?",
      message: ids.length > 1 ? `${ids.length} documents will leave the shared corpus. Members will no longer find them, and saved copies will show as unavailable.`
        : `“${docs[0]?.title}” will leave the shared corpus. Members will no longer find it, and saved copies will show as unavailable.`,
      detail: "The file is moved to the server's removed-documents folder rather than erased. Rebuild the index afterwards.", confirmLabel: ids.length > 1 ? "Remove documents" : "Remove document" });
    if (!ok) return;
    try {
      const r = await post("/api/admin/documents/remove", { doc_ids: ids });
      ids.forEach((id) => st.selected.delete(id));
      toast(`Removed ${plural(r.removed.length, "document")}.`, { tone: "info" });
      load();
    } catch (err) { toastError(err); }
  };

  const preview = async (id) => {
    await openModal({ title: "Document preview", size: "modal-lg modal-dialog-scrollable",
      body: html`<div data-pv>${loadingList(2)}</div>`,
      footer: html`<a class="vx-btn" href="/documents/${encodeURIComponent(id)}" data-bs-dismiss="modal">${icon("arrowUpRight", "sm")} Open in viewer</a><button type="button" class="vx-btn primary" data-bs-dismiss="modal">Close</button>`,
      onMount: async (el) => {
        const slot = $("[data-pv]", el);
        try {
          const d = await get(`/api/admin/documents/${encodeURIComponent(id)}`);
          mount(slot, html`<h3 class="page-title mb-3">${d.title}</h3>
            <dl class="vx-ledger mb-4"><div><dt>Document ID</dt><dd class="mono">${d.doc_id}</dd></div><div><dt>File</dt><dd class="mono">${d.filename}</dd></div>
              ${Object.entries(d.metadata).map(([k, v]) => html`<div><dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${Array.isArray(v) ? v.join(", ") : v}</dd></div>`)}
              <div><dt>Words · characters</dt><dd class="tabular">${num(d.word_count)} · ${num(d.char_count)}</dd></div>
              <div><dt>Size · encoding</dt><dd>${bytes(d.size_bytes)} · <span class="mono">${d.encoding}</span></dd></div>
              <div><dt>Modified</dt><dd>${datetime(d.modified)}</dd></div></dl>
            <pre class="vx-pre">${d.text}</pre>`);
        } catch (err) { mount(slot, errorBlock(err, false)); }
      } });
  };

  const offs = [
    on(table, "change", "[data-pick]", (e, cb) => { cb.checked ? st.selected.add(cb.value) : st.selected.delete(cb.value); renderBulk(); }),
    on(table, "change", "[data-pick-all]", (e, cb) => { st.selected = cb.checked ? new Set(items.map((i) => i.doc_id)) : new Set(); renderBulk(); }),
    on(table, "click", "[data-remove]", (e, b) => remove([b.dataset.remove])),
    on(table, "click", "[data-preview]", (e, b) => preview(b.dataset.preview)),
    on(root, "click", "[data-remove-selected]", () => remove([...st.selected])),
    on(root, "click", "[data-clear-sel]", () => { st.selected.clear(); renderBulk(); }),
  ];
  $("[data-reload]", root).addEventListener("click", async (e) => {
    const b = e.currentTarget; setBusy(b, true);
    try { const o = await post("/api/admin/corpus/reload"); toast(`Reloaded: ${o.counts.loaded} loaded, ${o.counts.skipped} skipped.`); load(); }
    catch (err) { toastError(err); } finally { setBusy(b, false); }
  });
  $("[data-upload]", root).addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    let added = 0;
    for (const f of files) {
      if (!/\.txt$/i.test(f.name)) { toast(html`<strong>${f.name}</strong>: only .txt files can be added to the shared corpus.`, { tone: "danger" }); continue; }
      try { const d = await upload("/api/admin/documents", f); added++; toast(html`Added <strong>${d.title}</strong> to the shared corpus.`); }
      catch (err) { toastError(err); }
    }
    if (added) toast("Rebuild the document index to include new documents.", { tone: "info", action: { label: "Open index", run: () => ctx.navigate("/admin/index") } });
    load();
  });
  await load();
  return () => offs.forEach((o) => o());
}
