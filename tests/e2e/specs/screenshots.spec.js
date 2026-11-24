// Captures documentation screenshots into docs/screenshots. Run: npx playwright test screenshots
const path = require("path");
const { test, expect } = require("@playwright/test");
const { DEV_KEY, OWNER, unique, apiAccount, uiLogin, linkFor, csrfHeaders } = require("./helpers");

const OUT = path.resolve(__dirname, "../../../docs/screenshots");
async function shot(page, name) {
  await page.waitForLoadState("networkidle");
  await page.locator("h1").first().waitFor({ state: "attached" });   // the view has rendered
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function setPrefs(page, prefs) {
  const headers = await csrfHeaders(page.request);
  await page.request.patch("/api/me/prefs", { headers, data: prefs });
}

test("documentation screenshots", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.waitForSelector("h1");
  await shot(page, "01-sign-in");
  await page.goto("/register");
  await page.waitForSelector("h1");
  await shot(page, "02-create-account");

  await apiAccount(page.request, OWNER, "Platform Owner");
  await uiLogin(page, OWNER);
  await setPrefs(page, { theme: "light", motion: "reduce" });
  // Seed some genuine activity so workspace pages show real states.
  await page.goto("/search?q=hash%20table");
  await page.goto("/search?q=sorting&mode=any");
  await page.goto("/");
  await page.locator("[data-attach-input]").setInputFiles({ name: "lecture-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Lecture notes: inverted index construction, postings lists and term frequency.") });
  await expect(page.locator("[data-attachments]").getByText("lecture-notes.txt")).toBeVisible();
  await page.waitForTimeout(4500); // let toasts clear
  await shot(page, "03-home");

  await page.goto("/search?q=inverted%20index");
  await page.locator(".vx-result").first().getByRole("button", { name: "Save result" }).click();
  await page.waitForTimeout(4500);
  await shot(page, "04-search-results");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.waitForTimeout(250);
  await shot(page, "05-filter-panel");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /AI Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Extractive preview" })).toBeVisible();
  await shot(page, "06-extractive-overview");
  await page.getByRole("tab", { name: /^Academic/ }).click();
  await shot(page, "07-unavailable-category");

  await page.goto("/search?q=inverted%20index");
  await page.locator(".vx-result h3 a").first().click();
  await expect(page.locator("mark.vx-mark").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "08-document-viewer");

  const headers = await csrfHeaders(page.request);
  const docs = (await (await page.request.get("/api/search?q=index&mode=any&per_page=10")).json()).results;
  const col = await (await page.request.post("/api/collections", { headers, data: { name: "Retrieval reading list", description: "Foundations for the Week 2 ranking work." } })).json();
  for (const d of docs.slice(0, 4)) await page.request.post(`/api/collections/${col.id}/items`, { headers, data: { doc_id: d.doc_id } });
  await page.request.post("/api/collections", { headers, data: { name: "Security basics" } });
  await page.goto("/collections");
  await shot(page, "09-collections");
  await page.goto(`/collections/${col.id}`);
  await shot(page, "10-collection-detail");
  await page.goto("/saved");
  await shot(page, "11-saved-results");
  await page.goto("/history");
  await shot(page, "12-search-history");
  await page.goto("/files");
  await shot(page, "13-your-files");
  await page.goto("/settings/appearance");
  await shot(page, "14-settings-appearance");

  // Administration
  await page.goto("/admin/index");
  await page.getByRole("button", { name: /Rebuild index/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Build|Rebuild/ }).click();
  await expect(page.getByText(/Index built:/)).toBeVisible();
  await page.getByLabel("Filter terms").fill("index");
  await page.getByRole("button", { name: "index", exact: true }).click();
  await expect(page.locator("[data-postings] .vx-term")).toHaveText("index");
  await page.waitForTimeout(4500);
  await shot(page, "15-admin-index");
  await page.goto("/admin");
  await shot(page, "16-admin-overview");
  await page.goto("/admin/documents");
  await shot(page, "17-admin-documents");
  await page.goto("/admin/users");
  await shot(page, "18-admin-users");
  await page.goto("/admin/analytics");
  await shot(page, "19-admin-analytics");
  await page.goto("/admin/system");
  await shot(page, "20-admin-system");

  const invitee = unique("invitee");
  await page.request.post("/api/owner/invitations", { headers, data: { email: invitee } });
  await page.goto("/owner/admins");
  await shot(page, "21-owner-admin-management");
  await page.goto("/owner/platform");
  await shot(page, "22-owner-platform");

  // Themes
  await setPrefs(page, { theme: "dark" });
  await page.goto("/search?q=inverted%20index");
  await shot(page, "23-dark-search");
  await setPrefs(page, { theme: "oled", accent: "ochre" });
  await page.goto("/documents/doc-9150e1b0da");
  await shot(page, "24-oled-document");
  await setPrefs(page, { theme: "light", accent: "viridian" });

  // Mobile
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const m = await mctx.newPage();
  await uiLogin(m, OWNER);
  await m.waitForTimeout(4500);
  await shot(m, "25-mobile-home");
  await m.goto("/search?q=inverted%20index");
  await shot(m, "26-mobile-results");
  await m.getByRole("button", { name: /^Filter/ }).click();
  await m.waitForTimeout(250);
  await shot(m, "27-mobile-filter-sheet");
  await m.keyboard.press("Escape");
  await m.getByRole("button", { name: "Open navigation" }).click();
  await m.waitForTimeout(400);
  await shot(m, "28-mobile-navigation");
  await mctx.close();

  // One representative view per role (member and admin use their own synthetic accounts)
  const memberEmail = unique("shot-member");
  const mem = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mp = await mem.newPage();
  await apiAccount(mp.request, memberEmail, "Morgan Member");
  await uiLogin(mp, memberEmail);
  await mp.waitForTimeout(4500);
  await shot(mp, "30-role-member-home");
  await mp.goto("/admin");
  await shot(mp, "31-role-member-restricted");
  await mem.close();

  const adminEmail = unique("shot-admin");
  const adm = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await adm.newPage();
  await apiAccount(ap.request, adminEmail, "Avery Admin");
  await page.request.post("/api/owner/invitations", { headers, data: { email: adminEmail } });
  await uiLogin(ap, adminEmail);
  await ap.goto(await linkFor(ap.request, adminEmail, "invite"));
  await shot(ap, "32-role-admin-invitation");
  await ap.getByRole("button", { name: "Accept invitation" }).click();
  await expect(ap).toHaveURL(/\/admin$/);
  await ap.waitForTimeout(4500);
  await shot(ap, "33-role-admin-overview");
  await adm.close();

  // Development mailbox (shows the honest delivery notice)
  await page.goto(`/dev/mailbox#key=${DEV_KEY}`);
  await shot(page, "29-dev-mailbox");
  await setPrefs(page, { motion: "system" });
});
