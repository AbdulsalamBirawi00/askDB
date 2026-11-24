import { getConnectionSchema, getVisibleConnection } from "@askdb/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SchemaEditor } from "@/components/connections/schema-editor";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Params = PageProps<"/[lang]/app/connections/[id]">["params"];

/** The connection id is only known at request time, so all of this streams behind <Suspense>. */
async function ConnectionSchema({ params }: { params: Params }) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const [{ connections: labels, ask }, user] = await Promise.all([
    getDictionary(lang),
    requireUser(lang),
  ]);
  const db = getDb();
  const [connection, tables] = await Promise.all([
    getVisibleConnection(db, id, user.id),
    getConnectionSchema(db, id, user.id),
  ]);
  // Someone else's connection looks exactly like a missing one.
  if (!connection || !tables) notFound();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/${lang}/app`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {labels.back}
        </Link>
        <Link
          href={`/${lang}/app/connections/${connection.id}/ask`}
          data-testid="ask-link"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {ask.askLink}
        </Link>
      </div>
      <SchemaEditor
        lang={lang}
        labels={labels}
        connection={{
          id: connection.id,
          name: connection.name,
          hasWriteAccess: connection.hasWriteAccess,
          schemaTruncated: connection.schemaTruncated,
          // Only the owner can edit; the shared demo is read-only for everyone else.
          editable: !connection.isDemo,
        }}
        tables={tables}
      />
    </>
  );
}

export default function ConnectionPage({ params }: PageProps<"/[lang]/app/connections/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-muted" />}>
        <ConnectionSchema params={params} />
      </Suspense>
    </div>
  );
}
