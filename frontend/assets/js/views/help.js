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
      <p>Your query is split into words using the same rules applied to documents: lowercasing, removing punctuation and normalising whitespace. Virelix then looks those words up in its index, which records every document each word appears in and how often.</p>
      <p>Results are <strong>ranked by term frequency</strong>. A document's <strong>score</strong> is the total number of times your words occur in its title and text. For example, a document that mentions “python” three times and “programming” twice scores 5 for <span class="mono">python programming</span>. Typing a word twice doesn't count it twice. Documents with equal scores are listed by title.</p>
      <p>A score is a count, not a percentage or a measure of confidence. Each result shows its score and the count for every word, for example <span class="mono">python ×3</span>, and the passage where your words appear, highlighted. When the words only occur in the title, the document's opening is shown instead.</p>
      <dl class="vx-ledger"><div><dt>Any term</dt><dd>At least one query word must appear. This is the default for new accounts; you can change it under Settings.</dd></div>
        <div><dt>All terms</dt><dd>Every query word must appear somewhere in the document.</dd></div>
        <div><dt>Exact phrase</dt><dd>The words must appear next to each other, in order.</dd></div></dl>
      <p>Sorting by title or date reorders the complete result set, not just the current page. Filters by source and subject apply before ranking.</p>`)}
    ${section("overview", "The AI Overview tab", html`<p>Nothing on this tab is generated. It's an <strong>extractive preview</strong>: up to three whole sentences quoted verbatim from the highest-ranked matching documents, each numbered against its source. You can save it to Saved Results.</p>`)}
    ${section("categories", "Search categories", html`<p>After you search, tabs appear for All, AI Overview, Web, Academic, Code, Images, Videos and Books. Only <strong>All</strong> and <strong>AI Overview</strong> are connected to a source. The other tabs say plainly that no source is connected instead of showing results.</p>`)}
    ${section("files", "Private attachments", html`<p>Attach <span class="mono">.txt</span> files from the home page or <a href="/files">Your files</a>. Only you can see them. They're included in your searches when “My attachments” is selected, deleted automatically after 24 hours, and never added to the shared corpus. PDF, Word and image files aren't supported.</p>`)}
    ${section("workspace", "History, saved results and collections", html`<p><a href="/history">Search history</a> records each search you submit; you can turn it off under <a href="/settings/privacy">Privacy &amp; security</a>. <a href="/saved">Saved results</a> keeps documents and previews. <a href="/collections">Collections</a> group documents into named lists. All three are private to your account, including from administrators.</p>`)}
    ${section("roles", "Account roles", html`<dl class="vx-ledger">
        <div><dt>Member</dt><dd>Search, save, collect and attach private files. Every new account starts here.</dd></div>
        <div><dt>Admin</dt><dd>Everything a member can do, plus managing the shared corpus, the document index and member accounts. Granted only by invitation from the Owner.</dd></div>
        <div><dt>Owner</dt><dd>One account per installation, set by the server administrator. Invites and removes Admins.</dd></div></dl>
      <p class="meta">You're signed in as ${role === "admin" || role === "owner" ? "an" : "a"} <strong>${roleLabel(role)}</strong>.</p>`)}
    ${section("unavailable", "Not available yet", html`<p>AI Answers, Research Mode, voice search and web or academic sources aren't available. Where they appear in the interface, they're labelled as unavailable and never show invented results.</p>`)}
    ${section("keys", "Keyboard", html`<dl class="vx-ledger"><div><dt><kbd>/</kbd></dt><dd>Focus the search field</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>Clear the search field, or close the filter panel, menus and dialogs</dd></div>
      <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Move between search category tabs</dd></div></dl>`)}
  </div>`);
}
