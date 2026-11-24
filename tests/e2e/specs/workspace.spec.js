const { test, expect } = require("@playwright/test");
const { unique, signInAs } = require("./helpers");

test.describe("Personal workspace and settings", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, unique("ws"), "Wren Worker");
  });

  test("private attachments: validate, attach, search privately, view, remove", async ({ page }) => {
    await page.goto("/files");
    const input = page.locator("[data-input]");
    await input.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    await expect(page.getByText("isn't a .txt file")).toBeVisible();
    await input.setInputFiles({ name: "field-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Field notes on quokkaphile cataloguing and private indexing.") });
    await expect(page.locator("[data-list]").getByText("field-notes.txt")).toBeVisible();

    await page.getByRole("searchbox", { name: "Search your attachments" }).fill("quokkaphile");
    await page.getByRole("searchbox", { name: "Search your attachments" }).press("Enter");
    await expect(page.locator(".vx-result")).toHaveCount(1);
    await expect(page.locator(".vx-result .src").getByText("Private attachment", { exact: true })).toBeVisible();
    await expect(page.locator(".vx-result").getByRole("button", { name: "Save result" })).toHaveCount(0);
    await page.locator(".vx-result h3 a").click();
    await expect(page.getByText("Only you can see this file.")).toBeVisible();
    await page.getByRole("button", { name: "Remove attachment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByRole("heading", { name: "No files attached" })).toBeVisible();
  });

  test("attachments are invisible to other members", async ({ page, browser }) => {
    await page.goto("/");
    await page.locator("[data-attach-input]").setInputFiles({ name: "secret.txt", mimeType: "text/plain", buffer: Buffer.from("Zephyrine private memo.") });
    await expect(page.locator("[data-attachments]").getByText("secret.txt")).toBeVisible();
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await signInAs(other, unique("peer"), "Pat Peer");
    await other.goto("/search?q=zephyrine&mode=any");
    await expect(other.getByRole("heading", { name: "No documents match" })).toBeVisible();
    await ctx.close();
  });

  test("collections: create, rename, duplicate names, delete with confirmation", async ({ page }) => {
    await page.goto("/collections");
    await page.getByRole("button", { name: "New collection" }).first().click();
    let dialog = page.getByRole("dialog", { name: "New collection" });
    await dialog.getByLabel("Name").fill("Reading");
    await dialog.getByRole("button", { name: "Create collection" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reading" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "This collection is empty" })).toBeVisible();
    await page.getByRole("button", { name: "Rename" }).click();
    dialog = page.getByRole("dialog", { name: "Rename collection" });
    await dialog.getByLabel("Name").fill("Reading notes");
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reading notes" })).toBeVisible();

    await page.goto("/collections");
    await page.getByRole("button", { name: "New collection" }).first().click();
    dialog = page.getByRole("dialog", { name: "New collection" });
    await dialog.getByLabel("Name").fill("reading NOTES");
    await dialog.getByRole("button", { name: "Create collection" }).click();
    await expect(dialog.getByText("You already have a collection with that name.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: /Reading notes/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reading notes" })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete collection" }).click();
    await expect(page).toHaveURL(/\/collections$/);
    await expect(page.getByRole("heading", { name: "No collections yet" })).toBeVisible();
  });

  test("appearance preferences apply immediately and persist", async ({ page }) => {
    await page.goto("/settings/appearance");
    await page.getByText("Dark", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByLabel("Lapis").check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-accent", "lapis");
    await page.getByRole("radiogroup", { name: "Text size" }).getByRole("radio", { name: "Large" }).check();
    await page.getByRole("radiogroup", { name: "Interface density" }).getByRole("radio", { name: "Compact" }).check();
    await page.getByRole("radiogroup", { name: "Motion" }).getByRole("radio", { name: "Reduce" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await page.getByText("OLED black").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "oled");
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "oled");
    await expect(page.locator("html")).toHaveAttribute("data-accent", "lapis");
    await expect(page.locator("html")).toHaveAttribute("data-text", "lg");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await page.getByRole("radiogroup", { name: "Sidebar" }).getByRole("radio", { name: "Collapsed" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
    await page.getByText("Light", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("account: profile update, password change validation, history toggle", async ({ page }) => {
    await page.goto("/settings/account");
    await page.getByLabel("Full name").fill("Wren W. Worker");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile updated.")).toBeVisible();
    await expect(page.locator("[data-account-name]")).toHaveText("Wren");
    await page.getByLabel("Current password").fill("wrong-password-1");
    await page.getByLabel("New password", { exact: true }).fill("Another-pass-88");
    await page.getByLabel("Confirm new password").fill("Another-pass-88");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Current password is incorrect.")).toBeVisible();

    await page.goto("/settings/privacy");
    await expect(page.getByText("This session")).toBeVisible();
    await page.getByRole("switch", { name: "Save search history" }).uncheck();
    await expect(page.getByText("Preference saved.")).toBeVisible();
    await page.goto("/search?q=hash");
    await page.goto("/history");
    await expect(page.getByText("Recording is off.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No searches yet" })).toBeVisible();
  });

  test("unavailable entry points explain themselves", async ({ page }) => {
    await page.getByRole("link", { name: /AI Answers/ }).click();
    await expect(page.getByRole("heading", { name: "Generated answers aren't available yet" })).toBeVisible();
    await page.goto("/");
    await page.getByRole("link", { name: /Research Mode/ }).click();
    await expect(page.getByRole("heading", { name: "Research Mode isn't available yet" })).toBeVisible();
    await page.goto("/");
    // aria-disabled (not disabled) so it stays focusable and can explain itself. A forced click skips
    // Playwright's stability check, so wait for web fonts to finish swapping in first.
    await page.evaluate(() => document.fonts.ready);
    const voice = page.getByRole("button", { name: /Voice search/ });
    await voice.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Voice search isn't available yet.")).toBeVisible();
  });

  test("notifications show truthful in-app state", async ({ page }) => {
    await page.getByRole("button", { name: /Notifications/ }).click();
    const menu = page.locator("[data-notifs]");
    await expect(menu.getByText("Email verified")).toBeVisible();
    await expect(menu.getByText("In-app only. Virelix doesn't send email or push notifications.")).toBeVisible();
    await menu.getByRole("button", { name: "Mark all read" }).click();
    await expect(menu.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });
});
