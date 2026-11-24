import { html, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { pageHead } from "../../components/states.js";

const METRICS = [
  ["Precision@5", "Of the top five results, the fraction that are relevant."],
  ["Recall@5", "Of all relevant documents, the fraction found in the top five."],
  ["MRR", "Mean reciprocal rank of the first relevant result across queries."],
];

export default function quality(root) {
  root.classList.add("wide");
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "Search quality", lede: "Measures how well search finds relevant documents." })}
    <div class="vx-notice warn mb-5">${icon("info")}<div><strong>No evaluation data yet.</strong> Search results are ranked, but measuring their quality also needs a set of test queries with relevance judgments. Those don't exist yet, so these metrics show “—” rather than estimates.</div></div>
    <div class="vx-figures mb-5">${METRICS.map(([m, d]) => html`<div><div class="eyebrow">${m}</div><div class="figure" aria-label="${m} not computed">—</div><div class="note">${d}</div></div>`)}
      <div><div class="eyebrow">Judged queries</div><div class="figure">0</div><div class="note">Relevance judgments recorded</div></div></div>
    <div class="vx-grid-2">
      <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-3">What evaluation requires</h2>
        <ul class="vx-list">${[["Ranked search results", true], ["A set of test queries", false], ["Relevance judgments for each query", false], ["An evaluation run over those queries", false]]
          .map(([t, ok]) => html`<li class="px-0"><div class="lead-ico">${icon(ok ? "check" : "clock", "sm")}</div><div class="grow"><div class="title">${t}</div></div>${ok ? html`<span class="vx-badge ok">Available</span>` : html`<span class="vx-stamp">Not available</span>`}</li>`)}</ul></section>
      <section class="vx-panel vx-panel-pad"><h2 class="section-title mb-3">Judgment file format</h2>
        <p class="meta mb-3">Relevance judgments map each test query to the document IDs judged relevant:</p>
        <pre class="vx-pre">{
  "queries": [
    { "id": "q01", "text": "inverted index postings",
      "relevant": ["doc-…", "doc-…"] }
  ]
}</pre>
        <p class="meta mt-3">Document IDs are stable across reloads. Find them in Index management.</p></section>
    </div>`);
}
