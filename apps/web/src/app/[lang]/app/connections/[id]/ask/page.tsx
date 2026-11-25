import { getVisibleConnection } from "@askdb/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AskBox } from "@/components/ask/ask-box";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Params = PageProps<"/[lang]/app/connections/[id]/ask">["params"];

async function Ask({ params }: { params: Params }) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const [dictionary, user] = await Promise.all([getDictionary(lang), requireUser(lang)]);
  const connection = await getVisibleConnection(getDb(), id, user.id);
  if (!connection) notFound();
  const labels = dictionary.ask;

  return (
    <>
      <Link
        href={`/${lang}/app/connections/${id}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {dictionary.connections.back}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{labels.title}</h1>
        <p className="text-sm text-muted-foreground">
          {connection.name} · {labels.subtitle}
        </p>
      </div>
      <AskBox connectionId={connection.id} lang={lang} labels={labels} />
    </>
  );
}

export default function AskPage({ params }: PageProps<"/[lang]/app/connections/[id]/ask">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-muted" />}>
        <Ask params={params} />
      </Suspense>
    </div>
  );
}
