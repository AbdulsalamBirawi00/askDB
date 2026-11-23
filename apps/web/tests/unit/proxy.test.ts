import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

describe("proxy: locale", () => {
  it("leaves public paths that already have a locale alone", () => {
    expect(proxy(request("/ar"))).toBeUndefined();
    expect(proxy(request("/en/login"))).toBeUndefined();
    expect(proxy(request("/en/application"))).toBeUndefined();
  });

  it("redirects / to the preferred locale", () => {
    const response = proxy(request("/", { "accept-language": "ar-SA,ar;q=0.9" }));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/ar");
  });

  it("keeps the rest of the path when adding the locale", () => {
    const response = proxy(request("/app/dashboards?x=1", { "accept-language": "en-US" }));
    expect(response?.headers.get("location")).toBe("http://localhost:3000/en/app/dashboards?x=1");
  });

  it("does not treat a path that merely starts with a locale as localized", () => {
    const response = proxy(request("/english"));
    expect(response?.headers.get("location")).toBe("http://localhost:3000/en/english");
  });
});

describe("proxy: private pages", () => {
  it("T1.1 redirects /app to the login page when signed out", () => {
    for (const [path, login] of [
      ["/en/app", "http://localhost:3000/en/login"],
      ["/ar/app/profile?tab=1", "http://localhost:3000/ar/login"],
    ]) {
      const response = proxy(request(path!));
      expect(response?.status).toBe(307);
      expect(response?.headers.get("location")).toBe(login);
    }
  });

  it("lets a request with a session cookie through (the page validates it)", () => {
    const cookie = { cookie: "better-auth.session_token=abc.def" };
    expect(proxy(request("/en/app", cookie))).toBeUndefined();
    const secure = { cookie: "__Secure-better-auth.session_token=abc.def" };
    expect(proxy(request("/ar/app/profile", secure))).toBeUndefined();
  });
});
