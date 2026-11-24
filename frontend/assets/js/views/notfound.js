import { html, mount } from "../core/dom.js";
import { session } from "../core/store.js";
import { empty } from "../components/states.js";
import { authLayout } from "../components/auth-layout.js";

export default function notfound(root) {
  const block = html`<h1 class="visually-hidden">Page not found</h1>${empty({ glyph: "404", title: "There's no page here",
    body: "The address may be mistyped, or the page may have moved.",
    actions: html`<a class="vx-btn primary" href="/">Go home</a>${session.user ? html`<a class="vx-btn" href="/search">Search</a>` : ""}` })}`;
  if (session.user) mount(root, block); else authLayout(root, block);
}
