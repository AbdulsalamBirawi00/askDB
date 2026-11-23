import Link from "next/link";
import type { ReactNode } from "react";

import type { Locale } from "@/i18n/config";

/** Top bar shared by public pages: logo, optional actions, and the language switch. */
export function SiteHeader({
  lang,
  switchLabel,
  switchHref,
  children,
}: {
  lang: Locale;
  switchLabel: string;
  /** Same page in the other language. */
  switchHref: string;
  children?: ReactNode;
}) {
  const otherLocale = lang === "ar" ? "en" : "ar";
  return (
    <header className="flex items-center justify-between gap-4">
      <Link href={`/${lang}`} className="font-heading text-lg font-semibold">
        AskDB
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {children}
        <Link
          href={switchHref}
          hrefLang={otherLocale}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {switchLabel}
        </Link>
      </nav>
    </header>
  );
}
