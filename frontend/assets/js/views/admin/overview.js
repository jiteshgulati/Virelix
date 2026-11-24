import { html, mount, $ } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get } from "../../core/api.js";
import { session } from "../../core/store.js";
import { num, bytes, datetime, plural } from "../../core/format.js";
import { errorBlock, loading, pageHead } from "../../components/states.js";

export const indexStateBadge = (state) => ({
  current: html`<span class="vx-badge ok"><span class="pip"></span>Current</span>`,
  stale: html`<span class="vx-badge warn"><span class="pip"></span>Out of date</span>`,
  not_initialized: html`<span class="vx-badge"><span class="pip"></span>Not initialised</span>`,
}[state] || html`<span class="vx-badge">${state}</span>`);

export default async function overview(root, ctx) {
  const owner = session.user.role === "owner";
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "Overview", lede: "Live state of the shared corpus, the document index and accounts. Every figure is read from the server when the page loads." })}
    <div data-body>${loading(6)}</div>`);
  const body = $("[data-body]", root);
  const load = async () => {
    let d;
    try { d = await get("/api/admin/overview"); } catch (err) { mount(body, errorBlock(err)); $("[data-retry]", body)?.addEventListener("click", load); return; }
    if (!ctx.isCurrent()) return;
    const c = d.corpus.counts;
    const s = d.index.stats;
    mount(body, html`<div class="vx-stack-lg">
      ${d.corpus.error ? html`<div class="vx-notice danger">${icon("alert")}<div><strong>Corpus folder problem.</strong> ${d.corpus.error}</div></div>` : ""}
      <div class="vx-figures">
        <div><div class="eyebrow">Shared documents</div><div class="figure">${num(c.loaded)}</div><div class="note">loaded of ${num(c.discovered)} files found · ${bytes(c.total_bytes)}</div></div>
        <div><div class="eyebrow">Skipped files</div><div class="figure">${num(c.skipped)}</div><div class="note">${c.skipped ? Object.entries(c.skipped_by_reason).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") : "Every file loaded cleanly"}</div></div>
        <div><div class="eyebrow">Vocabulary</div><div class="figure">${s ? num(s.vocabulary_size) : "—"}</div><div class="note">${s ? `distinct terms · ${num(s.total_tokens)} tokens` : "Initialise the index to measure"}</div></div>
        <div><div class="eyebrow">Accounts</div><div class="figure">${num(d.users.total)}</div><div class="note">${num(d.users.by_role.admin)} admin · ${num(d.users.by_status.suspended)} suspended · ${num(d.users.by_status.unverified)} unverified</div></div>
      </div>
      <div class="vx-split">
        <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Document index</h2>${indexStateBadge(d.index.state)}</div>
          <div class="vx-panel-body"><dl class="vx-ledger">
            <div><dt>State</dt><dd>${{ current: "Built from the current corpus", stale: "Corpus changed since the last build", not_initialized: "Not built yet" }[d.index.state]}</dd></div>
            <div><dt>Indexed documents</dt><dd class="tabular">${s ? num(s.documents) : "—"} of ${num(d.index.corpus_documents)}</dd></div>
            <div><dt>Postings</dt><dd class="tabular">${s ? num(s.postings) : "—"}</dd></div>
            <div><dt>Last built</dt><dd>${s ? `${datetime(s.built_at)} · ${s.build_ms} ms` : "—"}</dd></div>
            <div><dt>Ranked search</dt><dd><span class="vx-stamp">Not available</span> Results aren't ranked by relevance yet</dd></div>
          </dl><a class="vx-btn mt-3" href="/admin/index">${icon("index", "sm")} Manage index</a></div></section>
        <section class="vx-panel"><div class="vx-panel-head"><h2 class="section-title">Corpus health</h2></div>
          <div class="vx-panel-body vx-stack">
            ${d.corpus.skipped.length ? html`<ul class="vx-list mx-0">${d.corpus.skipped.slice(0, 6).map((f) => html`<li class="px-0"><div class="grow"><div class="mono">${f.filename}</div><div class="sub">${f.reason.replace("_", " ")}${f.detail ? ` · ${f.detail}` : ""}</div></div></li>`)}</ul>`
              : html`<div class="vx-notice ok">${icon("check")}<div>No skipped files. ${d.corpus.warnings.length ? plural(d.corpus.warnings.length, "file") + " decoded with warnings." : "No encoding warnings."}</div></div>`}
            <p class="meta">Loaded ${datetime(d.corpus.loaded_at)} from the corpus folder. ${plural(d.corpus.categories.length, "subject")} in metadata.</p>
          </div></section>
      </div>
      <section aria-labelledby="sc-h"><h2 class="eyebrow mb-3" id="sc-h">Workspaces</h2><div class="vx-shortcuts">
        ${[["/admin/documents", "folder", "Global documents", "Upload, preview and remove shared .txt files."],
           ["/admin/index", "index", "Index management", "Inspect vocabulary and postings; rebuild."],
           ["/admin/users", "users", "Users", "Find accounts, suspend or reactivate members."],
           ["/admin/analytics", "chart", "Search analytics", "Aggregate search analysis. Not available yet."],
           ["/admin/quality", "target", "Search quality", "Retrieval evaluation. No evaluation data yet."],
           ["/admin/system", "monitor", "System", "Process, storage and email status."],
           ...(owner ? [["/owner/admins", "key", "Admin management", "Invite and remove Admins."]] : [])]
          .map(([href, ic, t, dsc]) => html`<a class="vx-shortcut" href="${href}">${icon(ic)}<div><div class="t">${t}</div><div class="d">${dsc}</div></div></a>`)}
      </div></section>
    </div>`);
  };
  await load();
}
