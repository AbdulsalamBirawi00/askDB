"use client";

import { History } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { HistorySidebar, type ConversationItem } from "@/components/ask/history-sidebar";
import type { Rating } from "@/components/ask/rating";
import { TurnView, type LiveTurn, type SavedTurn, type Turn } from "@/components/ask/turn-view";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { readAskStream, type AskResponse } from "@/lib/ask-stream";
import { cn } from "@/lib/utils";

type Labels = Dictionary["ask"];

export type InitialConversation = { id: string; turns: SavedTurn[] };

const NEW_LIVE: LiveTurn = {
  pending: true,
  stage: "understanding",
  attempt: 1,
  answer: null,
  summary: "",
  summarizing: false,
  failure: null,
};

const toRating = (value: number | null): Rating => (value === 1 ? 1 : value === -1 ? -1 : null);

const savedTurn = (saved: SavedTurn): Turn => ({
  key: saved.id,
  question: saved.question,
  queryId: saved.id,
  rating: toRating(saved.rating),
  live: null,
  saved,
});

/**
 * A conversation with the database: each question is a turn (progress, then the result,
 * chart, table, SQL and summary), and follow-ups go to the same conversation so the model
 * sees the last questions. The sidebar lists, searches, reopens and deletes conversations;
 * the open one is in the URL (`?c=`).
 */
export function AskBox({
  connectionId,
  lang,
  labels,
  initialConversation,
  initialConversations,
}: {
  connectionId: string;
  lang: Locale;
  labels: Labels;
  initialConversation: InitialConversation | null;
  initialConversations: ConversationItem[];
}) {
  const pathname = usePathname();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => initialConversation?.turns.map(savedTurn) ?? []);
  const [conversationId, setConversationId] = useState(initialConversation?.id ?? null);
  const [conversations, setConversations] = useState(initialConversations);
  const [search, setSearch] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Read by async work that outlives a render.
  const current = useRef(conversationId);
  const searchText = useRef("");
  const inFlight = useRef<AbortController | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextKey = useRef(0);
  const scrollTo = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const busy = turns.some((t) => t.live?.pending);

  useEffect(() => {
    if (!scrollTo.current) return;
    document
      .querySelector(`[data-turn-key="${scrollTo.current}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    scrollTo.current = null;
  }, [turns.length]);

  useEffect(
    () => () => {
      inFlight.current?.abort();
      listRequest.current?.abort();
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const hrefFor = (id: string) => `${pathname}?c=${encodeURIComponent(id)}`;

  function showConversation(id: string | null) {
    current.current = id;
    setConversationId(id);
    window.history.replaceState(null, "", id ? hrefFor(id) : pathname);
  }

  async function refreshList(q = searchText.current) {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setListLoading(true);
    try {
      const params = new URLSearchParams({ connectionId });
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(`/api/conversations?${params}`, { signal: controller.signal });
      if (!response.ok) return;
      const body = (await response.json()) as { conversations: ConversationItem[] };
      setConversations(body.conversations);
    } catch {
      // Aborted by a newer search, or offline: keep the current list.
    } finally {
      if (listRequest.current === controller) setListLoading(false);
    }
  }

  function onSearch(q: string) {
    setSearch(q);
    searchText.current = q;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void refreshList(q), 300);
  }

  /** Adds a turn at the end and returns functions that update its live state. */
  function addTurn(text: string, stage: LiveTurn["stage"]) {
    const key = `t${nextKey.current++}`;
    scrollTo.current = key;
    setTurns((ts) => [
      ...ts,
      {
        key,
        question: text,
        queryId: null,
        rating: null,
        saved: null,
        live: { ...NEW_LIVE, stage },
      },
    ]);
    const patch = (change: (live: LiveTurn) => Partial<Turn>) =>
      setTurns((ts) => ts.map((t) => (t.key === key && t.live ? { ...t, ...change(t.live) } : t)));
    const fail = (failure: string) =>
      patch((live) => ({
        live: { ...live, pending: false, stage: null, summarizing: false, failure },
      }));
    return { patch, fail };
  }

  function startRequest() {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setNotice(null);
    return controller;
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion("");
    const controller = startRequest();
    const { patch, fail } = addTurn(q, "understanding");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId,
          question: q,
          conversationId: current.current ?? undefined,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        fail(
          response.status === 429
            ? labels.dailyLimit
            : response.status === 503
              ? labels.unavailable
              : labels.genericError,
        );
        return;
      }
      for await (const event of readAskStream(response.body)) {
        if (event.type === "stage") {
          patch((live) => ({ live: { ...live, stage: event.stage, attempt: event.attempt } }));
        } else if (event.type === "result") {
          const { result } = event;
          if (current.current !== result.conversationId) showConversation(result.conversationId);
          const summarizing = result.status === "ok" && result.rows.length > 0;
          patch((live) => ({
            queryId: result.queryId,
            live: { ...live, stage: null, answer: result, summarizing },
          }));
        } else if (event.type === "summary") {
          patch((live) => ({ live: { ...live, summary: live.summary + event.text } }));
        } else if (event.type === "failure") {
          fail(
            event.code === "unavailable"
              ? labels.unavailable
              : event.code === "connection"
                ? labels.connectionFailed
                : labels.genericError,
          );
          return;
        }
      }
      patch((live) => ({ live: { ...live, pending: false, stage: null, summarizing: false } }));
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      fail(labels.genericError);
    } finally {
      if (!controller.signal.aborted) void refreshList();
    }
  }

  /** Runs edited (or unchanged) SQL of an earlier turn on the server, as a new turn. */
  async function runSql(from: Turn, sql: string) {
    if (!from.queryId || busy) return;
    const controller = startRequest();
    const { patch, fail } = addTurn(from.question, "running");
    try {
      const response = await fetch("/api/sql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queryId: from.queryId, sql }),
        signal: controller.signal,
      });
      if (!response.ok) {
        fail(response.status === 502 ? labels.connectionFailed : labels.genericError);
        return;
      }
      const { result } = (await response.json()) as { result: AskResponse };
      patch((live) => ({
        queryId: result.queryId,
        live: { ...live, pending: false, stage: null, answer: result },
      }));
      void refreshList();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      fail(labels.genericError);
    }
  }

  async function rate(turn: Turn, rating: Rating) {
    if (!turn.queryId) return;
    const before = turn.rating;
    const set = (value: Rating) =>
      setTurns((ts) => ts.map((t) => (t.key === turn.key ? { ...t, rating: value } : t)));
    set(rating);
    try {
      const response = await fetch(`/api/queries/${encodeURIComponent(turn.queryId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      if (!response.ok) throw new Error(`rating failed: ${response.status}`);
    } catch {
      set(before);
      setNotice(labels.genericError);
    }
  }

  function newConversation() {
    inFlight.current?.abort();
    setTurns([]);
    setQuestion("");
    setNotice(null);
    setHistoryOpen(false);
    showConversation(null);
    input.current?.focus();
  }

  async function openConversation(id: string) {
    if (id === current.current && !busy) {
      setHistoryOpen(false);
      return;
    }
    inFlight.current?.abort();
    setNotice(null);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      if (response.status === 404) {
        setConversations((cs) => cs.filter((c) => c.id !== id));
        newConversation();
        return;
      }
      if (!response.ok) throw new Error(`open failed: ${response.status}`);
      const { conversation } = (await response.json()) as { conversation: InitialConversation };
      setTurns(conversation.turns.map(savedTurn));
      setQuestion("");
      setHistoryOpen(false);
      showConversation(conversation.id);
    } catch {
      setNotice(labels.genericError);
    }
  }

  async function deleteConversation(id: string) {
    if (!window.confirm(labels.deleteConfirm)) return;
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`delete failed: ${response.status}`);
      }
      setConversations((cs) => cs.filter((c) => c.id !== id));
      if (current.current === id) newConversation();
    } catch {
      setNotice(labels.genericError);
    }
  }

  function editQuestion(text: string) {
    setQuestion(text);
    input.current?.focus();
    requestAnimationFrame(() => input.current?.select());
  }

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
      <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
        <Button
          type="button"
          variant="outline"
          className="justify-start lg:hidden"
          aria-expanded={historyOpen}
          aria-controls="ask-history"
          onClick={() => setHistoryOpen((open) => !open)}
        >
          <History aria-hidden />
          {labels.history}
        </Button>
        <div id="ask-history" className={cn(historyOpen ? "block" : "hidden", "lg:block")}>
          <HistorySidebar
            conversations={conversations}
            currentId={conversationId}
            search={search}
            loading={listLoading}
            hrefFor={hrefFor}
            labels={labels}
            onSearch={onSearch}
            onOpen={(id) => void openConversation(id)}
            onNew={newConversation}
            onDelete={(id) => void deleteConversation(id)}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-8">
        {turns.map((turn) => (
          <div key={turn.key} data-turn-key={turn.key} className="min-w-0 scroll-mt-6">
            <TurnView
              turn={turn}
              lang={lang}
              labels={labels}
              busy={busy}
              onEditQuestion={editQuestion}
              onRunSql={(from, sql) => void runSql(from, sql)}
              onRate={(t, r) => void rate(t, r)}
            />
          </div>
        ))}

        {notice && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {notice}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label className="sr-only" htmlFor="question">
              {labels.label}
            </label>
            <input
              ref={input}
              id="question"
              name="question"
              value={question}
              maxLength={1000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={turns.length ? labels.followUpPlaceholder : labels.placeholder}
              dir="auto"
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" disabled={busy || !question.trim()}>
              {busy ? labels.asking : labels.submit}
            </Button>
          </form>

          {turns.length === 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{labels.examplesLabel}</span>
              {labels.examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  dir="auto"
                  disabled={busy}
                  onClick={() => void ask(example)}
                  className="rounded-full border px-3 py-1 hover:bg-muted disabled:opacity-50"
                  data-testid="example-question"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
