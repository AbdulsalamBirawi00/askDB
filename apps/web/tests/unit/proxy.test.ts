import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

function request(path: string, acceptLanguage?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
  });
}

describe("locale proxy", () => {
  it("leaves paths that already have a locale alone", () => {
    expect(proxy(request("/ar"))).toBeUndefined();
    expect(proxy(request("/en/app"))).toBeUndefined();
  });

  it("redirects / to the preferred locale", () => {
    const response = proxy(request("/", "ar-SA,ar;q=0.9"));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/ar");
  });

  it("keeps the rest of the path when adding the locale", () => {
    const response = proxy(request("/app/dashboards?x=1", "en-US"));
    expect(response?.headers.get("location")).toBe("http://localhost:3000/en/app/dashboards?x=1");
  });

  it("does not treat a path that merely starts with a locale as localized", () => {
    const response = proxy(request("/english"));
    expect(response?.headers.get("location")).toBe("http://localhost:3000/en/english");
  });
});
