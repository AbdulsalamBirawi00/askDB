"use client";

import { LayoutDashboard, Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";

type Labels = Dictionary["ask"];
type Choice = { id: string; title: string };

/**
 * "Add to dashboard" on a result that ran. Only the logged query's id is sent: the server
 * takes the SQL, chart type, and question (the card title) from the log.
 */
export function PinButton({
  queryId,
  lang,
  labels,
}: {
  queryId: string;
  lang: Locale;
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const [dashboards, setDashboards] = useState<Choice[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboards");
      if (!response.ok) throw new Error(`list failed: ${response.status}`);
      setDashboards(((await response.json()) as { dashboards: Choice[] }).dashboards);
    } catch {
      setDashboards([]);
    }
  }

  async function pin(target: { id: string; title: string } | { newTitle: string }) {
    setBusy(true);
    setError(null);
    try {
      const response =
        "id" in target
          ? await fetch(`/api/dashboards/${encodeURIComponent(target.id)}/items`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ queryId }),
            })
          : await fetch("/api/dashboards", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: target.newTitle, queryId }),
            });
      if (response.status === 409) {
        setError(labels.dashboardFull);
        return;
      }
      if (!response.ok) throw new Error(`pin failed: ${response.status}`);
      const body = (await response.json()) as { id: string; dashboardId?: string };
      setDone(
        "id" in target
          ? { id: target.id, title: target.title }
          : { id: body.id, title: target.newTitle },
      );
      setOpen(false);
    } catch {
      setError(labels.pinFailed);
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    const title = name.trim();
    if (title) void pin({ newTitle: title });
  }

  if (done) {
    return (
      <p
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        data-testid="pinned"
      >
        <span dir="auto">{labels.pinned.replace("{title}", done.title)}</span>
        <Link
          href={`/${lang}/app/dashboards/${done.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {labels.openDashboard}
        </Link>
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={show}>
        <LayoutDashboard aria-hidden />
        {labels.addToDashboard}
      </Button>
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-xl border p-3 text-sm sm:w-auto sm:min-w-72"
      data-testid="pin-panel"
    >
      <p className="text-muted-foreground">{labels.pinTo}</p>
      {dashboards === null ? (
        <p className="animate-pulse text-muted-foreground">…</p>
      ) : (
        dashboards.length > 0 && (
          <ul className="flex flex-col gap-1">
            {dashboards.map((d) => (
              <li key={d.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="w-full justify-start"
                  onClick={() => pin(d)}
                >
                  <span dir="auto" className="truncate">
                    {d.title}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )
      )}
      <form onSubmit={create} className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={labels.newDashboardPlaceholder}
          aria-label={labels.newDashboard}
          maxLength={120}
          dir="auto"
          className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <Plus aria-hidden />
          {labels.create}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => setOpen(false)}
      >
        {labels.cancel}
      </Button>
    </div>
  );
}
