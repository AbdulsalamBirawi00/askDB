import { notFound } from "next/navigation";
import { Suspense } from "react";

import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { requireUser } from "@/lib/session";

async function Dashboard({ lang, app }: { lang: Locale; app: Dictionary["app"] }) {
  const user = await requireUser(lang);
  const isDemo = user.role === "demo";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {app.welcome.replace("{name}", user.name)}
        </h1>
        {isDemo && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {app.guestBadge}
          </span>
        )}
      </div>

      <section aria-labelledby="database-heading" className="flex flex-col gap-3">
        <h2 id="database-heading" className="text-sm font-medium text-muted-foreground">
          {app.databaseHeading}
        </h2>
        <div className="rounded-xl border p-5" data-testid="database-card">
          <h3 className="font-heading text-lg font-semibold">
            {isDemo ? app.northwindName : app.noConnectionsTitle}
          </h3>
          <p className="mt-1 text-pretty text-muted-foreground">
            {isDemo ? app.northwindBody : app.noConnectionsBody}
          </p>
        </div>
      </section>
    </div>
  );
}

export default async function AppHomePage({ params }: PageProps<"/[lang]/app">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { app } = await getDictionary(lang);

  return (
    <Suspense fallback={<p className="text-muted-foreground">{app.loading}</p>}>
      <Dashboard lang={lang} app={app} />
    </Suspense>
  );
}
