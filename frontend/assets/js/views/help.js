import { html, mount } from "../core/dom.js";
import { session } from "../core/store.js";
import { roleLabel } from "../core/format.js";
import { pageHead } from "../components/states.js";

export default function help(root) {
  root.classList.add("narrow");
  const role = session.user.role;
  const section = (id, title, body) => html`<section class="vx-panel vx-panel-pad" id="${id}" aria-labelledby="${id}-h">
    <h2 class="section-title" id="${id}-h">${title}</h2><div class="vx-stack mt-3">${body}</div></section>`;
  mount(root, html`${pageHead({ eyebrow: "Help", title: "Using Virelix", lede: "How search works, what each area does, and what isn't available yet." })}
  <div class="vx-stack-lg">
    ${section("search", "How search works", html`
      <p>Search is a <strong>document search preview</strong>. Your query is split into words using the same rules applied to documents (lowercasing, removing punctuation, normalising whitespace), and every document is checked for those words.</p>
      <p>Results are <strong>not ranked by relevance</strong>. By default they're ordered by how many of your query words each document contains, then by title. Every result shows which words matched and which didn't, and opens with the document's first lines.</p>
      <dl class="vx-ledger"><div><dt>All terms</dt><dd>Every query word must appear somewhere in the document.</dd></div>
        <div><dt>Any term</dt><dd>At least one query word must appear.</dd></div>
        <div><dt>Exact phrase</dt><dd>The words must appear next to each other, in order.</dd></div></dl>`)}
    ${section("overview", "The AI Overview tab", html`<p>Nothing on this tab is generated. It's an <strong>extractive preview</strong>: up to three whole sentences quoted verbatim from matching documents, each numbered against its source. You can save it to Saved Results.</p>`)}
    ${section("categories", "Search categories", html`<p>After you search, tabs appear for All, AI Overview, Web, Academic, Code, Images, Videos and Books. Only <strong>All</strong> and <strong>AI Overview</strong> are connected to a source. The other tabs say plainly that no source is connected instead of showing results.</p>`)}
    ${section("files", "Private attachments", html`<p>Attach <span class="mono">.txt</span> files from the home page or <a href="/files">Your files</a>. Only you can see them. They're included in your searches when “My attachments” is selected, deleted automatically after 24 hours, and never added to the shared corpus. PDF, Word and image files aren't supported.</p>`)}
    ${section("workspace", "History, saved results and collections", html`<p><a href="/history">Search history</a> records each search you submit; you can turn it off under <a href="/settings/privacy">Privacy &amp; security</a>. <a href="/saved">Saved results</a> keeps documents and previews. <a href="/collections">Collections</a> group documents into named lists. All three are private to your account, including from administrators.</p>`)}
    ${section("roles", "Account roles", html`<dl class="vx-ledger">
        <div><dt>Member</dt><dd>Search, save, collect and attach private files. Every new account starts here.</dd></div>
        <div><dt>Admin</dt><dd>Everything a member can do, plus managing the shared corpus, the document index and member accounts. Granted only by invitation from the Owner.</dd></div>
        <div><dt>Owner</dt><dd>One account per installation, set by the server administrator. Invites and removes Admins.</dd></div></dl>
      <p class="meta">You're signed in as ${role === "admin" || role === "owner" ? "an" : "a"} <strong>${roleLabel(role)}</strong>.</p>`)}
    ${section("unavailable", "Not available yet", html`<p>Ranked search, AI Answers, Research Mode, voice search and web or academic sources aren't available. Where they appear in the interface, they're labelled as unavailable and never show invented results.</p>`)}
    ${section("keys", "Keyboard", html`<dl class="vx-ledger"><div><dt><kbd>/</kbd></dt><dd>Focus the search field</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>Clear the search field, or close the filter panel, menus and dialogs</dd></div>
      <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Move between search category tabs</dd></div></dl>`)}
  </div>`);
}
