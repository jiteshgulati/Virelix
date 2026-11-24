import { html, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { unavailable, pageHead } from "../components/states.js";

export default function research(root) {
  root.classList.add("narrow");
  mount(root, html`${pageHead({ eyebrow: "Entry point", title: "Research Mode" })}
    ${unavailable({ iconName: "compass", stamp: "Not available", title: "Research Mode isn't available yet",
      body: "Research Mode will run multi-step investigations: planning sub-questions, searching several sources and assembling a cited brief. It depends on AI and external research integrations, and none of those exist in this build.",
      points: ["Needs generative AI, hybrid retrieval and external research sources.", "Until then, use Collections and Saved Results to organise what you find."],
      actions: html`<a class="vx-btn primary" href="/collections">${icon("stack", "sm")} Organise sources in Collections</a><a class="vx-btn" href="/saved">${icon("bookmark", "sm")} Saved Results</a>` })}
    <section class="vx-panel vx-panel-pad mt-5"><h2 class="section-title">Do research by hand today</h2>
      <ol class="meta mt-2 mb-0 ps-3 vx-stack">
        <li>Search with <strong>Any term</strong> to cast a wide net, then switch to <strong>All terms</strong> or <strong>Exact phrase</strong> to narrow down.</li>
        <li>Save useful documents, and save extractive previews from the AI Overview tab.</li>
        <li>Group what you find into a collection for each question.</li>
      </ol></section>`);
}
