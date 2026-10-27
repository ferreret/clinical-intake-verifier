"use client";

/**
 * Searching the lab's records by hand, for the patient, physician or insurer the document is
 * about when the engine did not link it (or linked another). Choosing one links the document
 * to it, and the fields are compared with that record instead; "no record" says it is a new
 * one. Nothing is stored until the document is approved with the link.
 */
import { useEffect, useRef, useState } from "react";

import { api, type RecordKind, type RecordView } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { Search, X } from "../../../_ui/icons";

const DEBOUNCE_MS = 150;

export function RecordSearch({
  kind,
  current,
  chosen,
  onPick,
  onReset,
  onClose,
}: {
  kind: RecordKind;
  /** The record the document is linked to now, if any. */
  current: string | null;
  /** Whether the current link is the technician's choice, which can be undone. */
  chosen: boolean;
  onPick: (id: string | null) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const r = t.records;
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; results: RecordView[] } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      api.searchRecords(kind, q, ctl.signal).then(
        (res) => {
          setFound({ query: q, results: res.results });
          setActive(0);
        },
        () => undefined,
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [kind, query]);

  const typed = query.trim() !== "";
  const results = typed && found?.query === query.trim() ? found.results : [];
  const searching = typed && found?.query !== query.trim();

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/30 p-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={r.search[kind]} className="card w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4">
          <Search className="size-4 shrink-0 text-slate-400" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                onPick(results[active].id);
              }
            }}
            placeholder={r.searchHint[kind]}
            aria-label={r.search[kind]}
            className="min-w-0 flex-1 py-3.5 text-sm focus:outline-none"
          />
          <button type="button" onClick={onClose} aria-label={t.verify.close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{r.search[kind]}</div>
        <ul className="max-h-80 overflow-y-auto pb-1" role="listbox">
          {results.map((rec, i) => (
            <li key={rec.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(rec.id)}
                className={`flex w-full min-w-0 items-baseline gap-2 px-4 py-2 text-left ${i === active ? "bg-brand-50" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{rec.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{t.server(rec.detail)}</span>
                {rec.id === current && <span className="shrink-0 text-[10px] font-medium text-emerald-700">✓</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-4 py-2 text-sm text-slate-400">{searching ? t.codes.searching : typed ? r.nothingFound : r.typeToSearch}</li>
          )}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-white"
          >
            {r.noRecord[kind]}
          </button>
          {chosen && (
            <button type="button" onClick={onReset} className="ml-auto text-xs text-slate-500 underline-offset-2 hover:underline">
              {r.reset}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
