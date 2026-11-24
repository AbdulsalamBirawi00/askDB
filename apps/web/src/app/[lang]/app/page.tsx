import { listConnections } from "@askdb/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { buttonVariants } from "@/components/ui/button";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

const badge = "rounded-full px-2.5 py-0.5 text-xs font-medium";

async function Dashboard({ lang, app }: { lang: Locale; app: Dictionary["app"] }) {
  const user = await requireUser(lang);
  const isDemo = user.role === "demo";
  const connections = await listConnections(getDb(), user.id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {app.welcome.replace("{name}", user.name)}
        </h1>
        {isDemo && (
          <span className={`${badge} bg-muted text-muted-foreground`}>{app.guestBadge}</span>
        )}
      </div>

      <section aria-labelledby="databases-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="databases-heading" className="font-heading text-lg font-semibold">
            {app.databasesHeading}
          </h2>
          {!isDemo && (
            <Link href={`/${lang}/app/connections/new`} className={buttonVariants()}>
              {app.addConnection}
            </Link>
          )}
        </div>

        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6">
            <h3 className="font-medium">{app.noConnectionsTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{app.noConnectionsBody}</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {connections.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/${lang}/app/connections/${c.id}`}
                  data-testid="database-card"
                  className="flex h-full flex-col gap-2 rounded-xl border p-5 transition-colors hover:bg-muted/50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-lg font-semibold">{c.name}</span>
                    {c.isDemo && (
                      <span className={`${badge} bg-primary/10 text-primary`}>
                        {app.sampleBadge}
                      </span>
                    )}
                    {c.hasWriteAccess && (
                      <span className={`${badge} bg-destructive/10 text-destructive`}>
                        {app.writeBadge}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">{app.viewSchema}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {isDemo && <p className="text-sm text-muted-foreground">{app.demoCannotAdd}</p>}
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
