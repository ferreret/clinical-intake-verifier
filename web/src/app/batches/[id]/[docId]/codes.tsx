"use client";

/**
 * A line's codes as the technician sets them: each code a chip that can be removed, and a
 * search to add any test or profile of the catalog, not only those proposed. With the search
 * empty, the line's own catalog candidates are offered; typing searches the whole catalog by
 * name or code (/api/catalog).
 */
import { useEffect, useRef, useState, type Ref } from "react";

import { api, type Candidate } from "../../../_ui/api";
import { Plus, Search, X } from "../../../_ui/icons";
import { codesKey } from "./model";

const DEBOUNCE_MS = 150;

export function CodeEditor({
  codes,
  names,
  proposed,
  suggestions,
  readOnly,
  addRef,
  onFocus,
  onChange,
  onNames,
}: {
  codes: string[];
  names: Record<string, string>;
  /** What the chain proposed, to go back to; null when it proposed nothing. */
  proposed: string[] | null;
  /** The line's catalog candidates, offered before anything is typed. */
  suggestions: Candidate[];
  readOnly: boolean;
  addRef?: Ref<HTMLButtonElement>;
  onFocus: () => void;
  onChange: (codes: string[]) => void;
  onNames: (names: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const changed = proposed !== null && codesKey(codes) !== codesKey(proposed);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {codes.map((c) => (
          <span
            key={c}
            className="inline-flex max-w-full min-w-0 items-center gap-1 rounded bg-white py-px pr-0.5 pl-1.5 text-xs ring-1 ring-slate-200"
            title={names[c]}
          >
            <span className="font-mono text-[11px] font-semibold text-brand-700">{c}</span>
            <span className="truncate text-slate-600">{names[c] ?? ""}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(codes.filter((x) => x !== c))}
                className="rounded p-0.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700"
                aria-label={`Remove ${c}`}
                title="Remove this code"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && !open && (
          <button
            ref={addRef}
            type="button"
            onFocus={onFocus}
            onClick={() => setOpen(true)}
            title="Add a code from the catalog"
            aria-label={codes.length === 0 ? "Choose the codes" : "Add a code"}
            className={`inline-flex items-center gap-1 rounded py-0.5 text-xs font-medium ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
              codes.length === 0 ? "bg-red-50/60 px-1.5 text-red-700 ring-red-200 hover:bg-red-50" : "px-1 text-brand-700 ring-brand-200 hover:bg-brand-50"
            }`}
          >
            <Plus className="size-3" />
            {codes.length === 0 && "Choose the codes"}
          </button>
        )}
        {!readOnly && !open && changed && (
          <button type="button" onClick={() => onChange(proposed)} className="ml-0.5 text-[11px] text-slate-500 underline-offset-2 hover:underline">
            Back to proposed
          </button>
        )}
      </div>
      {open && (
        <Picker
          codes={codes}
          suggestions={suggestions}
          onPick={(c, found) => {
            onNames(found);
            onChange([...new Set([...codes, ...c.codes])]);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function Picker({
  codes,
  suggestions,
  onPick,
  onClose,
}: {
  codes: string[];
  suggestions: Candidate[];
  onPick: (c: Candidate, names: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; results: Candidate[]; names: Record<string, string> } | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      api.catalog(q, ctl.signal).then(
        (r) => {
          setFound({ query: q, ...r });
          setActive(0);
        },
        () => undefined,
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [query]);

  // Closing on a click elsewhere, as a menu does.
  useEffect(() => {
    function away(e: PointerEvent) {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);

  const typed = query.trim() !== "";
  const has = (c: Candidate) => c.codes.every((x) => codes.includes(x));
  const list = (typed ? (found?.query === query.trim() ? found.results : []) : suggestions).filter((c) => !has(c));
  const names = typed ? (found?.names ?? {}) : {};
  const searching = typed && found?.query !== query.trim();

  return (
    <div ref={box} className="rounded-lg bg-white shadow-lift ring-1 ring-brand-200">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-2">
        <Search className="size-3.5 shrink-0 text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && list[active]) {
              e.preventDefault();
              onPick(list[active], names);
            }
          }}
          placeholder="Search the catalog: name or code"
          aria-label="Search the catalog"
          className="min-w-0 flex-1 py-1.5 text-[13px] focus:outline-none"
        />
        <button type="button" onClick={onClose} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Close the search">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        {typed ? "Catalog" : "Candidates for this line"}
      </div>
      <ul className="max-h-64 overflow-y-auto pb-1" role="listbox">
        {list.map((c, i) => (
          <li key={`${c.kind}:${c.ref}`} role="option" aria-selected={i === active}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(c, names)}
              className={`flex w-full min-w-0 items-baseline gap-2 px-2 py-1 text-left text-xs ${i === active ? "bg-brand-50" : ""}`}
            >
              <span className="shrink-0 font-mono text-[11px] font-semibold text-brand-700">{c.kind === "profile" ? c.ref : c.codes[0]}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700" title={c.label}>
                {c.label}
              </span>
              {c.kind === "profile" && <span className="shrink-0 text-[10px] text-slate-400">profile · {c.codes.length} tests</span>}
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-slate-400">
            {searching ? "Searching…" : typed ? "Nothing in the catalog looks like it" : "Type to search the whole catalog"}
          </li>
        )}
      </ul>
    </div>
  );
}
