import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { loadDashboard } from "@/lib/dashboards";
import { requireUser } from "@/lib/session";

type Props = PageProps<"/[lang]/app/dashboards/[id]">;

/** Opening a dashboard runs its cards' SQL (or uses the 5-minute cache). No model calls. */
async function Dashboard({ params }: Pick<Props, "params">) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const [dictionary, user] = await Promise.all([getDictionary(lang), requireUser(lang)]);
  const dashboard = await loadDashboard(user.id, id);
  if (!dashboard) notFound();
  return (
    <>
      <Link
        href={`/${lang}/app/dashboards`}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {dictionary.dashboards.back}
      </Link>
      <DashboardView
        key={dashboard.id}
        initial={dashboard}
        lang={lang}
        labels={dictionary.dashboards}
        askLabels={dictionary.ask}
      />
    </>
  );
}

export default function DashboardPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
        <Dashboard params={params} />
      </Suspense>
    </div>
  );
}
