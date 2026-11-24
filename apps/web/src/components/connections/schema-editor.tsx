"use client";

import type { SchemaColumnView, SchemaTableView } from "@askdb/db";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";

import { Input } from "./field";

type Labels = {
  schemaTitle: string;
  refresh: string;
  refreshing: string;
  refreshed: string;
  delete: string;
  deleteConfirm: string;
  tablesCount: string;
  readOnlyDemo: string;
  truncated: string;
  writeWarning: string;
  failed: string;
  genericError: string;
  tableNote: string;
  columnNote: string;
  notePlaceholder: string;
  column: string;
  type: string;
  keys: string;
  hidden: string;
  hiddenHint: string;
  primaryKey: string;
  references: string;
  saved: string;
  saveFailed: string;
  columnsCount: string;
  viewKind: string;
};

type Connection = {
  id: string;
  name: string;
  hasWriteAccess: boolean;
  schemaTruncated: boolean;
  editable: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "failed";

async function patch(path: string, body: { description?: string; hidden?: boolean }) {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.ok;
}

function SaveIndicator({ state, labels }: { state: SaveState; labels: Labels }) {
  if (state === "saved")
    return <span className="text-xs text-muted-foreground">{labels.saved}</span>;
  if (state === "failed")
    return <span className="text-xs text-destructive">{labels.saveFailed}</span>;
  return null;
}

/** A note input that saves on blur, once per change. */
function NoteField({
  initial,
  path,
  label,
  labels,
  disabled,
}: {
  initial: string | null;
  path: string;
  label: string;
  labels: Labels;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [savedValue, setSavedValue] = useState(initial ?? "");
  const [state, setState] = useState<SaveState>("idle");

  async function save() {
    if (value.trim() === savedValue.trim()) return;
    setState("saving");
    const ok = await patch(path, { description: value });
    if (ok) setSavedValue(value);
    setState(ok ? "saved" : "failed");
  }

  if (disabled) {
    return initial ? <p className="text-sm text-muted-foreground">{initial}</p> : null;
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={label}
        value={value}
        maxLength={1000}
        placeholder={labels.notePlaceholder}
        onChange={(e) => {
          setValue(e.target.value);
          setState("idle");
        }}
        onBlur={save}
        className="py-1.5"
      />
      <SaveIndicator state={state} labels={labels} />
    </div>
  );
}

function HiddenToggle({
  column,
  path,
  labels,
  disabled,
}: {
  column: SchemaColumnView;
  path: string;
  labels: Labels;
  disabled: boolean;
}) {
  const [hidden, setHidden] = useState(column.hidden);
  const [state, setState] = useState<SaveState>("idle");

  async function toggle(next: boolean) {
    setHidden(next);
    setState("saving");
    const ok = await patch(path, { hidden: next });
    if (!ok) setHidden(!next);
    setState(ok ? "saved" : "failed");
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={hidden}
        disabled={disabled || state === "saving"}
        onChange={(e) => toggle(e.target.checked)}
        aria-label={`${labels.hidden}: ${column.name}`}
      />
      <SaveIndicator state={state} labels={labels} />
    </label>
  );
}

function TableCard({
  table,
  connectionId,
  labels,
  editable,
}: {
  table: SchemaTableView;
  connectionId: string;
  labels: Labels;
  editable: boolean;
}) {
  const base = `/api/connections/${connectionId}`;
  return (
    <details className="group rounded-xl border" data-testid={`table-${table.name}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4">
        <span className="font-mono text-sm font-semibold" dir="ltr">
          {table.schema === "public" ? table.name : `${table.schema}.${table.name}`}
        </span>
        <span className="text-xs text-muted-foreground">
          {labels.columnsCount.replace("{count}", String(table.columns.length))}
          {table.kind === "view" ? ` · ${labels.viewKind}` : ""}
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t p-4">
        <NoteField
          initial={table.description}
          path={`${base}/tables/${table.id}`}
          label={`${labels.tableNote}: ${table.name}`}
          labels={labels}
          disabled={!editable}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{labels.column}</th>
                <th className="py-2 pe-3 text-start font-medium">{labels.type}</th>
                <th className="py-2 pe-3 text-start font-medium">{labels.keys}</th>
                <th className="py-2 pe-3 text-start font-medium">{labels.columnNote}</th>
                <th className="py-2 text-start font-medium">{labels.hidden}</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((column) => (
                <tr
                  key={column.id}
                  className="border-b last:border-0"
                  data-testid={`column-${column.name}`}
                >
                  <td className="py-2 pe-3 font-mono" dir="ltr">
                    {column.name}
                  </td>
                  <td className="py-2 pe-3 font-mono text-xs text-muted-foreground" dir="ltr">
                    {column.dataType}
                  </td>
                  <td className="py-2 pe-3 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {column.isPrimaryKey && (
                        <span className="rounded bg-muted px-1.5 py-0.5">{labels.primaryKey}</span>
                      )}
                      {column.fkRef && (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 font-mono whitespace-nowrap"
                          dir="ltr"
                        >
                          {labels.references
                            .replace("{table}", column.fkRef.table)
                            .replace("{column}", column.fkRef.column)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="w-full py-2 pe-3">
                    <NoteField
                      initial={column.description}
                      path={`${base}/columns/${column.id}`}
                      label={`${labels.columnNote}: ${table.name}.${column.name}`}
                      labels={labels}
                      disabled={!editable}
                    />
                  </td>
                  <td className="py-2">
                    <HiddenToggle
                      column={column}
                      path={`${base}/columns/${column.id}`}
                      labels={labels}
                      disabled={!editable}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export function SchemaEditor({
  lang,
  labels,
  connection,
  tables,
}: {
  lang: Locale;
  labels: Labels;
  connection: Connection;
  tables: SchemaTableView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"refresh" | "delete" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const base = `/api/connections/${connection.id}`;

  async function refresh() {
    setPending("refresh");
    setMessage(null);
    try {
      const response = await fetch(`${base}/refresh`, { method: "POST" });
      if (response.ok) {
        setMessage({ kind: "ok", text: labels.refreshed });
        router.refresh();
      } else {
        setMessage({
          kind: "error",
          text: response.status === 422 ? labels.failed : labels.genericError,
        });
      }
    } catch {
      setMessage({ kind: "error", text: labels.genericError });
    }
    setPending(null);
  }

  async function remove() {
    if (!window.confirm(labels.deleteConfirm)) return;
    setPending("delete");
    const response = await fetch(base, { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      router.push(`/${lang}/app`);
      router.refresh();
      return;
    }
    setMessage({ kind: "error", text: labels.genericError });
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{connection.name}</h1>
          <p className="text-sm text-muted-foreground">
            {labels.schemaTitle} · {labels.tablesCount.replace("{count}", String(tables.length))}
          </p>
        </div>
        {connection.editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refresh} disabled={pending !== null}>
              {pending === "refresh" ? labels.refreshing : labels.refresh}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending !== null}>
              {labels.delete}
            </Button>
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="flex flex-col gap-2 text-sm empty:hidden">
        {message && (
          <p
            className={
              message.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
            }
          >
            {message.text}
          </p>
        )}
      </div>
      {connection.hasWriteAccess && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {labels.writeWarning}
        </p>
      )}
      {!connection.editable && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {labels.readOnlyDemo}
        </p>
      )}
      {connection.schemaTruncated && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{labels.truncated}</p>
      )}
      <p className="text-xs text-muted-foreground">{labels.hiddenHint}</p>

      <div className="flex flex-col gap-3">
        {tables.map((table) => (
          <TableCard
            key={table.id}
            table={table}
            connectionId={connection.id}
            labels={labels}
            editable={connection.editable}
          />
        ))}
      </div>
    </div>
  );
}
