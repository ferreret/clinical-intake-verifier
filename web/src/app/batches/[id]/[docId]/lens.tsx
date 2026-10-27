"use client";

/**
 * The lens: while the pointer is on a value in the Read column, a magnified window of the page
 * where it was read, shown beside its row, and a line from that window to the value's box in
 * the viewer. The technician compares the reading with the source without looking for it; it
 * goes as soon as the pointer leaves the cell, so it never sits over the rows being worked on.
 *
 * Everything is positioned from the elements' boxes on screen (`data-row`, `data-read` in the
 * tables, `data-box` in the viewer), followed frame by frame while it is shown, so the
 * window and the line stay right while either side scrolls. Wide layouts only: on a narrow
 * screen the viewer is above the tables and the line would cross them.
 */
import { useEffect, useState } from "react";

import { api } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { LIGHT_DOT, type Item, type Light } from "./model";

/** The window's width, by screen width. */
const width = () => (window.innerWidth >= 2560 ? 520 : window.innerWidth >= 1920 ? 440 : 380);
const MIN_H = 64;
const MAX_H = 220;
const HEADER = 26;
const GAP = 10;

interface Geometry {
  card: { x: number; y: number; w: number; h: number };
  /** The line, from the window's left edge to the box's right edge; null when the box is out of view. */
  line: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** The part of the page to show: the box with room around it, at the window's proportions. */
function region(b: { x0: number; y0: number; x1: number; y1: number }, pageRatio: number, w: number) {
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  let rw = bw + 2 * Math.max(0.06, bw * 0.4);
  let rh = bh + 2 * Math.max(0.03, bh * 1.5);
  // Height of the window for this region, in screen pixels; the region is widened or made
  // taller to fit the window's bounds rather than stretched.
  let h = (w * rh * pageRatio) / rw;
  if (h > MAX_H) {
    h = MAX_H;
    rw = (w * rh * pageRatio) / h;
  } else if (h < MIN_H) {
    h = MIN_H;
    rh = (h * rw) / (w * pageRatio);
  }
  rw = Math.min(rw, 1);
  rh = Math.min(rh, 1);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const x0 = Math.min(Math.max(cx - rw / 2, 0), 1 - rw);
  const y0 = Math.min(Math.max(cy - rh / 2, 0), 1 - rh);
  return { x0, y0, rw, rh, h };
}

const visible = (r: DOMRect, within: DOMRect) => r.bottom > within.top && r.top < within.bottom && r.right > within.left && r.left < within.right;

export function Lens({
  documentId,
  pages,
  items,
  lights,
  shown,
  labels,
  enabled,
}: {
  documentId: string;
  pages: { number: number; width_pt: number; height_pt: number }[];
  items: Item[];
  lights: Record<string, Light>;
  /** The item to show: the one whose Read cell is under the pointer. */
  shown: string | null;
  /** What to call each item, and the value read. */
  labels: Record<string, { label: string; read: string }>;
  enabled: boolean;
}) {
  const item = items.find((i) => i.key === shown) ?? null;
  const place = item?.place ?? null;
  const page = place ? pages.find((p) => p.number === place.page) : undefined;
  const [geo, setGeo] = useState<Geometry | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled || !shown || !place || !page) return;
    let frame = 0;
    let last = "";
    const tick = () => {
      frame = requestAnimationFrame(tick);
      let next: Geometry | null = null;
      const row = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(shown)}"]`);
      const rowScroller = row?.closest<HTMLElement>(".overflow-y-auto");
      if (row && window.innerWidth >= 1024) {
        const rowRect = row.getBoundingClientRect();
        const within = rowScroller?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
        if (visible(rowRect, within)) {
          const read = (row.querySelector<HTMLElement>("[data-read]") ?? row).getBoundingClientRect();
          const w = width();
          const { h } = region(place.bbox, page.height_pt / page.width_pt, w);
          const total = h + HEADER;
          const x = Math.max(8, Math.min(read.left, window.innerWidth - w - 8));
          // Above the row when it fits in the panel, below it otherwise.
          const above = rowRect.top - total - GAP;
          const y = above >= within.top ? above : Math.min(rowRect.bottom + GAP, window.innerHeight - total - 8);
          const box = document.querySelector<HTMLElement>(`[data-box="${CSS.escape(shown)}"]`);
          const viewer = box?.closest<HTMLElement>(".overflow-auto")?.getBoundingClientRect();
          const boxRect = box?.getBoundingClientRect();
          const line =
            boxRect && viewer && visible(boxRect, viewer)
              ? { x1: x, y1: y + total / 2, x2: Math.min(boxRect.right, viewer.right), y2: boxRect.top + boxRect.height / 2 }
              : null;
          next = { card: { x, y, w, h }, line };
        }
      }
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setGeo(next);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setGeo(null);
    };
  }, [enabled, shown, place, page]);

  if (!enabled || !item || !place || !page || !geo) return null;
  const { card, line } = geo;
  const r = region(place.bbox, page.height_pt / page.width_pt, card.w);
  const imgW = card.w / r.rw;
  const imgH = (imgW * page.height_pt) / page.width_pt;
  const b = place.bbox;
  const info = labels[item.key];
  const light = lights[item.key] ?? "grey";

  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-hidden>
      {line && (
        <svg className="absolute inset-0 size-full overflow-visible">
          <path
            d={`M ${line.x1} ${line.y1} C ${line.x1 - 90} ${line.y1}, ${line.x2 + 90} ${line.y2}, ${line.x2} ${line.y2}`}
            fill="none"
            stroke="rgb(99 102 241)"
            strokeWidth={2}
            strokeDasharray={place.exact ? undefined : "6 4"}
          />
          <circle cx={line.x1} cy={line.y1} r={4} fill="rgb(99 102 241)" />
          <circle cx={line.x2} cy={line.y2} r={4.5} fill="white" stroke="rgb(99 102 241)" strokeWidth={2} />
        </svg>
      )}
      <div
        className="absolute overflow-hidden rounded-lg bg-white shadow-[0_8px_30px_rgb(15_23_42/0.22)] ring-1 ring-brand-300"
        style={{ left: card.x, top: card.y, width: card.w }}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-2.5 text-[11px]" style={{ height: HEADER }}>
          <span className={`size-2 shrink-0 rounded-full ${LIGHT_DOT[light]}`} />
          <span className="shrink-0 font-semibold text-slate-700">{info?.label}</span>
          <span className="min-w-0 truncate text-slate-500">{info?.read}</span>
          <span className="ml-auto shrink-0 text-slate-400">
            {t.lens.page(place.page)}
            {!place.exact && t.lens.approx}
          </span>
        </div>
        <div className="relative overflow-hidden bg-white" style={{ height: r.h }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the same page image the viewer shows, already loaded */}
          <img
            src={api.pageUrl(documentId, place.page)}
            alt=""
            className="absolute max-w-none"
            style={{ width: imgW, height: imgH, left: -r.x0 * imgW, top: -r.y0 * imgH }}
          />
          <span
            className={`absolute rounded-[3px] border-2 border-brand-500 bg-brand-400/10 ${place.exact ? "" : "border-dashed"}`}
            style={{
              left: (b.x0 - r.x0) * imgW - 3,
              top: (b.y0 - r.y0) * imgH - 3,
              width: (b.x1 - b.x0) * imgW + 6,
              height: (b.y1 - b.y0) * imgH + 6,
            }}
          />
        </div>
      </div>
    </div>
  );
}
