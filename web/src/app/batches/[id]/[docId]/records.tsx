"use client";

/**
 * Searching the lab's records by hand, for the patient, physician or insurer the document is
 * about when the engine did not link it (or linked another). Choosing one links the document
 * to it, and the fields are compared with that record instead; "no record" says it is a new
 * one. Nothing is stored until the document is approved with the link.
 *
 * Not modal: it opens by the search button, beside the document but never over it, which
 * stays in reach (scrolling, zooming) since what is searched for is read off it. A click
 * elsewhere closes it, except on the document.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type RecordKind, type RecordView } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { Search, X } from "../../../_ui/icons";

const DEBOUNCE_MS = 150;
/** Room between the box and the button, the document and the window's edges, in px. */
const GAP = 8;
const MAX_WIDTH = 576;

/**
 * Where the box goes: under the button (over it if there is no room below), its right edge
 * at the button's when it fits, and never over the document nor past the window's edge.
 */
function place(anchor: HTMLElement, height: number) {
  const a = anchor.getBoundingClientRect();
  const viewer = document.querySelector("[data-viewer]")?.getBoundingClientRect();
  // The document only bounds the box when it is to the side; stacked above, it does not.
  const min = viewer && viewer.right <= a.left ? viewer.right + GAP : GAP;
  const max = window.innerWidth - GAP;
  const width = Math.min(MAX_WIDTH, max - min);
  const left = Math.min(Math.max(a.right - width, min), max - width);
  const below = a.bottom + GAP;
  const top = below + height <= window.innerHeight - GAP ? below : Math.max(GAP, a.top - GAP - height);
  return { top, left, width };
}

export function RecordSearch({
  kind,
  anchor,
  current,
  chosen,
  onPick,
  onReset,
  onClose,
}: {
  kind: RecordKind;
  /** The search button that opened it, which the box stays by. */
  anchor: HTMLElement;
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
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  // Hidden until placed, and a hidden input takes no focus.
  const placed = at !== null;
  useEffect(() => {
    if (placed) input.current?.focus();
  }, [placed]);

  useLayoutEffect(() => {
    const follow = () => setAt(place(anchor, box.current?.offsetHeight ?? 0));
    follow();
    // The box grows with the results, and the form under it can scroll.
    const grows = new ResizeObserver(follow);
    if (box.current) grows.observe(box.current);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      grows.disconnect();
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [anchor]);

  useEffect(() => {
    function away(e: PointerEvent) {
      const target = e.target as Element;
      if (box.current?.contains(target) || anchor.contains(target) || target.closest?.("[data-viewer]")) return;
      onClose();
    }
    function escape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape, true);
    };
  }, [anchor, onClose]);

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
    <div
      ref={box}
      role="dialog"
      aria-label={r.search[kind]}
      style={at ?? { visibility: "hidden" }}
      className="card fixed z-40 overflow-hidden shadow-2xl!"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4">
        <Search className="size-4 shrink-0 text-slate-400" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
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
  );
}
