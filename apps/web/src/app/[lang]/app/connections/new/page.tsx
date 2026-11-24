import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { NewConnectionForm } from "@/components/connections/new-connection-form";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireUser } from "@/lib/session";

/** Guests cannot add connections; send them back to the dashboard. */
async function RequireNonDemo({ lang }: { lang: Locale }) {
  const user = await requireUser(lang);
  if (user.role === "demo") redirect(`/${lang}/app`);
  return null;
}

export default async function NewConnectionPage({
  params,
}: PageProps<"/[lang]/app/connections/new">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { connections } = await getDictionary(lang);

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Suspense>
        <RequireNonDemo lang={lang} />
      </Suspense>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{connections.newTitle}</h1>
        <p className="text-pretty text-muted-foreground">{connections.newSubtitle}</p>
      </div>
      <NewConnectionForm lang={lang} labels={connections} />
    </div>
  );
}
