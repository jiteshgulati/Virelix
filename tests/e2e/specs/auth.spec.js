const { test, expect } = require("@playwright/test");
const { PASSWORD, unique, linkFor, apiAccount, uiLogin, signOut } = require("./helpers");

test.describe("Authentication", () => {
  test("unauthenticated visitors are sent to sign-in with a return path", async ({ page }) => {
    await page.goto("/saved");
    await expect(page).toHaveURL(/\/login\?next=%2Fsaved/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("registration validates input and never offers a role choice", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByLabel(/role/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Accept the terms to create an account.")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
  });

  test("password visibility toggle", async ({ page }) => {
    await page.goto("/login");
    const field = page.getByLabel("Password", { exact: true });
    await field.fill("secret-value-1");
    await expect(field).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(field).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("register → verify by emailed link → sign in → sign out", async ({ page }) => {
    const email = unique("reg");
    await page.goto("/register");
    await page.getByLabel("Full name").fill("Ada Reader");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await expect(page.getByText("Email isn't delivered by this installation.")).toBeVisible();

    // An unverified account can't sign in yet, and is offered a resend.
    await page.goto(`/login?email=${encodeURIComponent(email)}`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Verify your email before signing in.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend link" })).toBeVisible();

    await page.goto(await linkFor(page.request, email, "verify"));
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await page.getByRole("link", { name: "Continue to sign in" }).click();
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Good to see you, Ada.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Global documents" })).toHaveCount(0);

    await signOut(page);
    await page.goto("/history");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a used verification link is rejected", async ({ page }) => {
    const email = unique("used");
    await apiAccount(page.request, email);
    await page.goto(await linkFor(page.request, email, "verify"));
    await expect(page.getByRole("heading", { name: "Link already used" })).toBeVisible();
  });

  test("wrong password shows a generic error", async ({ page }) => {
    const email = unique("wrong");
    await apiAccount(page.request, email);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Not-the-pass-99");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That email and password combination didn't match an account.")).toBeVisible();
  });

  test("forgot password → reset link → sign in with the new password", async ({ page }) => {
    const email = unique("reset");
    await apiAccount(page.request, email);
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check for the reset link" })).toBeVisible();
    const link = await linkFor(page.request, email, "reset");
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/); // token removed from the address bar
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password").fill("short");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText(/Use at least 10 characters/)).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("Fresh-password-77");
    await page.getByLabel("Confirm new password").fill("Fresh-password-77");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
    await uiLogin(page, email, "Fresh-password-77");
    // The reset link is single-use.
    await signOut(page);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Link already used" })).toBeVisible();
  });
});
