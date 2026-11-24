import { html, mount, $ } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { get } from "../../core/api.js";
import { num, bytes, datetime, duration } from "../../core/format.js";
import { errorBlock, loading, pageHead } from "../../components/states.js";
import { setBusy } from "../../components/feedback.js";

const ok = (v, yes = "OK", no = "Problem") => v ? html`<span class="vx-badge ok"><span class="pip"></span>${yes}</span>` : html`<span class="vx-badge danger"><span class="pip"></span>${no}</span>`;

export default async function system(root, ctx) {
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "System", lede: "Measured from this server process when you load or refresh the page. Uptime, throughput and latency history aren't tracked, so they aren't shown.",
    actions: html`<button type="button" class="vx-btn" data-refresh>${icon("refresh", "sm")} Refresh</button>` })}<div data-body>${loading(6)}</div>`);
  const body = $("[data-body]", root);
  const load = async () => {
    try {
      const s = await get("/api/admin/system");
      if (!ctx.isCurrent()) return;
      mount(body, html`<div class="vx-grid-2">
        <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Process</h2><dl class="vx-ledger">
          <div><dt>Health</dt><dd>${ok(true, "Responding")}</dd></div>
          <div><dt>Running for</dt><dd class="tabular">${duration(s.process.running_seconds)} <span class="meta">since ${datetime(s.process.started_at)}</span></dd></div>
          <div><dt>Environment</dt><dd class="mono">${s.process.environment}</dd></div>
          <div><dt>Version</dt><dd class="mono">${s.process.version}</dd></div>
          <div><dt>Python</dt><dd class="mono">${s.process.python}</dd></div>
          <div><dt>Platform</dt><dd class="mono">${s.process.platform}</dd></div>
          <div><dt>Process ID</dt><dd class="mono">${s.process.pid}</dd></div></dl></section>
        <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Storage</h2><dl class="vx-ledger">
          <div><dt>Data folder</dt><dd>${ok(s.storage.data_dir_writable, "Writable", "Not writable")}</dd></div>
          <div><dt>Corpus folder</dt><dd>${ok(s.storage.corpus_dir_exists, "Present", "Missing")}</dd></div>
          <div><dt>User store read</dt><dd class="tabular">${s.storage.user_store_read_ms} ms <span class="meta">(this request)</span></dd></div>
          <div><dt>Index file</dt><dd class="tabular">${s.storage.index_file_bytes === null ? "Not built" : bytes(s.storage.index_file_bytes)}</dd></div></dl></section>
        <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Corpus &amp; index</h2><dl class="vx-ledger">
          <div><dt>Documents loaded</dt><dd class="tabular">${num(s.corpus.loaded)} of ${num(s.corpus.discovered)}</dd></div>
          <div><dt>Skipped</dt><dd class="tabular">${num(s.corpus.skipped)}</dd></div>
          <div><dt>Corpus size</dt><dd class="tabular">${bytes(s.corpus.total_bytes)}</dd></div>
          <div><dt>Index</dt><dd>${{ current: "Current", stale: "Out of date", unavailable: "Unavailable" }[s.index.state]}</dd></div></dl></section>
        <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-2">Sessions &amp; email</h2><dl class="vx-ledger">
          <div><dt>Active sessions</dt><dd class="tabular">${num(s.sessions_active)}</dd></div>
          <div><dt>Email provider</dt><dd>${s.email.provider ? html`<span class="mono">${s.email.provider}</span> <span class="vx-badge warn">Not delivered</span>` : html`<span class="vx-badge danger">None configured</span>`}</dd></div></dl></section>
      </div><p class="meta mt-3">Checked ${datetime(s.checked_at)}.</p>`);
    } catch (err) { mount(body, errorBlock(err)); $("[data-retry]", body)?.addEventListener("click", load); }
  };
  $("[data-refresh]", root).addEventListener("click", async (e) => { const b = e.currentTarget; setBusy(b, true); await load(); setBusy(b, false); });
  await load();
}
