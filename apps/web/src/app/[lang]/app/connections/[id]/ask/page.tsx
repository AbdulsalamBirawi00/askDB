import { getConversationHistory, getVisibleConnection, listConversations } from "@askdb/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AskBox } from "@/components/ask/ask-box";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Props = PageProps<"/[lang]/app/connections/[id]/ask">;

async function Ask({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ lang, id }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(lang)) notFound();
  const [dictionary, user] = await Promise.all([getDictionary(lang), requireUser(lang)]);
  const connection = await getVisibleConnection(getDb(), id, user.id);
  if (!connection) notFound();
  const labels = dictionary.ask;

  // ?c= reopens a conversation. Someone else's (or one on another connection) is a 404.
  const c = typeof query.c === "string" ? query.c : null;
  const [opened, conversations] = await Promise.all([
    c ? getConversationHistory(getDb(), { id: c, userId: user.id }) : null,
    listConversations(getDb(), { userId: user.id, connectionId: connection.id }),
  ]);
  if (c && opened?.connectionId !== connection.id) notFound();
  const initialConversation = opened
    ? {
        id: opened.id,
        turns: opened.turns.map((turn) => ({
          id: turn.id,
          question: turn.question,
          sql: turn.sql,
          status: turn.status,
          error: turn.error,
          explanation: turn.explanation,
          rating: turn.rating,
          repaired: turn.repaired,
          edited: turn.edited,
        })),
      }
    : null;

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
      <AskBox
        connectionId={connection.id}
        lang={lang}
        labels={labels}
        initialConversation={initialConversation}
        initialConversations={conversations.map(({ id, title, questionCount }) => ({
          id,
          title,
          questionCount,
        }))}
      />
    </>
  );
}

export default function AskPage({ params, searchParams }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-muted" />}>
        <Ask params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
