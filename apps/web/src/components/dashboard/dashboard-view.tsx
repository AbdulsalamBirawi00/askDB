"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Copy, GripVertical, Pencil, RefreshCw, Share2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { CardBody } from "@/components/dashboard/card-body";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import type { DashboardCard, DashboardPayload } from "@/lib/dashboard-types";

type Labels = Dictionary["dashboards"];
type AskLabels = Dictionary["ask"];

const inputClass =
  "min-w-0 flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function time(iso: string | null, lang: Locale) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** A title that can be edited in place. */
function EditableTitle({
  value,
  label,
  labels,
  onSave,
  className,
  testId,
}: {
  value: string;
  label: string;
  labels: Labels;
  onSave: (title: string) => Promise<boolean>;
  className: string;
  testId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setSaving(true);
    if (await onSave(title)) setEditing(false);
    setSaving(false);
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span dir="auto" className={className} data-testid={testId}>
          {value}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={labels.titleLabel}
        maxLength={120}
        dir="auto"
        autoFocus
        className={inputClass}
      />
      <Button type="submit" size="icon-sm" aria-label={labels.save} disabled={saving}>
        <Check aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.cancel}
        onClick={() => setEditing(false)}
      >
        <X aria-hidden />
      </Button>
    </form>
  );
}

function Card({
  card,
  lang,
  labels,
  askLabels,
  readOnly,
  onRename,
  onDelete,
}: {
  card: DashboardCard;
  lang: Locale;
  labels: Labels;
  askLabels: AskLabels;
  readOnly: boolean;
  onRename: (title: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: readOnly });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 ${isDragging ? "z-10 shadow-lg" : ""}`}
      data-testid="dashboard-card"
    >
      <div className="flex items-start gap-1">
        {!readOnly && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`${labels.dragHandle}: ${card.title}`}
            className="mt-0.5 inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
            data-testid="drag-handle"
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {readOnly ? (
            <h2 dir="auto" className="font-medium break-words" data-testid="card-title">
              {card.title}
            </h2>
          ) : (
            <EditableTitle
              value={card.title}
              label={labels.rename}
              labels={labels}
              onSave={onRename}
              className="truncate font-medium"
              testId="card-title"
            />
          )}
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${labels.deleteCard}: ${card.title}`}
            title={labels.deleteCard}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>

      <CardBody result={card.result} lang={lang} askLabels={askLabels} labels={labels} />

      {card.cachedAt && (
        <p className="text-xs text-muted-foreground" data-testid="card-updated">
          <span suppressHydrationWarning>
            {labels.updated.replace("{time}", time(card.cachedAt, lang))}
          </span>
          {card.fromCache && !readOnly && <> · {labels.fromCache}</>}
        </p>
      )}
    </li>
  );
}

function SharePanel({
  dashboardId,
  lang,
  labels,
  token,
  onChange,
  onError,
}: {
  dashboardId: string;
  lang: Locale;
  labels: Labels;
  token: string | null;
  onChange: (token: string | null) => void;
  onError: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/${lang}/share/${token}`
    : "";

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`/api/dashboards/${encodeURIComponent(dashboardId)}/share`, {
        method: on ? "POST" : "DELETE",
      });
      if (!response.ok) throw new Error(`share failed: ${response.status}`);
      onChange(on ? ((await response.json()) as { shareToken: string }).shareToken : null);
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Button type="button" variant="outline" disabled={busy} onClick={() => toggle(true)}>
        <Share2 aria-hidden />
        {labels.share}
      </Button>
    );
  }
  return (
    <div
      className="flex w-full flex-col gap-2 rounded-xl border p-3 text-sm"
      data-testid="share-panel"
    >
      <p className="text-muted-foreground">{labels.shareOn}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label={labels.share}
          dir="ltr"
          className={inputClass}
          data-testid="share-url"
          onFocus={(e) => e.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy aria-hidden />
          {copied ? labels.copied : labels.copy}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => toggle(false)}
        >
          {labels.stopSharing}
        </Button>
      </div>
    </div>
  );
}

/**
 * A dashboard: cards in a grid. The owner can refresh, reorder (drag, or keyboard on the
 * handle), rename, delete, and share. `readOnly` (a share link) shows the cards only.
 */
export function DashboardView({
  initial,
  lang,
  labels,
  askLabels,
  readOnly = false,
}: {
  initial: DashboardPayload;
  lang: Locale;
  labels: Labels;
  askLabels: AskLabels;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [cards, setCards] = useState(initial.cards);
  const [shareToken, setShareToken] = useState(initial.shareToken);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/dashboards/${encodeURIComponent(initial.id)}`;
  const fail = () => setNotice(labels.error);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function send(url: string, method: string, body?: unknown): Promise<Response | null> {
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${method} ${url}: ${response.status}`);
      return response;
    } catch {
      fail();
      return null;
    }
  }

  async function refresh() {
    setRefreshing(true);
    const response = await send(`${base}/refresh`, "POST");
    if (response) {
      const { dashboard } = (await response.json()) as { dashboard: DashboardPayload };
      setCards(dashboard.cards);
    }
    setRefreshing(false);
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const before = cards;
    const from = cards.findIndex((c) => c.id === active.id);
    const to = cards.findIndex((c) => c.id === over.id);
    const next = arrayMove(cards, from, to);
    setCards(next);
    const saved = await send(`${base}/order`, "PUT", { itemIds: next.map((c) => c.id) });
    if (!saved) setCards(before);
  }

  async function renameCard(id: string, newTitle: string) {
    const ok = await send(`/api/dashboard-items/${encodeURIComponent(id)}`, "PATCH", {
      title: newTitle,
    });
    if (ok) setCards((cs) => cs.map((c) => (c.id === id ? { ...c, title: newTitle } : c)));
    return ok !== null;
  }

  async function deleteCard(card: DashboardCard) {
    if (!window.confirm(labels.deleteCardConfirm)) return;
    const ok = await send(`/api/dashboard-items/${encodeURIComponent(card.id)}`, "DELETE");
    if (ok) setCards((cs) => cs.filter((c) => c.id !== card.id));
  }

  async function deleteDashboard() {
    if (!window.confirm(labels.deleteDashboardConfirm)) return;
    if (await send(base, "DELETE")) router.push(`/${lang}/app/dashboards`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {readOnly ? (
          <h1 dir="auto" className="font-heading text-3xl font-bold tracking-tight">
            {title}
          </h1>
        ) : (
          <EditableTitle
            value={title}
            label={labels.renameDashboard}
            labels={labels}
            className="font-heading text-3xl font-bold tracking-tight break-words"
            testId="dashboard-title"
            onSave={async (t) => {
              const ok = await send(base, "PATCH", { title: t });
              if (ok) setTitle(t);
              return ok !== null;
            }}
          />
        )}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={refresh}
              disabled={refreshing || cards.length === 0}
            >
              <RefreshCw aria-hidden className={refreshing ? "animate-spin" : undefined} />
              {refreshing ? labels.refreshing : labels.refresh}
            </Button>
            {!shareToken && (
              <SharePanel
                dashboardId={initial.id}
                lang={lang}
                labels={labels}
                token={null}
                onChange={setShareToken}
                onError={fail}
              />
            )}
            <Button type="button" variant="destructive" onClick={deleteDashboard}>
              <Trash2 aria-hidden />
              {labels.deleteDashboard}
            </Button>
          </div>
        )}
      </div>

      {readOnly && <p className="text-sm text-muted-foreground">{labels.sharedReadOnly}</p>}
      {!readOnly && shareToken && (
        <SharePanel
          dashboardId={initial.id}
          lang={lang}
          labels={labels}
          token={shareToken}
          onChange={setShareToken}
          onError={fail}
        />
      )}

      {notice && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {notice}
        </p>
      )}

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          {labels.noCards}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
            <ul className="grid gap-4 md:grid-cols-2" data-testid="dashboard-cards">
              {cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  lang={lang}
                  labels={labels}
                  askLabels={askLabels}
                  readOnly={readOnly}
                  onRename={(t) => renameCard(card.id, t)}
                  onDelete={() => deleteCard(card)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
