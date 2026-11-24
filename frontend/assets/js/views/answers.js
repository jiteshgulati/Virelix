import { html, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { unavailable, pageHead } from "../components/states.js";

export default function answers(root) {
  root.classList.add("narrow");
  mount(root, html`${pageHead({ eyebrow: "Entry point", title: "AI Answers" })}
    ${unavailable({ iconName: "sparkle", stamp: "Not available", title: "Generated answers aren't available yet",
      body: "AI Answers will write cited answers to your questions using the documents in Virelix. No language model is connected in this build, and Virelix won't simulate one.",
      points: ["Answers will cite the exact passages they're based on.",
        "Until then, the AI Overview tab quotes matching sentences verbatim, with references."],
      actions: html`<a class="vx-btn primary" href="/search?tab=overview">${icon("quote", "sm")} Try the extractive preview</a><a class="vx-btn" href="/search">${icon("search", "sm")} Search documents</a>` })}
    <section class="vx-panel vx-panel-pad mt-5" aria-labelledby="now-h">
      <h2 class="section-title" id="now-h">What works today</h2>
      <p class="meta mt-2">Open the <strong>AI Overview</strong> tab on any search. It quotes up to three sentences, verbatim, from documents that contain your terms, and lists each source. There's no rewriting, paraphrasing or invented citation, so you can save it as an answer with confidence.</p>
    </section>`);
}
