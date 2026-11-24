import { html, mount } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { pageHead } from "../../components/states.js";

const PANELS = [
  { title: "Top searched terms", icon: "chart", needs: "Aggregate counts of normalised query terms across all accounts." },
  { title: "Search volume over time", icon: "activity", needs: "Timestamped search events grouped by day." },
  { title: "Document frequency", icon: "index", needs: "How many documents contain each term, charted across the vocabulary." },
  { title: "Rank–frequency distribution", icon: "chart", needs: "Term frequencies sorted by rank, on log–log axes." },
  { title: "Searches with no results", icon: "search", needs: "Queries that matched nothing, to reveal gaps in the corpus." },
  { title: "Subject distribution", icon: "layers", needs: "The share of searches filtered by each subject." },
];

export default function analytics(root) {
  root.classList.add("wide");
  mount(root, html`${pageHead({ eyebrow: "Administration", title: "Search analytics", lede: "Aggregate analysis of how the shared corpus is searched." })}
    <div class="vx-notice warn mb-5">${icon("info")}<div><strong>No analytics data yet.</strong> Search analytics isn't available yet, and no aggregate search data is collected. Members' personal search history is private and is never used here, so these panels stay empty rather than showing estimates.</div></div>
    <div class="vx-grid-3">${PANELS.map((p) => html`<section class="vx-panel" aria-label="${p.title}">
      <div class="vx-panel-head"><h2 class="section-title">${p.title}</h2><span class="vx-stamp">No data</span></div>
      <div class="vx-panel-body vx-stack"><div class="vx-empty center py-4"><div class="glyph" aria-hidden="true">${icon(p.icon, "lg")}</div><p>No data collected</p></div>
        <p class="meta"><strong>Requires:</strong> ${p.needs}</p></div></section>`)}</div>`);
}
