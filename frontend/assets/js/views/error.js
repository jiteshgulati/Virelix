import { html, mount } from "../core/dom.js";
import { empty } from "../components/states.js";

export default function errorView(root, ctx = {}) {
  mount(root, html`<h1 class="visually-hidden">Something went wrong</h1>${empty({ glyph: "!", title: "This page couldn't load",
    body: ctx.error?.message || "An unexpected error occurred while loading this page.",
    actions: html`<button type="button" class="vx-btn primary" data-reload>Reload</button><a class="vx-btn" href="/">Go home</a>` })}`);
  root.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
}
