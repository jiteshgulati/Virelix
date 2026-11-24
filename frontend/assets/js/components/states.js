// Reusable state blocks: loading, empty, error, unavailable.
import { html } from "../core/dom.js";
import { icon } from "../core/icons.js";

export const loading = (lines = 3) => html`<div class="vx-stack" aria-busy="true" aria-label="Loading">${
  Array.from({ length: lines }, (_, i) => html`<div class="vx-skeleton vx-skel-line ${["w-100", "w-75", "w-50"][i % 3]}"></div>`)}</div>`;

export const loadingList = (rows = 4) => html`<div class="vx-panel" aria-busy="true"><span class="visually-hidden">Loading…</span>${
  Array.from({ length: rows }, () => html`<div class="d-flex gap-3 align-items-center p-3 border-bottom vx-skel-row">
    <div class="vx-skeleton vx-skel-sq" aria-hidden="true"></div><div class="flex-grow-1"><div class="vx-skeleton vx-skel-line w-50"></div><div class="vx-skeleton vx-skel-line w-25"></div></div></div>`)}</div>`;

export function empty({ glyph = "§", title, body, actions = "" , center = false }) {
  return html`<div class="vx-empty ${center ? "center" : ""}"><div class="glyph" aria-hidden="true">${glyph}</div>
    <h3>${title}</h3>${body ? html`<p>${body}</p>` : ""}${actions ? html`<div class="vx-row mt-2">${actions}</div>` : ""}</div>`;
}

export function errorBlock(err, retry = true) {
  const unauthorized = err?.status === 403;
  return html`<div class="vx-notice danger" role="alert">${icon(unauthorized ? "lock" : "alert")}
    <div><strong>${unauthorized ? "Not authorised." : "Couldn't load this."}</strong> ${err?.message || "Unexpected error."}
    ${retry ? html` <button type="button" class="vx-btn sm quiet ms-1" data-retry>Try again</button>` : ""}</div></div>`;
}

export function unavailable({ iconName = "info", title, body, points = [], stamp = "Not available", actions = "" }) {
  return html`<section class="vx-unavailable" aria-label="${title}">
    <div class="glyph">${icon(iconName, "lg")}</div>
    <div><div class="mb-2"><span class="vx-stamp">${stamp}</span></div><h3>${title}</h3><p>${body}</p>
      ${points.length ? html`<ul>${points.map((p) => html`<li>${p}</li>`)}</ul>` : ""}
      ${actions ? html`<div class="vx-row mt-4">${actions}</div>` : ""}</div></section>`;
}

export function pageHead({ eyebrow = "", title, lede = "", actions = "" }) {
  return html`<header class="vx-page-head"><div class="titles">
    ${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : ""}<h1 class="page-title">${title}</h1>
    ${lede ? html`<p class="lede">${lede}</p>` : ""}</div>${actions ? html`<div class="actions">${actions}</div>` : ""}</header>`;
}
