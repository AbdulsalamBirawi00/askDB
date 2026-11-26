import { listDashboards } from "@askdb/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CreateDashboard } from "@/components/dashboard/create-dashboard";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

async function List({ lang, labels }: { lang: Locale; labels: Dictionary["dashboards"] }) {
  const user = await requireUser(lang);
  const dashboards = await listDashboards(getDb(), user.id);
  if (dashboards.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {labels.empty}
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {dashboards.map((d) => (
        <li key={d.id}>
          <Link
            href={`/${lang}/app/dashboards/${d.id}`}
            data-testid="dashboard-link"
            className="flex h-full flex-col gap-2 rounded-xl border p-5 transition-colors hover:bg-muted/50"
          >
            <span dir="auto" className="font-heading text-lg font-semibold break-words">
              {d.title}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {labels.cardCount.replace("{count}", String(d.itemCount))}
              {d.shared && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {labels.sharedBadge}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardsPage({ params }: PageProps<"/[lang]/app/dashboards">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { dashboards: labels } = await getDictionary(lang);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{labels.title}</h1>
        <p className="text-sm text-muted-foreground">{labels.subtitle}</p>
      </div>
      <CreateDashboard lang={lang} labels={labels} />
      <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-muted" />}>
        <List lang={lang} labels={labels} />
      </Suspense>
    </div>
  );
}
