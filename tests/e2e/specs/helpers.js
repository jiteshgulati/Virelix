// Shared helpers for browser tests. All accounts are synthetic (@virelix.test).
const { expect } = require("@playwright/test");

const PASSWORD = "Correct-horse-42";
const DEV_KEY = process.env.E2E_DEV_KEY || "e2e-developer-key";
const OWNER = "owner@virelix.test";

const unique = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@virelix.test`;

async function mailbox(request) {
  const r = await request.get("/api/dev/mailbox", { headers: { "X-Dev-Mailbox-Key": DEV_KEY } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).messages;
}

async function linkFor(request, email, kind) {
  const msg = (await mailbox(request)).find((m) => m.to === email && m.kind === kind);
  expect(msg, `expected a ${kind} message for ${email}`).toBeTruthy();
  const url = new URL(msg.link);
  return url.pathname + url.search;
}

async function csrfHeaders(request) {
  await request.get("/api/auth/session");
  const state = await request.storageState();
  const c = state.cookies.find((x) => x.name === "vx_csrf");
  return { "X-CSRF-Token": c.value, "Content-Type": "application/json" };
}

/** Register + verify through the API (fast path for tests that aren't about sign-up). */
async function apiAccount(request, email, name = "Test Member") {
  const headers = await csrfHeaders(request);
  const r = await request.post("/api/auth/register", { headers, data: { name, email, password: PASSWORD, confirm_password: PASSWORD, accept_terms: true } });
  if (r.status() !== 201 && r.status() !== 409) throw new Error(`register failed ${r.status()} ${await r.text()}`);
  if (r.status() === 201) {
    const link = await linkFor(request, email, "verify");
    const token = new URL(link, "http://x").searchParams.get("token");
    const v = await request.post("/api/auth/verify-email", { headers, data: { token } });
    expect(v.ok()).toBeTruthy();
  }
}

async function uiLogin(page, email, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-account]")).toBeVisible();
}

async function signInAs(page, email, name) {
  await apiAccount(page.request, email, name);
  await uiLogin(page, email);
}

async function signInOwner(page) {
  await apiAccount(page.request, OWNER, "Platform Owner");
  await uiLogin(page, OWNER);
}

async function signOut(page) {
  await page.locator("[data-account]").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function noHorizontalOverflow(page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, `page is ${sw}px wide in a ${iw}px viewport`).toBeLessThanOrEqual(iw);
}

module.exports = { DEV_KEY, PASSWORD, OWNER, unique, mailbox, linkFor, apiAccount, uiLogin, signInAs, signInOwner, signOut, csrfHeaders, noHorizontalOverflow };
