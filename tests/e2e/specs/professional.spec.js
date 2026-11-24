// Role-based interfaces, product terminology, injection safety, live privilege changes,
// developer-mailbox protection and appearance defaults.
const { test, expect } = require("@playwright/test");
const { DEV_KEY, unique, apiAccount, uiLogin, signInAs, signInOwner, linkFor, csrfHeaders } = require("./helpers");

const ACADEMIC = /\bweek\s?\d|after week|PST_AD|G393|\bOJT\b|academic (project|milestone|scope)|four-week|coursework/i;
const MEMBER_ROUTES = ["/", "/search", "/search?q=inverted%20index", "/search?q=index&tab=overview", "/search?q=index&tab=academic",
  "/search?q=index&tab=images", "/documents/doc-9150e1b0da", "/history", "/saved", "/collections", "/files", "/answers", "/research",
  "/settings/account", "/settings/appearance", "/settings/privacy", "/settings/search", "/settings/notifications", "/settings/display", "/help"];
const ADMIN_ROUTES = ["/admin", "/admin/documents", "/admin/index", "/admin/users", "/admin/analytics", "/admin/quality", "/admin/system"];
const OWNER_ROUTES = ["/owner/admins", "/owner/platform"];
const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password", "/terms", "/verify-pending?email=a%40b.test", "/dev/mailbox", "/no-such-page"];

async function visibleCopy(page) {
  return page.evaluate(() => {
    const attrs = Array.from(document.querySelectorAll("[title],[aria-label],[placeholder],[data-bs-title]"))
      .map((el) => ["title", "aria-label", "placeholder", "data-bs-title"].map((a) => el.getAttribute(a) || "").join(" "));
    return [document.title, document.body.innerText, ...attrs].join("\n");
  });
}

async function assertProfessional(page, routes) {
  const problems = [];
  for (const r of routes) {
    await page.goto(r);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1").first(), `${r} rendered no heading`).toBeAttached();
    const text = await visibleCopy(page);
    const m = text.match(ACADEMIC);
    if (m) problems.push(`${r}: “${m[0]}”`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
}

async function navGroups(page) {
  return page.locator('nav[aria-label="Main navigation"] .vx-nav-label').allInnerTexts();
}

async function makeAdmin(page, ownerPage, email, name) {
  await apiAccount(page.request, email, name);
  const headers = await csrfHeaders(ownerPage.request);
  expect((await ownerPage.request.post("/api/owner/invitations", { headers, data: { email } })).status()).toBe(201);
  await uiLogin(page, email);
  await page.goto(await linkFor(page.request, email, "invite"));
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe("Role-based interfaces and product language", () => {
  test("public pages contain no academic schedule language", async ({ page }) => {
    await assertProfessional(page, PUBLIC_ROUTES);
  });

  test("member: personal workspace only, and professional copy everywhere", async ({ page }) => {
    await signInAs(page, unique("pro-member"), "Mina Member");
    expect((await navGroups(page)).map((s) => s.trim().toLowerCase())).toEqual(["workspace"]);
    await assertProfessional(page, MEMBER_ROUTES);
    for (const r of [...ADMIN_ROUTES, ...OWNER_ROUTES]) {
      await page.goto(r);
      await expect(page.getByRole("heading", { name: "This area is restricted" })).toBeVisible();
    }
  });

  test("admin and owner: correct navigation groups and professional copy", async ({ page, browser }) => {
    await signInOwner(page);
    expect((await navGroups(page)).map((s) => s.trim().toLowerCase())).toEqual(["workspace", "administration", "governance"]);
    await assertProfessional(page, [...MEMBER_ROUTES, ...ADMIN_ROUTES, ...OWNER_ROUTES]);

    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await makeAdmin(admin, page, unique("pro-admin"), "Ada Admin");
    expect((await navGroups(admin)).map((s) => s.trim().toLowerCase())).toEqual(["workspace", "administration"]);
    for (const r of OWNER_ROUTES) {
      await admin.goto(r);
      await expect(admin.getByRole("heading", { name: "This area is restricted" })).toBeVisible();
    }
    await ctx.close();
  });
});

test.describe("Injection safety", () => {
  test("stored and reflected HTML is rendered as text and never executes", async ({ page }) => {
    const payload = `<img src=x onerror="window.__xss=1">`;
    const script = `<script>window.__xss=2</script>`;
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; d.dismiss(); });
    await signInOwner(page);
    const headers = await csrfHeaders(page.request);

    // Shared document whose title, metadata and body carry markup.
    const up = await page.request.post("/api/admin/documents", {
      headers: { "X-CSRF-Token": headers["X-CSRF-Token"], "Content-Type": "text/plain", "X-Filename": encodeURIComponent(`${payload}.txt`) },
      data: `Title: Quokka ${payload}\nCategory: ${script}\n---\nQuokka body ${script} and ${payload} text.`,
    });
    expect(up.status()).toBe(201);
    const doc = await up.json();
    expect(doc.filename).not.toContain("<");

    // Collection name and a reflected query.
    const col = await (await page.request.post("/api/collections", { headers, data: { name: payload } })).json();
    await page.goto(`/search?q=${encodeURIComponent(`quokka ${script}`)}&mode=any`);
    await expect(page.locator(".vx-result h3").first()).toContainText("<img src=x");
    await page.locator(".vx-result h3 a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Quokka ${payload}`);
    await expect(page.locator(".vx-prose")).toContainText(script);
    await page.goto(`/collections/${col.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(payload);
    await page.goto("/history");
    await expect(page.getByRole("link", { name: /quokka <script>/ })).toBeVisible();

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(dialogs).toBe(0);
    await page.request.post("/api/admin/documents/remove", { headers, data: { doc_ids: [doc.doc_id] } });
  });

  test("highlighting never breaks HTML entities or emits markup from text", async ({ page }) => {
    await page.goto("/login");
    const out = await page.evaluate(async () => {
      const { highlight } = await import("/assets/js/core/dom.js");
      return [
        highlight(`Tom & Jerry's "quote" <b>`, ["amp", "39", "quot", "lt", "b"]).s,
        highlight("An Index of indexes", ["index"]).s,
      ];
    });
    expect(out[0]).toBe("Tom &amp; Jerry&#39;s &quot;quote&quot; &lt;<mark class=\"vx-mark\">b</mark>&gt;");
    expect(out[1]).toBe('An <mark class="vx-mark">Index</mark> of indexes');
  });

  test("notification and return links only accept same-origin paths", async ({ page }) => {
    await page.goto("/login");
    const verdicts = await page.evaluate(async () => {
      const { safePath } = await import("/assets/js/core/format.js");
      return ["/saved", "javascript:alert(1)", "//evil.example", "https://evil.example", "/\\evil"].map((v) => safePath(v));
    });
    expect(verdicts).toEqual(["/saved", null, null, null, null]);
    await signInAs(page, unique("ret"), "Rita Return");
    await page.goto(`/documents/doc-9150e1b0da?from=${encodeURIComponent("javascript:alert(1)")}`);
    await expect(page.getByRole("link", { name: "Back to search" })).toHaveAttribute("href", "/search");
  });
});

test.describe("Live privilege changes", () => {
  test("removing Admin access updates the open session immediately", async ({ page, browser }) => {
    await signInOwner(page);
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    const email = unique("demote");
    await makeAdmin(admin, page, email, "Dee Demoted");
    await admin.goto("/admin/documents");
    await expect(admin.getByRole("heading", { name: "Global documents" })).toBeVisible();

    await page.goto("/owner/admins");
    const row = page.locator("[data-admins] li", { hasText: "Dee Demoted" });
    await row.getByRole("button", { name: "Remove Admin" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove Admin" }).click();
    await expect(page.locator("[data-admins]").getByText("Dee Demoted")).toHaveCount(0);

    // The admin's next action is refused by the server and the interface re-syncs.
    await admin.getByRole("button", { name: "Reload from disk" }).click();
    await expect(admin.getByText("Your account access has changed.")).toBeVisible();
    await expect(admin.getByRole("heading", { name: "This area is restricted" })).toBeVisible();
    await expect(admin.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Global documents" })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("Developer mailbox", () => {
  test("requires the console key; the key never stays in the address bar", async ({ page }) => {
    await page.goto("/dev/mailbox");
    await expect(page.getByLabel("Developer key")).toBeVisible();
    expect((await page.request.get("/api/dev/mailbox")).status()).toBe(403);
    await page.getByLabel("Developer key").fill("wrong-key");
    await page.getByRole("button", { name: "Open mailbox" }).click();
    await expect(page.getByText("That key wasn't accepted.")).toBeVisible();
    await page.goto(`/dev/mailbox#key=${DEV_KEY}`);
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page).toHaveURL(/\/dev\/mailbox$/);
  });

  test("is not linked from the application", async ({ page }) => {
    await signInAs(page, unique("nolink"), "Nola Link");
    await page.locator("[data-account]").click();
    await expect(page.locator('a[href^="/dev/mailbox"]')).toHaveCount(0);
  });
});

test.describe("Appearance defaults", () => {
  test("first-time visitors and new accounts get the light theme, even on a dark OS", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await signInAs(page, unique("light"), "Lee Light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.goto("/settings/appearance");
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
    await page.locator(".vx-theme-card", { hasText: "System" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // explicit choice honoured
    await ctx.close();
  });
});
