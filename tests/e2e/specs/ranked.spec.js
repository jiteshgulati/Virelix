const { test, expect } = require("@playwright/test");
const { unique, signInAs } = require("./helpers");

// allInnerTexts() doesn't wait, so wait for the results to render first.
async function scores(page) {
  await expect(page.locator(".vx-result .vx-score b").first()).toBeVisible();
  await expect(page.locator(".vx-results-body")).not.toHaveAttribute("aria-busy", "true");
  return (await page.locator(".vx-result .vx-score b").allInnerTexts()).map(Number);
}

test.describe("Ranked search results", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, unique("ranked"), "Rae Ranker");
  });

  test("scores are shown, explained, ordered and equal to the per-term counts", async ({ page }) => {
    await page.goto("/search?q=inverted%20index");
    await expect(page.locator(".vx-result").first()).toBeVisible();
    await expect(page.locator(".vx-results-meta")).toContainText("documents contain any of");
    await expect(page.getByRole("button", { name: /Relevance/ })).toBeVisible();
    await expect(page.locator(".vx-results-meta")).toContainText(/\d+(\.\d+)? ms/);

    const s = await scores(page);
    expect(s.length).toBeGreaterThan(1);
    expect([...s].sort((a, b) => b - a)).toEqual(s);                       // highest score first

    for (const item of await page.locator(".vx-result").all()) {
      const score = Number(await item.locator(".vx-score b").innerText());
      const parts = (await item.locator(".vx-term:not(.missing) .tf").allInnerTexts()).map((t) => Number(t.replace("×", "")));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(score);               // score = Σ tf
      await expect(item.locator(".vx-score")).not.toContainText("%");     // a count, never a percentage
      await expect(item.locator(".vx-score")).toHaveAttribute("aria-label", new RegExp(`^Score ${score}: `));
    }

    await page.getByRole("button", { name: "How results are ranked" }).click();
    await expect(page.locator(".vx-popover")).toContainText("not a percentage");
  });

  test("snippets highlight the matched words around where they occur", async ({ page }) => {
    await page.goto("/search?q=posting%20lists");
    const first = page.locator(".vx-result").first();
    const snippet = first.locator('[data-snippet="match"]');
    await expect(snippet).toBeVisible();
    const marks = (await snippet.locator("mark").allInnerTexts()).map((t) => t.toLowerCase());
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach((m) => expect(["posting", "lists"]).toContain(m));
    const text = await snippet.innerText();
    expect(text.length).toBeGreaterThan(120);
    expect(text.length).toBeLessThan(260);

    await page.goto("/search?q=search%20engine&mode=phrase");
    await expect(page.locator('.vx-result [data-snippet="match"] mark').first()).toBeVisible();
    const phraseMarks = await page.locator('.vx-result [data-snippet="match"] mark').allInnerTexts();
    expect(phraseMarks.length).toBeGreaterThan(0);
    phraseMarks.forEach((m) => expect(m.toLowerCase().replace(/\s+/g, " ")).toBe("search engine"));
  });

  test("full ranked set is paginated and re-sorted, not just the visible page", async ({ page }) => {
    await page.goto("/search?q=the");
    const page1 = await scores(page);
    await page.getByRole("button", { name: "Page 2" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    const page2 = await scores(page);
    expect(page1.length).toBe(10);
    expect(page2.length).toBeGreaterThan(0);
    expect(Math.max(...page2)).toBeLessThanOrEqual(Math.min(...page1));

    await page.goto("/search?q=the&sort=title_asc");
    await scores(page);
    const titles1 = await page.locator(".vx-result h3").allInnerTexts();
    await page.getByRole("button", { name: "Page 2" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await scores(page);
    const titles2 = await page.locator(".vx-result h3").allInnerTexts();
    expect(titles1.length).toBe(10);
    const all = [...titles1, ...titles2].map((t) => t.toLowerCase());
    expect([...all].sort()).toEqual(all);

    await page.goto("/search?q=the&sort=coverage");                       // links saved before ranking
    await expect(page.getByRole("button", { name: /Relevance/ })).toBeVisible();
  });

  test("attachment text is rendered as text, never as markup", async ({ page }) => {
    await page.goto("/");
    await page.locator("[data-attach-input]").setInputFiles({ name: "markup.txt", mimeType: "text/plain",
      buffer: Buffer.from('<img src=x onerror="window.__vxInjected=1"> <b>bold</b> marmosetine marmosetine notes') });
    await expect(page.locator("[data-attachments]").getByText("markup.txt")).toBeVisible();
    await page.goto("/search?q=marmosetine");
    const result = page.locator(".vx-result").first();
    await expect(result.locator(".vx-score b")).toHaveText("2");
    await expect(result.locator(".excerpt")).toContainText("<img src=x");
    await expect(result.locator(".excerpt img, .excerpt b")).toHaveCount(0);
    await expect(result.locator(".excerpt mark")).toHaveCount(2);
    expect(await page.evaluate(() => window.__vxInjected)).toBeUndefined();
  });
});
