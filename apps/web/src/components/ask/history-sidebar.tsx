"use client";

import { MessageSquarePlus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionaries";
import { cn } from "@/lib/utils";

export type ConversationItem = { id: string; title: string; questionCount: number };

type Labels = Dictionary["ask"];

/**
 * The conversations on this connection, newest activity first, with search. Items are
 * real links (`?c=`) so they open in a new tab; a plain click switches in place.
 */
export function HistorySidebar({
  conversations,
  currentId,
  search,
  loading,
  hrefFor,
  labels,
  onSearch,
  onOpen,
  onNew,
  onDelete,
}: {
  conversations: ConversationItem[];
  currentId: string | null;
  search: string;
  loading: boolean;
  hrefFor: (id: string) => string;
  labels: Labels;
  onSearch: (q: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <nav aria-label={labels.history} className="flex min-w-0 flex-col gap-3" data-testid="history">
      <Button type="button" variant="outline" onClick={onNew} className="justify-start">
        <MessageSquarePlus aria-hidden />
        {labels.newConversation}
      </Button>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={labels.searchHistory}
          aria-label={labels.searchHistory}
          maxLength={200}
          dir="auto"
          className="w-full rounded-lg border bg-background py-2 ps-8 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="history-search"
        />
      </div>
      {conversations.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground" data-testid="history-empty">
          {loading ? "…" : search.trim() ? labels.noMatches : labels.noConversations}
        </p>
      ) : (
        <ul className={cn("flex flex-col gap-1", loading && "opacity-60")}>
          {conversations.map((c) => (
            <li
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg hover:bg-muted",
                c.id === currentId && "bg-muted",
              )}
              data-testid="history-item"
            >
              <a
                href={hrefFor(c.id)}
                aria-current={c.id === currentId ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpen(c.id);
                }}
                className="flex min-w-0 flex-1 flex-col px-3 py-2"
              >
                <span dir="auto" className="truncate text-sm">
                  {c.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {labels.questionCount.replace("{count}", String(c.questionCount))}
                </span>
              </a>
              <button
                type="button"
                aria-label={`${labels.deleteConversation}: ${c.title}`}
                title={labels.deleteConversation}
                onClick={() => onDelete(c.id)}
                className="me-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                data-testid="history-delete"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
