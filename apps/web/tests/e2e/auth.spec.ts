import { expect, test } from "@playwright/test";

import { useUniqueClientIp } from "./helpers";

test.describe("authentication", () => {
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("T1.1 visiting /app while signed out redirects to /login", async ({ page }) => {
    await page.goto("/en/app");
    await expect(page).toHaveURL(/\/en\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to AskDB");

    await page.goto("/ar/app/profile");
    await expect(page).toHaveURL(/\/ar\/login$/);
  });

  test("T1.2 'Try as guest' signs in at once and shows the Northwind dashboard", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Try as guest" }).click();

    await expect(page).toHaveURL(/\/en\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Guest");
    await expect(page.getByText("Guest mode")).toBeVisible();
    await expect(page.getByTestId("database-card").filter({ hasText: "Northwind" })).toBeVisible();

    // Signed in: the login page sends you back to the app.
    await page.goto("/en/login");
    await expect(page).toHaveURL(/\/en\/app$/);
  });

  test("guest profile and sign-out (Arabic, RTL)", async ({ page }) => {
    await page.goto("/ar/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("button", { name: "جرّب كضيف" }).click();
    await expect(page).toHaveURL(/\/ar\/app$/);

    await page.getByRole("link", { name: "الملف الشخصي" }).click();
    await expect(page).toHaveURL(/\/ar\/app\/profile$/);
    await expect(page.getByText("ضيف (تجريبي)")).toBeVisible();
    // A guest's generated placeholder email is never shown.
    await expect(page.getByText("البريد الإلكتروني")).toHaveCount(0);

    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page).toHaveURL(/\/ar$/);

    await page.goto("/ar/app");
    await expect(page).toHaveURL(/\/ar\/login$/);
  });
});
