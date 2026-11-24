import { html, mount } from "../core/dom.js";
import { session } from "../core/store.js";
import { roleLabel } from "../core/format.js";
import { empty } from "../components/states.js";

export default function forbidden(root, ctx) {
  const needed = ctx.route.role === "owner" ? "the platform Owner" : "Admins and the Owner";
  mount(root, html`<h1 class="visually-hidden">Not authorised</h1>${empty({ glyph: "⊘", title: "This area is restricted",
    body: `${ctx.route.title || "This page"} is available to ${needed}. You're signed in as a ${roleLabel(session.user.role)}. Access is checked by the server on every request.`,
    actions: html`<a class="vx-btn primary" href="/">Go home</a>` })}`);
}
