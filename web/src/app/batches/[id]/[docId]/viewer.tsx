"use client";

/**
 * The document's pages with a box on every value read from them. An exact box is drawn
 * tight; an approximate one (the local model's own, model.ts) dashed and with a margin, so
 * the technician knows which to trust (box_source, docs/extractor-contract.md). The focused item's
 * box is highlighted and scrolled into view; clicking a box focuses its item. So is the box the
 * lens points to (lens.tsx), once the pointer has rested on its value, if it is out of view.
 */
import { useEffect, useRef, useState } from "react";

import { api } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { LIGHT_BOX, type Item, type Light } from "./model";

/** Margin around an approximate box, as a share of the page. */
const LOOSE = 0.012;
const ZOOMS = [1, 1.25, 1.5, 2];
/** How long the pointer rests on a value before the viewer moves to show its box. */
const DWELL_MS = 150;

export function Viewer({
  documentId,
  pages,
  items,
  lights,
  focused,
  peek,
  onFocus,
}: {
  documentId: string;
  pages: { number: number; width_pt: number; height_pt: number }[];
  items: Item[];
  lights: Record<string, Light>;
  focused: string | null;
  /** The item the lens is showing, if any. */
  peek: string | null;
  onFocus: (key: string) => void;
}) {
  const [zoom, setZoom] = useState(0);
  const { t } = useI18n();
  const v = t.viewer;
  const scroller = useRef<HTMLDivElement>(null);
  const focusedPlace = items.find((i) => i.key === focused)?.place ?? null;

  useEffect(() => {
    if (!focused || !focusedPlace) return;
    const box = scroller.current?.querySelector<HTMLElement>(`[data-box="${CSS.escape(focused)}"]`);
    box?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [focused, focusedPlace, zoom]);

  useEffect(() => {
    if (!peek) return;
    const timer = window.setTimeout(() => {
      const view = scroller.current;
      const box = view?.querySelector<HTMLElement>(`[data-box="${CSS.escape(peek)}"]`);
      if (!view || !box) return;
      const r = box.getBoundingClientRect();
      const frame = view.getBoundingClientRect();
      const inView = r.top >= frame.top && r.bottom <= frame.bottom && r.left >= frame.left && r.right <= frame.right;
      if (!inView) box.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    }, DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [peek]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600 backdrop-blur">
        <span className="font-medium text-slate-900">
          {v.pages(pages.length)}
        </span>
        {focusedPlace && <span className="hidden sm:inline">· {v.page(focusedPlace.page)}</span>}
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="hidden items-center gap-1.5 xl:inline-flex">
            <span className="h-2.5 w-4 rounded-sm border-2 border-slate-500" /> {v.exact}
          </span>
          <span className="hidden items-center gap-1.5 xl:inline-flex">
            <span className="h-2.5 w-4 rounded-sm border-2 border-dashed border-slate-500" /> {v.approximate}
          </span>
          <span className="inline-flex overflow-hidden rounded-md ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0, z - 1))}
              disabled={zoom === 0}
              className="px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40"
              aria-label={v.zoomOut}
            >
              −
            </button>
            <span className="border-x border-slate-200 px-2 py-0.5 tabular-nums">{Math.round(ZOOMS[zoom] * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
              disabled={zoom === ZOOMS.length - 1}
              className="px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40"
              aria-label={v.zoomIn}
            >
              +
            </button>
          </span>
        </span>
      </div>
      <div ref={scroller} className="@container flex-1 overflow-auto p-4">
        {/* Two pages side by side when the viewer is wide enough to read both. */}
        <div className="mx-auto grid items-start gap-4 @min-[72rem]:grid-cols-2" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
          {pages.map((p) => (
            <div
              key={p.number}
              className="relative overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-slate-900/5"
              style={{ aspectRatio: `${p.width_pt} / ${p.height_pt}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- rendered by our API per document, not a static asset */}
              <img src={api.pageUrl(documentId, p.number)} alt={v.pageAlt(p.number)} className="absolute inset-0 size-full" loading="lazy" />
              {items
                .filter((i) => i.place?.page === p.number)
                .map((i) => {
                  const { bbox, exact } = i.place!;
                  const m = exact ? 0.002 : LOOSE;
                  const on = i.key === focused || i.key === peek;
                  return (
                    <button
                      key={i.key}
                      type="button"
                      data-box={i.key}
                      onClick={() => onFocus(i.key)}
                      title={exact ? v.boxExact : v.boxApprox}
                      className={`absolute rounded-[3px] border-2 transition ${LIGHT_BOX[lights[i.key] ?? "grey"]} ${
                        exact ? "" : "border-dashed"
                      } ${on ? "z-10 !border-brand-600 !bg-brand-500/15 shadow-[0_0_0_4px_rgb(99_102_241/0.25)]" : "opacity-60 hover:opacity-100"}`}
                      style={{
                        left: `${(bbox.x0 - m) * 100}%`,
                        top: `${(bbox.y0 - m) * 100}%`,
                        width: `${(bbox.x1 - bbox.x0 + 2 * m) * 100}%`,
                        height: `${(bbox.y1 - bbox.y0 + 2 * m) * 100}%`,
                      }}
                    >
                      {on && !exact && (
                        <span className="absolute -top-5 left-0 rounded bg-brand-600 px-1 text-[10px] font-medium whitespace-nowrap text-white">
                          {v.approx}
                        </span>
                      )}
                    </button>
                  );
                })}
              <span className="absolute right-2 bottom-2 rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {p.number}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
