import { describe, expect, it } from "vitest";

import { isSensitiveColumnName } from "../src";

describe("sensitive column detection", () => {
  it.each([
    "password_hash",
    "password",
    "passwordHash",
    "api_token",
    "client_secret",
    "apiKey",
    "email",
    "contact_email",
    "phone",
    "home_phone",
    "mobilePhone",
    "pwd",
    "ssn",
  ])("T2.7 %s is hidden automatically", (name) => {
    expect(isSensitiveColumnName(name)).toBe(true);
  });

  it.each(["customer_id", "company_name", "order_date", "unit_price", "ship_country", "fax"])(
    "%s is visible",
    (name) => {
      expect(isSensitiveColumnName(name)).toBe(false);
    },
  );
});
