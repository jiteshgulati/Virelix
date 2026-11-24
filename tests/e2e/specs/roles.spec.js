const { test, expect } = require("@playwright/test");
const { OWNER, unique, linkFor, apiAccount, uiLogin, signInAs, signInOwner, signOut } = require("./helpers");

test.describe("Roles and governance", () => {
  test("members see no administration navigation and are refused admin pages", async ({ page }) => {
    await signInAs(page, unique("member"));
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByText("Administration")).toHaveCount(0);
    await page.goto("/admin/documents");
    await expect(page.getByRole("heading", { name: "This area is restricted" })).toBeVisible();
    const api = await page.request.get("/api/admin/documents");
    expect(api.status()).toBe(403);
    await page.goto("/owner/admins");
    await expect(page.getByRole("heading", { name: "This area is restricted" })).toBeVisible();
  });

  test("the OWNER_EMAIL account becomes Owner after verification", async ({ page }) => {
    await signInOwner(page);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Admin management" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Global documents" })).toBeVisible();
    await page.locator("[data-account]").click();
    await expect(page.locator("[data-account-menu]").getByText("Owner", { exact: true })).toBeVisible();
  });

  test("owner invites an admin; invitation is email-bound, single-use and revocable", async ({ page, browser }) => {
    const adminEmail = unique("admin");
    const other = unique("other");
    await apiAccount(page.request, adminEmail, "Ivy Admin");
    await apiAccount(page.request, other, "Otto Other");
    await signInOwner(page);
    await page.goto("/owner/admins");
    await page.getByLabel("Email address").fill(adminEmail);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.locator("[data-invites]").getByText(adminEmail)).toBeVisible();
    const link = await linkFor(page.request, adminEmail, "invite");

    // A different signed-in account cannot use it.
    const ctxB = await browser.newContext();
    const b = await ctxB.newPage();
    await uiLogin(b, other);
    await b.goto(link);
    await expect(b.getByRole("heading", { name: "Different account" })).toBeVisible();
    await ctxB.close();

    // The invited account accepts and gains Admin, but not Owner, workspaces.
    const ctxA = await browser.newContext();
    const a = await ctxA.newPage();
    await uiLogin(a, adminEmail);
    await a.goto(link);
    await a.getByRole("button", { name: "Accept invitation" }).click();
    await expect(a).toHaveURL(/\/admin$/);
    const nav = a.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Global documents" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Admin management" })).toHaveCount(0);
    expect((await a.request.get("/api/owner/invitations")).status()).toBe(403);
    await a.goto(link);
    await expect(a.getByRole("heading", { name: /Invitation accepted|Already an administrator/ })).toBeVisible();

    // Owner sees it as accepted, then removes Admin access.
    await page.reload();
    await page.getByRole("tab", { name: /Accepted/ }).click();
    await expect(page.locator("[data-invites]").getByText(adminEmail)).toBeVisible();
    const row = page.locator("[data-admins] li", { hasText: "Ivy Admin" });
    await row.getByRole("button", { name: "Remove Admin" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove Admin" }).click();
    await expect(page.locator("[data-admins]").getByText("Ivy Admin")).toHaveCount(0);
    await a.goto("/admin");
    await expect(a.getByRole("heading", { name: "This area is restricted" })).toBeVisible();
    await ctxA.close();
  });

  test("revoked invitations stop working; resend issues a new link", async ({ page, browser }) => {
    const email = unique("revoke");
    await apiAccount(page.request, email, "Rae Revoked");
    await signInOwner(page);
    await page.goto("/owner/admins");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    const first = await linkFor(page.request, email, "invite");
    const item = page.locator("[data-invites] li", { hasText: email });
    await item.getByRole("button", { name: "Resend" }).click();
    await expect(page.getByText(/previous link no longer works/)).toBeVisible();
    const second = await linkFor(page.request, email, "invite");
    expect(second).not.toEqual(first);
    await page.locator("[data-invites] li", { hasText: email }).getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("tab", { name: /Revoked/ }).click();
    await expect(page.locator("[data-invites]").getByText(email)).toBeVisible();

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await uiLogin(p, email);
    await p.goto(second);
    await expect(p.getByRole("heading", { name: "Invitation revoked" })).toBeVisible();
    await p.goto(first);
    await expect(p.getByRole("heading", { name: "Invitation not valid" })).toBeVisible();
    await ctx.close();
  });

  test("admins can suspend and reactivate a member; suspension ends the member's session", async ({ page, browser }) => {
    const memberEmail = unique("suspend");
    const ctx = await browser.newContext();
    const member = await ctx.newPage();
    await signInAs(member, memberEmail, "Sam Suspended");

    await signInOwner(page);
    await page.goto("/admin/users");
    await page.getByLabel("Search users").fill("Sam Suspended");
    const row = page.locator("tbody tr", { hasText: "Sam Suspended" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Suspend", exact: true }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Automated test");
    await page.getByRole("dialog").getByRole("button", { name: "Suspend account" }).click();
    await expect(row.getByText("Suspended")).toBeVisible();
    // Owner account rows offer no suspend control.
    await page.getByLabel("Search users").fill(OWNER);
    await expect(page.locator("tbody tr", { hasText: OWNER }).getByRole("button", { name: "Suspend", exact: true })).toHaveCount(0);

    await member.goto("/saved");
    await expect(member).toHaveURL(/\/login/);
    await member.getByLabel("Email").fill(memberEmail);
    await member.getByLabel("Password", { exact: true }).fill("Correct-horse-42");
    await member.getByRole("button", { name: "Sign in" }).click();
    await expect(member.getByText(/This account is suspended/)).toBeVisible();

    await page.getByLabel("Search users").fill("Sam Suspended");
    await page.locator("tbody tr", { hasText: "Sam Suspended" }).getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await expect(page.locator("tbody tr", { hasText: "Sam Suspended" }).getByText("Active")).toBeVisible();
    await uiLogin(member, memberEmail);
    await ctx.close();
    await signOut(page);
  });
});
