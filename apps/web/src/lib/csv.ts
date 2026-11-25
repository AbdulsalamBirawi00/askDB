/**
 * CSV export, built in the browser from the rows already on screen (no request).
 * UTF-8 with a BOM so Excel opens Arabic text correctly; CRLF line endings (RFC 4180).
 */
import type { ColumnKind } from "@askdb/core";

const BOM = "﻿";

/** Text starting with these can run as a formula in a spreadsheet (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (kind === "text" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(
  columns: { name: string; kind: ColumnKind }[],
  rows: Record<string, unknown>[],
): string {
  const header = columns.map((c) => cell(c.name, "text")).join(",");
  const lines = rows.map((row) => columns.map((c) => cell(row[c.name], c.kind)).join(","));
  return `${BOM}${[header, ...lines].join("\r\n")}\r\n`;
}

/** e.g. askdb-2026-11-25.csv */
export const csvFileName = (now = new Date()) => `askdb-${now.toISOString().slice(0, 10)}.csv`;

export function downloadCsv(csv: string, fileName = csvFileName()): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
