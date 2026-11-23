import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { home } = await getDictionary(lang);
  const otherLocale = lang === "ar" ? "en" : "ar";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
      <header className="flex items-center justify-between">
        <span className="font-heading text-lg font-semibold">AskDB</span>
        <Link
          href={`/${otherLocale}`}
          hrefLang={otherLocale}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {home.switchLanguage}
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-start justify-center gap-6 py-16">
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {home.badge}
        </span>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          {home.title}
        </h1>
        <p className="max-w-xl text-lg text-pretty text-muted-foreground">{home.subtitle}</p>
        <div className="flex items-center gap-3">
          <Button size="lg" disabled>
            {home.tryGuest}
          </Button>
          <span className="text-sm text-muted-foreground">{home.comingSoon}</span>
        </div>
      </section>
    </main>
  );
}
