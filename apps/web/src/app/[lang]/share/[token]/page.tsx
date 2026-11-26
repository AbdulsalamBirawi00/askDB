import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { loadSharedDashboard } from "@/lib/dashboards";

type Props = PageProps<"/[lang]/share/[token]">;

// A share link is private to whoever has it: keep it out of search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Public and read-only: the last cached results only. Never runs a query. */
async function Shared({ params }: Pick<Props, "params">) {
  const { lang, token } = await params;
  if (!isLocale(lang) || !TOKEN.test(token)) notFound();
  const [dictionary, dashboard] = await Promise.all([
    getDictionary(lang),
    loadSharedDashboard(token),
  ]);
  if (!dashboard) notFound();
  return (
    <DashboardView
      initial={dashboard}
      lang={lang}
      labels={dictionary.dashboards}
      askLabels={dictionary.ask}
      readOnly
    />
  );
}

export default function SharePage({ params }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="border-b pb-4">
        <span className="font-heading text-lg font-semibold">AskDB</span>
      </header>
      <main className="flex flex-col gap-6">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
          <Shared params={params} />
        </Suspense>
      </main>
    </div>
  );
}
