const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { unique, signInAs, signInOwner, noHorizontalOverflow, csrfHeaders } = require("./helpers");

const WIDTHS = [1920, 1440, 1024, 768, 390, 320];
const PAGES = ["/", "/search?q=inverted%20index", "/search?q=index&tab=overview", "/documents/doc-9150e1b0da", "/history", "/saved", "/collections", "/files", "/settings/appearance", "/help", "/admin", "/admin/documents", "/admin/index", "/admin/users", "/owner/admins", "/owner/platform"];

test.describe("Responsive layouts", () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
      await signInOwner(page);
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await noHorizontalOverflow(page);
      }
    });
  }

  test("long unbroken user text never widens the page on a 320px phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await signInAs(page, unique("longtext"), "Averyveryverylongnamewithoutanyspacesatallforlayouttesting");
    const long = "x".repeat(18) + "unbrokenquerystringwithnospaces" + "y".repeat(40);
    const headers = await csrfHeaders(page.request);
    const col = await (await page.request.post("/api/collections", { headers, data: { name: "z".repeat(60) } })).json();
    await page.goto(`/search?q=${long}`);
    await page.goto("/search?q=inverted%20index");
    for (const path of ["/", `/search?q=${long}`, "/history", "/collections", `/collections/${col.id}`, "/settings/account"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noHorizontalOverflow(page);
    }
  });

  test("mobile navigation drawer opens, navigates and closes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signInAs(page, unique("mobile"), "Mo Bile");
    await expect(page.locator(".vx-sidebar.desktop")).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Saved results" }).click();
    await expect(page).toHaveURL(/\/saved/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Saved results" })).toBeVisible();
  });

  test("filter panel becomes a bottom sheet on phones", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signInAs(page, unique("sheet"), "Shay Sheet");
    await page.goto("/search?q=index");
    await page.getByRole("button", { name: /^Filter/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // measure the settled sheet
    const box = await sheet.boundingBox();
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(800);
  });
});

test.describe("Accessibility", () => {
  for (const theme of ["light", "dark"]) {
    test(`no serious axe violations on key pages (${theme})`, async ({ page }) => {
      await signInOwner(page);
      await page.evaluate(async (t) => {
        const csrf = document.cookie.match(/vx_csrf=([^;]+)/)[1];
        await fetch("/api/me/prefs", { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ theme: t, motion: "reduce" }) });
      }, theme);
      const problems = [];
      for (const path of ["/", "/search?q=inverted%20index", "/search?q=index&tab=overview", "/documents/doc-9150e1b0da", "/settings/appearance", "/admin/documents", "/owner/admins"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(250);
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        r.violations.filter((v) => ["serious", "critical"].includes(v.impact))
          .forEach((v) => problems.push(`${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
      }
      await page.evaluate(async () => {
        const csrf = document.cookie.match(/vx_csrf=([^;]+)/)[1];
        await fetch("/api/me/prefs", { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ theme: "light", motion: "system" }) });
      });
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  test("auth pages pass axe", async ({ page }) => {
    const problems = [];
    for (const path of ["/login", "/register", "/forgot-password"]) {
      await page.goto(path);
      await page.waitForSelector("h1");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).forEach((v) => problems.push(`${path} ${v.id}`));
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("keyboard: skip link, slash shortcut and dialog focus return", async ({ page }) => {
    await signInAs(page, unique("kbd"), "Kay Board");
    await page.goto("/collections");
    await expect(page.locator("#main h1")).toBeAttached(); // the app has rendered its landmark
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
    const newBtn = page.getByRole("button", { name: "New collection" }).first();
    await newBtn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "New collection" })).toBeVisible();
    await expect(page.getByLabel("Name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(newBtn).toBeFocused();
    await page.goto("/");
    await page.locator("h1, .vx-home-brand").first().click();
    await page.keyboard.press("/");
    await expect(page.getByRole("searchbox", { name: "Search Virelix" })).toBeFocused();
  });
});
