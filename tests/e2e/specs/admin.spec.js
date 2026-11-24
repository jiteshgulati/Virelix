const { test, expect } = require("@playwright/test");
const { signInOwner } = require("./helpers");

test.describe("Administration", () => {
  test.beforeEach(async ({ page }) => { await signInOwner(page); });

  test("overview shows real corpus figures and working shortcuts", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.locator(".vx-figures")).toContainText("Shared documents");
    await expect(page.locator(".vx-figures .figure").first()).toHaveText(/^\d+$/);
    await page.getByRole("link", { name: /Index management Inspect/ }).click();
    await expect(page).toHaveURL(/\/admin\/index/);
  });

  test("global documents: upload, filter, preview, remove", async ({ page }) => {
    await page.goto("/admin/documents");
    await page.locator("[data-upload]").setInputFiles({ name: "zz-e2e-upload.txt", mimeType: "text/plain",
      buffer: Buffer.from("Title: E2E Upload Probe\nCategory: Testing\n---\nThis document mentions xylograph exactly once.") });
    await expect(page.getByText(/Added .*E2E Upload Probe/)).toBeVisible();
    await page.getByLabel("Search documents").fill("E2E Upload");
    const row = page.locator("tbody tr", { hasText: "E2E Upload Probe" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Preview" }).click();
    const dialog = page.getByRole("dialog", { name: "Document preview" });
    await expect(dialog.getByText("xylograph")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).last().click();

    await page.locator("[data-upload]").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# no") });
    await expect(page.getByText("only .txt files can be added")).toBeVisible();

    await row.getByRole("button", { name: "Remove E2E Upload Probe" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove document" }).click();
    await expect(page.getByText(/Removed 1 document/)).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "E2E Upload Probe" })).toHaveCount(0);
  });

  test("bulk selection exposes selected-item actions", async ({ page }) => {
    await page.goto("/admin/documents");
    const boxes = page.locator("tbody input[data-pick]");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: "Remove selected" }).click();
    await expect(page.getByRole("dialog", { name: "Remove 2 documents?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByText("2 selected")).toBeHidden();
  });

  test("document index: rebuild, inspect vocabulary and postings", async ({ page }) => {
    await page.goto("/admin/index");
    await page.getByRole("button", { name: /Rebuild index|Build index/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Build|Rebuild/ }).click();
    await expect(page.getByText(/Index built:/)).toBeVisible();
    await expect(page.locator(".vx-figures")).toContainText("Current");
    await page.getByLabel("Filter terms").fill("postings");
    await page.getByRole("button", { name: "postings", exact: true }).click();
    const panel = page.locator("[data-postings]");
    await expect(panel.locator(".vx-term")).toHaveText("postings");
    await expect(panel.getByText("Inverted Index Fundamentals")).toBeVisible();
    await expect(panel.getByText("tf").first()).toBeVisible();
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(31);
  });

  test("analytics, quality and system pages are truthful", async ({ page }) => {
    await page.goto("/admin/analytics");
    await expect(page.getByText("No analytics data yet.")).toBeVisible();
    await expect(page.locator("canvas, svg.chart")).toHaveCount(0);
    await page.goto("/admin/quality");
    await expect(page.getByLabel("Precision@5 not computed")).toHaveText("—");
    await page.goto("/admin/system");
    await expect(page.getByText("Responding")).toBeVisible();
    await expect(page.getByText(/uptime/i)).toHaveCount(1); // only the explanation that uptime history isn't tracked
    await page.goto("/owner/platform");
    await expect(page.getByRole("heading", { name: "Privileged-action log" })).toBeVisible();
  });
});
