const { test, expect } = require("@playwright/test");
const { unique, signInAs } = require("./helpers");

test.describe("Search workspace", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, unique("search"), "Sia Searcher");
  });

  test("home has no category tabs; submitting a query opens results with tabs", async ({ page }) => {
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Voice search \(not available yet\)/ })).toHaveAttribute("aria-disabled", "true");
    const box = page.getByRole("searchbox", { name: "Search Virelix" });
    await box.fill("inverted index");
    await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
    await box.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=inverted\+index/);
    await expect(page.getByRole("tab")).toHaveCount(8);
    await expect(page.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".vx-result").first()).toBeVisible();
    const first = page.locator(".vx-result").first();
    await expect(first.locator(".vx-provenance")).toContainText("matched 2/2");
    await expect(page.locator(".vx-results-meta")).toContainText("documents contain all of");
  });

  test("empty, invalid and no-result queries are handled", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "What are you looking for?" })).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Type something to search for.")).toBeVisible();
    await page.goto("/search?q=%21%21%21");
    await expect(page.getByRole("heading", { name: "That query can't be searched" })).toBeVisible();
    await page.goto("/search?q=zzqxvv%20index");
    await expect(page.getByRole("heading", { name: "No documents match" })).toBeVisible();
    await page.getByRole("button", { name: "Match any term instead" }).click();
    await expect(page.locator(".vx-result").first()).toBeVisible();
    await expect(page.locator(".vx-notice", { hasText: "No document contains" })).toContainText("zzqxvv");
  });

  test("floating filter panel: focus, escape, apply, persistence and reset", async ({ page }) => {
    await page.goto("/search?q=hash%20sorting");
    const results = page.locator(".vx-results-body");
    const before = await results.boundingBox();
    await page.getByRole("button", { name: /^Filter/ }).click();
    const panel = page.getByRole("dialog", { name: "Filters" });
    await expect(panel).toBeVisible();
    expect((await results.boundingBox()).width).toBe(before.width); // overlay, no reflow
    await expect(panel.locator("input:focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: /^Filter/ })).toBeFocused();

    await page.getByRole("button", { name: /^Filter/ }).click();
    await panel.getByLabel("Any term").check();
    await panel.getByRole("checkbox", { name: /Algorithms/ }).check();
    await expect(panel.getByRole("checkbox", { name: /PDF/ })).toBeDisabled();
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/mode=any/);
    await expect(page).toHaveURL(/categories=Algorithms/);
    await expect(page.getByRole("button", { name: "Filter, 2 active" })).toBeVisible();
    const cats = await page.locator(".vx-result .src").allInnerTexts();
    expect(cats.length).toBeGreaterThan(0);
    cats.forEach((t) => expect(t).toContain("Algorithms"));

    // Persists for a new query in the same session.
    const bar = page.getByRole("searchbox", { name: "Search documents" });
    await bar.fill("binary search");
    await bar.press("Enter");
    await expect(page).toHaveURL(/categories=Algorithms/);

    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).not.toHaveURL(/categories=/);
    await page.getByRole("button", { name: /^Filter/ }).click();
    await panel.getByRole("checkbox", { name: /Shared corpus/ }).uncheck();
    await panel.getByRole("checkbox", { name: /My attachments/ }).uncheck();
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await expect(panel.getByText("Choose at least one source.")).toBeVisible();
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.getByRole("checkbox", { name: /Shared corpus/ })).toBeChecked();
    await panel.getByRole("button", { name: "Cancel" }).click();
  });

  test("sorting and pagination work over real results", async ({ page }) => {
    await page.goto("/search?q=the&mode=any&sort=title_desc");
    const titles = await page.locator(".vx-result h3").allInnerTexts();
    const sorted = [...titles].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: "base" }));
    expect(titles).toEqual(sorted);
    await expect(page.getByText(/Showing 1–10 of \d+/)).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(/Showing 11–/)).toBeVisible();
    await expect(page.locator(".vx-result .ord").first()).toHaveText("11");
    await page.getByRole("button", { name: "Title Z–A" }).click();
    await page.getByRole("menuitemradio", { name: "Title A–Z" }).click();
    await expect(page).toHaveURL(/sort=title_asc/);
    await expect(page).not.toHaveURL(/page=2/);
  });

  test("category tabs: extractive overview with references, unavailable sources stated honestly", async ({ page }) => {
    await page.goto("/search?q=password%20hashing");
    await page.getByRole("tab", { name: /AI Overview/ }).click();
    await expect(page.getByRole("heading", { name: "Extractive preview" })).toBeVisible();
    await expect(page.getByText("Not generative AI")).toBeVisible();
    await expect(page.locator(".vx-refs li").first()).toBeVisible();
    await page.getByRole("button", { name: "Save answer" }).click();
    await expect(page.getByText(/Preview saved/)).toBeVisible();
    for (const name of ["Web", "Academic", "Code", "Images", "Videos", "Books"]) {
      await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByText("Not connected")).toBeVisible();
      await expect(page.locator(".vx-result")).toHaveCount(0);
    }
    // Keyboard navigation between tabs.
    await page.getByRole("tab", { name: /^Books/ }).focus();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
  });

  test("save, collect, view document, refine and history", async ({ page }) => {
    await page.goto("/search?q=inverted%20index");
    const first = page.locator(".vx-result").first();
    const title = (await first.locator("h3").innerText()).trim();
    await first.getByRole("button", { name: "Save result" }).click();
    await expect(first.getByRole("button", { name: "Remove from Saved Results" })).toHaveAttribute("aria-pressed", "true");

    await first.getByRole("button", { name: /Collection/ }).click();
    const dialog = page.getByRole("dialog", { name: "Add to collection" });
    await dialog.getByLabel("New collection name").fill("Index reading");
    await dialog.getByRole("button", { name: /Create & add/ }).click();
    await expect(dialog.getByRole("button", { name: "Remove from Index reading" })).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await first.locator("h3 a").click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("mark.vx-mark").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Saved/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "Back to results" }).click();
    await expect(page).toHaveURL(/\/search\?q=inverted/);

    await page.getByLabel("Refine this search with more words").fill("postings");
    await page.getByRole("button", { name: "Refine" }).click();
    await expect(page.getByRole("searchbox", { name: "Search documents" })).toHaveValue("inverted index postings");

    await page.goto("/saved");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await page.goto("/collections");
    await page.getByRole("link", { name: /Index reading/ }).click();
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    await page.goto("/history");
    await expect(page.getByRole("link", { name: "inverted index postings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "inverted index", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete “inverted index postings” from history" }).click();
    await expect(page.getByRole("link", { name: "inverted index postings" })).toHaveCount(0);
    await page.getByRole("link", { name: "Reopen" }).first().click();
    await expect(page).toHaveURL(/\/search\?q=/);
    await page.goto("/history");
    await page.getByRole("button", { name: "Clear history" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Clear history" }).click();
    await expect(page.getByRole("heading", { name: "No searches yet" })).toBeVisible();
  });

  test("missing documents show a clear state", async ({ page }) => {
    await page.goto("/documents/doc-0000000000");
    await expect(page.getByRole("heading", { name: "Document not found" })).toBeVisible();
  });
});
