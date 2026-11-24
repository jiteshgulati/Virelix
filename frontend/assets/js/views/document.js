import { html, mount, $, highlight, setTitle } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, del } from "../core/api.js";
import { date, datetime, bytes, num, relative } from "../core/format.js";
import { toggleSave, setSaved, collectionPicker, copyLink } from "../components/workspace.js";
import { confirmDialog, toast, toastError } from "../components/feedback.js";
import { empty, errorBlock } from "../components/states.js";
import { tokenizeQuery } from "../core/text.js";

export default async function documentView(root, ctx) {
  const isAttachment = ctx.route.kind === "attachment";
  const id = ctx.params.id;
  const from = ctx.query.get("from");
  const backHref = from && from.startsWith("/") && !from.startsWith("//") ? from : isAttachment ? "/files" : "/search";
  const backLabel = from?.startsWith("/search") ? "Back to results" : from?.startsWith("/saved") ? "Back to Saved Results"
    : from?.startsWith("/collections") ? "Back to collection" : isAttachment ? "Back to your files" : "Back to search";
  const terms = tokenizeQuery(ctx.query.get("terms") || "");

  mount(root, html`<a class="vx-doc-back" href="${backHref}">${icon("arrowLeft", "sm")} ${backLabel}</a>
    <div data-doc aria-busy="true"><div class="vx-skeleton vx-skel-line w-25"></div><div class="vx-skeleton mt-3 vx-skel-title"></div>
    <div class="mt-5">${Array.from({ length: 8 }, () => html`<div class="vx-skeleton vx-skel-line"></div>`)}</div></div>`);
  const slot = $("[data-doc]", root);

  let doc;
  try {
    doc = await get(isAttachment ? `/api/attachments/${encodeURIComponent(id)}` : `/api/documents/${encodeURIComponent(id)}`);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    slot.removeAttribute("aria-busy");
    if (err.status === 404) {
      mount(slot, empty({ glyph: "¶", title: isAttachment ? "Attachment not found" : "Document not found",
        body: isAttachment ? "It may have expired (attachments last 24 hours) or been removed." : "This document isn't in the shared corpus. An administrator may have removed it.",
        actions: html`<a class="vx-btn" href="${backHref}">${backLabel}</a>` }));
    } else if (err.status === 403) {
      mount(slot, empty({ glyph: "⊘", title: "You can't open this", body: err.message }));
    } else {
      mount(slot, errorBlock(err));
      $("[data-retry]", slot)?.addEventListener("click", () => documentView(root, ctx));
    }
    return;
  }
  if (!ctx.isCurrent()) return;
  setTitle(doc.title);
  const meta = doc.metadata || {};
  const paragraphs = doc.text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const words = isAttachment ? doc.words : doc.word_count;

  slot.removeAttribute("aria-busy");
  mount(slot, html`<div class="vx-doc">
    <article aria-labelledby="doc-title">
      <div class="eyebrow">${isAttachment ? html`${icon("lock", "sm")} Private attachment` : meta.category || "Shared corpus"}</div>
      <h1 id="doc-title" class="mt-2">${doc.title}</h1>
      <div class="byline">${meta.author ? html`<span>${meta.author}</span><span aria-hidden="true">·</span>` : ""}
        ${meta.date ? html`<span>${date(meta.date)}</span><span aria-hidden="true">·</span>` : ""}
        <span class="tabular">${num(words)} words</span>
        ${terms.length ? html`<span aria-hidden="true">·</span><span>Highlighting ${terms.map((t) => html`<span class="vx-term">${t}</span> `)}</span>` : ""}</div>
      <div class="vx-doc-actions">
        ${isAttachment ? html`<button type="button" class="vx-btn danger" data-remove>${icon("trash", "sm")} Remove attachment</button>`
          : html`<button type="button" class="vx-btn" data-save aria-pressed="${doc.saved}">${icon("bookmark", "sm")}<span data-label>${doc.saved ? "Saved" : "Save"}</span></button>
          <button type="button" class="vx-btn" data-collect>${icon("stack", "sm")} Add to collection${doc.collections.length ? html` <span class="vx-badge">${doc.collections.length}</span>` : ""}</button>`}
        <button type="button" class="vx-btn quiet" data-copy>${icon("link", "sm")} Copy link</button>
        <button type="button" class="vx-btn quiet" data-print>${icon("file", "sm")} Print</button>
      </div>
      ${doc.warnings?.length ? html`<div class="vx-notice warn mt-4">${icon("alert")}<div>${doc.warnings.join(" ")}</div></div>` : ""}
      <div class="vx-prose" data-prose>${paragraphs.map((p) => html`<p>${highlight(p, terms)}</p>`)}</div>
    </article>
    <aside class="vx-doc-aside" aria-label="Document details">
      <section class="vx-panel vx-panel-pad"><h2 class="eyebrow mb-2">Details</h2>
        <dl class="vx-ledger">
          <div><dt>File</dt><dd class="mono">${doc.filename}</dd></div>
          ${isAttachment ? html`<div><dt>Uploaded</dt><dd>${datetime(doc.uploaded_at)}</dd></div><div><dt>Expires</dt><dd>${relative(doc.expires_at)}</dd></div>`
            : html`<div><dt>Document ID</dt><dd class="mono">${doc.doc_id}</dd></div>`}
          <div><dt>Size</dt><dd>${bytes(doc.size_bytes)}</dd></div>
          <div><dt>Encoding</dt><dd class="mono">${doc.encoding}</dd></div>
          ${!isAttachment ? html`<div><dt>Modified</dt><dd>${datetime(doc.modified)}</dd></div>` : ""}
        </dl></section>
      ${meta.tags?.length ? html`<section class="vx-panel vx-panel-pad"><h2 class="eyebrow mb-3">Tags</h2><div class="vx-chips">${meta.tags.map((t) => html`<span class="vx-badge">${t}</span>`)}</div></section>` : ""}
      ${isAttachment ? html`<div class="vx-notice">${icon("lock")}<div>Only you can see this file. It isn't part of the shared corpus and is deleted automatically after 24 hours.</div></div>` : ""}
    </aside></div>`);

  if (terms.length) $("mark.vx-mark", slot)?.scrollIntoView({ block: "center", behavior: "instant" });

  slot.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.matches("[data-save]")) {
      const now = await toggleSave(t, doc.doc_id, ctx.query.get("terms") || "");
      setSaved(t, now);
    } else if (t.matches("[data-collect]")) {
      await collectionPicker(doc.doc_id, doc.title);
    } else if (t.matches("[data-copy]")) {
      copyLink(isAttachment ? `/attachments/${doc.id}` : `/documents/${doc.doc_id}`);
    } else if (t.matches("[data-print]")) {
      window.print();
    } else if (t.matches("[data-remove]")) {
      if (!(await confirmDialog({ title: "Remove attachment?", message: `“${doc.filename}” will be deleted from your private files.`, confirmLabel: "Remove" }))) return;
      try { await del(`/api/attachments/${encodeURIComponent(doc.id)}`); toast("Attachment removed.", { tone: "info" }); ctx.navigate("/files"); }
      catch (err) { toastError(err); }
    }
  });
}
