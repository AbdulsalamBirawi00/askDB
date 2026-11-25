"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/** Token colors from the theme (globals.css), so the editor follows light and dark mode. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword], color: "var(--chart-1)", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--chart-2)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--chart-4)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--muted-foreground)" },
  { tag: tags.typeName, color: "var(--chart-3)" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "12px" },
  "&.cm-focused": { outline: "2px solid var(--ring)" },
  ".cm-content": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    caretColor: "var(--foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    borderInlineEnd: "1px solid var(--border)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--chart-1) 25%, transparent)",
  },
  ".cm-scroller": { minHeight: "6rem", maxHeight: "20rem" },
});

/**
 * A PostgreSQL editor (CodeMirror 6). Loaded only when someone edits SQL. Mod-Enter runs.
 * Tab is left to the browser, so keyboard users can leave the editor.
 */
export function SqlEditor({
  initial,
  label,
  onChange,
  onSubmit,
}: {
  initial: string;
  label: string;
  onChange: (sql: string) => void;
  onSubmit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSubmit });
  useEffect(() => {
    handlers.current = { onChange, onSubmit };
  });

  // Created once; the document then belongs to the editor.
  const initialDoc = useRef(initial);
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialDoc.current,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          sql({ dialect: PostgreSQL, upperCaseKeywords: false }),
          syntaxHighlighting(highlight),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                handlers.current.onSubmit();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": label,
            "data-testid": "sql-editor-input",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
          theme,
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
  }, [label]);

  return (
    <div
      ref={host}
      dir="ltr"
      className="overflow-hidden rounded-lg border"
      data-testid="sql-editor"
    />
  );
}
