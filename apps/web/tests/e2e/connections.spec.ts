import { expect, test } from "@playwright/test";

import { northwindUrl, signInAsRegularUser, useUniqueClientIp } from "./helpers";

test.describe("connections and schema", () => {
  test.beforeEach(({ page }) => useUniqueClientIp(page));

  test("T2.8 a column note survives 'Refresh schema'", async ({ page }) => {
    await signInAsRegularUser(page);
    await page.goto("/en/app/connections/new");

    await page.getByLabel("Name").fill("My Northwind");
    await page.getByLabel("Connection URL").fill(northwindUrl());
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText("Connection works.")).toBeVisible();
    await expect(page.getByText("This user has write privileges")).toHaveCount(0);

    await page.getByRole("button", { name: "Save connection" }).click();
    await expect(page).toHaveURL(/\/en\/app\/connections\/[\w-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My Northwind");

    const customers = page.getByTestId("table-customers");
    await customers.locator("summary").click();
    // T2.7 in the UI: the phone column starts hidden.
    await expect(customers.getByLabel("Hidden: phone")).toBeChecked();
    await expect(customers.getByLabel("Hidden: company_name")).not.toBeChecked();

    const note = customers.getByLabel("Note: customers.country");
    await note.fill("Billing country");
    await note.blur();
    await expect(customers.getByTestId("column-country").getByText("Saved")).toBeVisible();

    await page.getByRole("button", { name: "Refresh schema" }).click();
    await expect(page.getByText("Schema refreshed. Your notes were kept.")).toBeVisible();

    await page.reload();
    const reloaded = page.getByTestId("table-customers");
    await reloaded.locator("summary").click();
    await expect(reloaded.getByLabel("Note: customers.country")).toHaveValue("Billing country");
  });

  test("a wrong password shows only 'Connection failed'", async ({ page }) => {
    await signInAsRegularUser(page);
    await page.goto("/en/app/connections/new");
    const bad = new URL(northwindUrl());
    bad.password = "wrong-password";
    await page.getByLabel("Connection URL").fill(bad.toString());
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByRole("status")).toHaveText("Connection failed");
  });

  test("guests see the shared Northwind schema read-only (Arabic)", async ({ page }) => {
    await page.goto("/ar/login");
    await page.getByRole("button", { name: "جرّب كضيف" }).click();
    await expect(page).toHaveURL(/\/ar\/app$/);
    await expect(page.getByRole("link", { name: "إضافة اتصال" })).toHaveCount(0);

    await page.getByTestId("database-card").filter({ hasText: "Northwind" }).click();
    await expect(page).toHaveURL(/\/ar\/app\/connections\/demo-northwind$/);
    await expect(page.getByText("هذه قاعدة البيانات التجريبية المشتركة")).toBeVisible();
    await expect(page.getByRole("button", { name: "تحديث البنية" })).toHaveCount(0);

    const orders = page.getByTestId("table-orders");
    await orders.locator("summary").click();
    await expect(orders.getByTestId("column-customer_id")).toContainText("customers.customer_id");

    // Guests are sent away from the add form.
    await page.goto("/ar/app/connections/new");
    await expect(page).toHaveURL(/\/ar\/app$/);
  });
});
