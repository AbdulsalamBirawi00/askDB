import { describe, expect, it } from "vitest";

import { getDirection, isLocale, negotiateLocale } from "@/i18n/config";

describe("i18n config", () => {
  it("maps Arabic to RTL and English to LTR", () => {
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
  });

  it("recognizes only supported locales", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it.each([
    [null, "en"],
    ["", "en"],
    ["ar-SA,ar;q=0.9,en;q=0.8", "ar"],
    ["en-US,en;q=0.9,ar;q=0.8", "en"],
    ["fr-FR,fr;q=0.9,ar;q=0.5", "ar"],
    ["fr-FR,de;q=0.9", "en"],
    ["en;q=0.2,ar;q=0.9", "ar"],
    ["ar;q=0,en;q=0.5", "en"],
  ])("negotiates %s -> %s", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });
});
