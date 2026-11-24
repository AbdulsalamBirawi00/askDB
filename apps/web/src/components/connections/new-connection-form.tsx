"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";

import { Input } from "./field";

type Labels = {
  name: string;
  namePlaceholder: string;
  url: string;
  urlHint: string;
  test: string;
  testing: string;
  save: string;
  saving: string;
  testOk: string;
  writeWarning: string;
  failed: string;
  invalid: string;
  blocked: string;
  genericError: string;
};

type Status =
  { kind: "idle" } | { kind: "ok"; hasWriteAccess: boolean } | { kind: "error"; message: string };

/** Maps an API error code to a translated message; never shows server details. */
function errorMessage(labels: Labels, code: unknown): string {
  if (code === "connection_failed") return labels.failed;
  if (code === "blocked_host") return labels.blocked;
  if (code === "invalid_url") return labels.invalid;
  return labels.genericError;
}

export function NewConnectionForm({ lang, labels }: { lang: Locale; labels: Labels }) {
  const router = useRouter();
  const ids = { name: useId(), url: useId(), hint: useId() };
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<"test" | "save" | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function call(path: string, body: object) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json().catch(() => ({}));
    return { ok: response.ok, data: data as Record<string, unknown> };
  }

  async function test() {
    setPending("test");
    try {
      const { ok, data } = await call("/api/connections/test", { url });
      setStatus(
        ok
          ? { kind: "ok", hasWriteAccess: data.hasWriteAccess === true }
          : { kind: "error", message: errorMessage(labels, data.code) },
      );
    } catch {
      setStatus({ kind: "error", message: labels.genericError });
    } finally {
      setPending(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending("save");
    try {
      const { ok, data } = await call("/api/connections", { name, url });
      const connection = data.connection as { id?: string } | undefined;
      if (ok && connection?.id) {
        router.push(`/${lang}/app/connections/${connection.id}`);
        return;
      }
      setStatus({ kind: "error", message: errorMessage(labels, data.code) });
    } catch {
      setStatus({ kind: "error", message: labels.genericError });
    }
    setPending(null);
  }

  const busy = pending !== null;
  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.name} className="text-sm font-medium">
          {labels.name}
        </label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={labels.namePlaceholder}
          maxLength={100}
          required
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.url} className="text-sm font-medium">
          {labels.url}
        </label>
        <Input
          id={ids.url}
          type="password"
          dir="ltr"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setStatus({ kind: "idle" });
          }}
          aria-describedby={ids.hint}
          autoComplete="off"
          spellCheck={false}
          required
          disabled={busy}
        />
        <p id={ids.hint} dir="ltr" className="text-start text-xs break-all text-muted-foreground">
          {labels.urlHint}
        </p>
      </div>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {status.kind === "ok" && (
          <div className="flex flex-col gap-2">
            <p className="text-emerald-700 dark:text-emerald-400">{labels.testOk}</p>
            {status.hasWriteAccess && (
              <p className="rounded-lg bg-destructive/10 p-3 text-destructive">
                {labels.writeWarning}
              </p>
            )}
          </div>
        )}
        {status.kind === "error" && <p className="text-destructive">{status.message}</p>}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" size="lg" onClick={test} disabled={busy || !url}>
          {pending === "test" ? labels.testing : labels.test}
        </Button>
        <Button type="submit" size="lg" disabled={busy || !url || !name.trim()}>
          {pending === "save" ? labels.saving : labels.save}
        </Button>
      </div>
    </form>
  );
}
