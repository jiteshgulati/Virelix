import { html, mount, $, on } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, del, upload, qs } from "../core/api.js";
import { bytes, relative, num, plural } from "../core/format.js";
import { confirmDialog, toast, toastError } from "../components/feedback.js";
import { searchbar, bindSearchbar } from "../components/searchbar.js";
import { empty, errorBlock, loadingList, pageHead } from "../components/states.js";

export default async function files(root, ctx) {
  mount(root, html`${pageHead({ eyebrow: "Search your files", title: "Your files", lede: "Attach plain-text files to explore them privately. They're searchable only by you and never join the shared corpus.",
    actions: html`<button type="button" class="vx-btn danger" data-clear disabled>${icon("trash", "sm")} Clear attachments</button>` })}
    <div class="vx-split">
      <div class="vx-stack-lg">
        <div><div class="eyebrow mb-2">Search only your files</div>${searchbar({ id: "files-q", label: "Search your attachments" })}</div>
        <section aria-labelledby="att-h"><h2 class="section-title mb-3" id="att-h">Attached files</h2><div data-list>${loadingList(2)}</div></section>
      </div>
      <aside class="vx-stack">
        <label class="vx-dropzone" data-drop>
          ${icon("upload", "lg")}<strong>Choose .txt files</strong><span class="meta">or drop them here</span>
          <input type="file" accept=".txt,text/plain" multiple class="visually-hidden" data-input>
        </label>
        <div class="vx-panel vx-panel-pad"><dl class="vx-ledger" data-limits></dl></div>
        <div class="vx-notice">${icon("lock")}<div>Attachments are temporary. Each is deleted automatically 24 hours after upload, and you can't save or collect them.</div></div>
      </aside>
    </div>`);
  const list = $("[data-list]", root);
  const clearBtn = $("[data-clear]", root);
  const drop = $("[data-drop]", root);
  let limits = null;
  let items = [];

  bindSearchbar(root, { onSubmit: (q) => ctx.navigate(`/search${qs({ q, sources: "attachments", mode: "any" })}`) });

  const render = () => {
    clearBtn.disabled = !items.length;
    if (limits) {
      mount($("[data-limits]", root), html`<div><dt>File type</dt><dd>${limits.types.join(", ")} only</dd></div>
        <div><dt>Size limit</dt><dd>${bytes(limits.max_bytes)} per file</dd></div>
        <div><dt>Attached</dt><dd class="tabular">${num(items.length)} of ${num(limits.max_files)}</dd></div>
        <div><dt>Kept for</dt><dd>${limits.ttl_hours} hours</dd></div>`);
    }
    mount(list, items.length ? html`<div class="vx-panel"><ul class="vx-list">${items.map((a) => html`<li>
        <div class="lead-ico">${icon("file", "sm")}</div>
        <div class="grow"><a class="title" href="/attachments/${a.id}${qs({ from: "/files" })}">${a.title}</a>
          <div class="sub"><span class="mono">${a.filename}</span><span aria-hidden="true">·</span><span class="tabular">${bytes(a.size_bytes)} · ${plural(a.words, "word")}</span>
            <span aria-hidden="true">·</span><span>expires ${relative(a.expires_at)}</span>
            ${a.warnings?.length ? html`<span class="vx-badge warn" title="${a.warnings.join(" ")}">Encoding note</span>` : ""}</div></div>
        <div class="acts"><a class="vx-btn sm" href="/attachments/${a.id}${qs({ from: "/files" })}">${icon("eye", "sm")}<span class="hide-xs">View</span></a>
          <button type="button" class="vx-btn icon sm quiet" data-remove="${a.id}" data-name="${a.filename}" aria-label="Remove ${a.filename}">${icon("trash", "sm")}</button></div></li>`)}</ul></div>`
      : empty({ glyph: "⎘", title: "No files attached", body: "Attach a .txt file to search it alongside the shared corpus. PDF, Word and image parsing aren't supported." }));
  };

  const load = async () => {
    try { const d = await get("/api/attachments"); items = d.items; limits = d.limits; render(); }
    catch (err) { mount(list, errorBlock(err)); $("[data-retry]", list)?.addEventListener("click", load); }
  };

  const handleFiles = async (fileList) => {
    const chosen = Array.from(fileList || []);
    for (const file of chosen) {
      if (!/\.txt$/i.test(file.name)) { toast(html`<strong>${file.name}</strong> isn't a .txt file. Only plain text is supported.`, { tone: "danger" }); continue; }
      if (limits && file.size > limits.max_bytes) { toast(html`<strong>${file.name}</strong> is larger than ${bytes(limits.max_bytes)}.`, { tone: "danger" }); continue; }
      try { await upload("/api/attachments", file); toast(html`Attached <strong>${file.name}</strong>.`); }
      catch (err) { toastError(err); }
    }
    await load();
  };

  $("[data-input]", root).addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("drag")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

  const off = on(list, "click", "[data-remove]", async (e, btn) => {
    if (!(await confirmDialog({ title: "Remove attachment?", message: `“${btn.dataset.name}” will be deleted from your private files.`, confirmLabel: "Remove" }))) return;
    try { await del(`/api/attachments/${btn.dataset.remove}`); toast("Attachment removed.", { tone: "info" }); load(); } catch (err) { toastError(err); }
  });
  clearBtn.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Clear all attachments?", message: `${plural(items.length, "file")} will be deleted from your private files.`, confirmLabel: "Clear attachments" }))) return;
    try { const r = await del("/api/attachments"); toast(`Removed ${plural(r.removed, "file")}.`, { tone: "info" }); load(); } catch (err) { toastError(err); }
  });
  await load();
  return off;
}
