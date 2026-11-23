import Link from "next/link";
import { notFound } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/** Shell for signed-in pages. Static; each page checks the session behind <Suspense>. */
export default async function AppLayout({ children, params }: LayoutProps<"/[lang]/app">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { app, home } = await getDictionary(lang);
  const otherLocale = lang === "ar" ? "en" : "ar";
  const linkClass =
    "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <Link href={`/${lang}/app`} className="font-heading text-lg font-semibold">
          AskDB
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href={`/${lang}/app`} className={linkClass}>
            {app.nav.dashboard}
          </Link>
          <Link href={`/${lang}/app/profile`} className={linkClass}>
            {app.nav.profile}
          </Link>
          <Link href={`/${otherLocale}/app`} hrefLang={otherLocale} className={linkClass}>
            {home.switchLanguage}
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col py-8">{children}</main>
    </div>
  );
}
