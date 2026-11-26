"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";

/** Creates an empty dashboard and opens it. */
export function CreateDashboard({
  lang,
  labels,
}: {
  lang: Locale;
  labels: Dictionary["dashboards"];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (!response.ok) throw new Error(`create failed: ${response.status}`);
      const { id } = (await response.json()) as { id: string };
      router.push(`/${lang}/app/dashboards/${id}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={labels.createPlaceholder}
        aria-label={labels.create}
        maxLength={120}
        dir="auto"
        className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
      />
      <Button type="submit" disabled={busy || !title.trim()}>
        <Plus aria-hidden />
        {labels.createButton}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {labels.error}
        </p>
      )}
    </form>
  );
}
