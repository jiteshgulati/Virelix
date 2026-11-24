// Shared workspace actions: save toggles, collection picker, copy link.
import { html, mount, $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { get, post, del } from "../core/api.js";
import { openModal, toast, toastError, setBusy } from "./feedback.js";

export async function toggleSave(btn, docId, query = "") {
  const saved = btn.getAttribute("aria-pressed") === "true";
  setBusy(btn, true);
  try {
    if (saved) {
      await del(`/api/saved/by-doc/${encodeURIComponent(docId)}`);
      toast("Removed from Saved Results.", { tone: "info" });
    } else {
      await post("/api/saved", { doc_id: docId, query });
      toast(html`Saved. <a href="/saved">View Saved Results</a>`);
    }
    setBusy(btn, false);
    setSaved(btn, !saved);
    return !saved;
  } catch (err) {
    setBusy(btn, false);
    if (err.code === "already_saved") { setSaved(btn, true); return true; }
    toastError(err);
    return saved;
  }
}

export function setSaved(btn, saved) {
  btn.setAttribute("aria-pressed", String(saved));
  const label = saved ? "Saved" : "Save";
  btn.setAttribute("aria-label", saved ? "Remove from Saved Results" : "Save result");
  const text = btn.querySelector("[data-label]");
  if (text) text.textContent = label;
}

/** Modal listing the user's collections; add/remove the document, or create a new collection. */
export function collectionPicker(docId, title) {
  return openModal({
    title: "Add to collection",
    body: html`<p class="meta mb-3">${title}</p><div data-list><div class="vx-skeleton vx-skel-line"></div><div class="vx-skeleton vx-skel-line"></div></div>
      <form class="vx-row mt-3" data-new novalidate>
        <label class="visually-hidden" for="new-col">New collection name</label>
        <input class="vx-input flex-grow-1" id="new-col" name="name" maxlength="60" placeholder="New collection name" autocomplete="off">
        <button class="vx-btn" type="submit">${icon("plus", "sm")} Create &amp; add</button>
      </form><div class="vx-error mt-2" data-err role="alert"></div>`,
    footer: html`<button type="button" class="vx-btn primary" data-bs-dismiss="modal">Done</button>`,
    onMount: (el) => {
      const list = $("[data-list]", el);
      const err = $("[data-err]", el);
      const load = async () => {
        try {
          const [cols, doc] = await Promise.all([get("/api/collections"), get(`/api/documents/${encodeURIComponent(docId)}`)]);
          const inSet = new Set(doc.collections);
          if (!cols.items.length) {
            mount(list, html`<div class="vx-notice">${icon("stack")}<div>You don't have any collections yet. Name one below to create it with this document inside.</div></div>`);
            return;
          }
          mount(list, html`<ul class="vx-list vx-panel" role="list">${cols.items.map((c) => html`<li>
            <div class="lead-ico">${icon("stack", "sm")}</div>
            <div class="grow"><div class="title">${c.name}</div><div class="sub">${c.item_count} item${c.item_count === 1 ? "" : "s"}</div></div>
            <button type="button" class="vx-btn sm ${inSet.has(c.id) ? "" : "primary"}" data-col="${c.id}" data-in="${inSet.has(c.id)}"
              aria-label="${inSet.has(c.id) ? `Remove from ${c.name}` : `Add to ${c.name}`}">
              ${inSet.has(c.id) ? html`${icon("check", "sm")} Added` : html`${icon("plus", "sm")} Add`}</button></li>`)}</ul>`);
        } catch (e) { mount(list, html`<div class="vx-notice danger">${icon("alert")}<div>${e.message}</div></div>`); }
      };
      list.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-col]");
        if (!btn) return;
        err.textContent = "";
        setBusy(btn, true);
        try {
          if (btn.dataset.in === "true") {
            await del(`/api/collections/${btn.dataset.col}/items/${encodeURIComponent(docId)}`);
            toast("Removed from collection.", { tone: "info" });
          } else {
            await post(`/api/collections/${btn.dataset.col}/items`, { doc_id: docId });
            toast("Added to collection.");
          }
          await load();
        } catch (ex) { setBusy(btn, false); err.textContent = ex.message; }
      });
      $("[data-new]", el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = $("#new-col", el);
        const name = input.value.trim();
        err.textContent = "";
        if (!name) { err.textContent = "Enter a name for the new collection."; input.focus(); return; }
        const btn = e.submitter || $("[data-new] button", el);
        setBusy(btn, true);
        try {
          await post("/api/collections", { name, doc_id: docId });
          input.value = "";
          toast(html`Created “${name}” with this document.`);
          await load();
        } catch (ex) { err.textContent = ex.fields?.name || ex.message; input.setAttribute("aria-invalid", "true"); }
        finally { setBusy(btn, false); }
      });
      load();
    },
  });
}

export async function copyLink(path) {
  const url = new URL(path, location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied.");
  } catch {
    toast(html`Copy this link: <span class="mono">${url}</span>`, { tone: "info", timeout: 9000 });
  }
}

/** Read a File as ArrayBuffer and upload it as a private attachment. */
export async function uploadAttachment(file) {
  const { upload } = await import("../core/api.js");
  return upload("/api/attachments", file);
}

export const LIMIT_NOTE = "Plain-text .txt files only. PDF, Word and images aren't supported yet.";
