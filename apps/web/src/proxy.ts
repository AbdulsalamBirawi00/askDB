import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { locales, negotiateLocale } from "@/i18n/config";

/** `/en/app`, `/ar/app/...`: pages that need a signed-in user. */
const privatePath = new RegExp(`^/(${locales.join("|")})/app(/|$)`);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (!hasLocale) {
    const locale = negotiateLocale(request.headers.get("accept-language"));
    request.nextUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(request.nextUrl);
  }

  // Fast, optimistic check on the cookie only. Pages and API routes still
  // validate the session against the database before showing any data.
  const match = privatePath.exec(pathname);
  if (match && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${match[1]}/login`;
    url.search = "";
    return NextResponse.redirect(url);
  }
}

export const config = {
  // Skip API routes, Next internals, and files with an extension (favicon.ico, images, ...).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
