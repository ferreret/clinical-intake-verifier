"use client";

/**
 * The requested lines, as the insurer wrote them, with the lab's codes proposed for each and
 * where the proposal came from. The technician keeps them, picks another of the catalog's
 * candidates, or removes a line that is not a test.
 */
import type { RefObject } from "react";

import type { ProposalView } from "../../../_ui/api";
import { codesKey, LIGHT_DOT, MAPPING_SOURCE, type Item } from "./model";

type TestItem = Extract<Item, { kind: "test" }>;

/** A line's codes as the technician has them: none chosen yet, or removed (null). */
export type Chosen = Record<string, string[] | null>;

const REMOVE = "__remove";

export function Tests({
  view,
  items,
  chosen,
  touched,
  focused,
  readOnly,
  inputs,
  onFocus,
  onChoose,
}: {
  view: ProposalView;
  items: TestItem[];
  chosen: Chosen;
  touched: Set<string>;
  focused: string | null;
  readOnly: boolean;
  inputs: RefObject<Map<string, HTMLElement>>;
  onFocus: (key: string) => void;
  onChoose: (key: string, codes: string[] | null) => void;
}) {
  if (items.length === 0) {
    return <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">No test lines were read.</p>;
  }
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      {items.map((i) => {
        const line = view.proposal.tests[i.index];
        const m = line.mapping;
        const codes = chosen[i.key];
        const on = focused === i.key;
        const removed = codes === null;
        const candidates = m.candidates.filter((c) => codesKey(c.codes) !== codesKey(m.codes)).slice(0, 12);
        return (
          <div key={i.key} className={`relative px-3.5 py-3 transition ${on ? "bg-brand-50/50" : ""}`} onClick={() => onFocus(i.key)}>
            {on && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" aria-hidden />}
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${LIGHT_DOT[m.state]}`} title={m.state} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm font-medium ${removed ? "text-slate-400 line-through" : ""}`}>{line.text}</span>
                  {line.page && <span className="text-[11px] text-slate-400">page {line.page}</span>}
                  {touched.has(i.key) && (
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">edited</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {removed ? (
                    <span className="text-xs text-slate-500">Removed: not a test</span>
                  ) : codes && codes.length > 0 ? (
                    codes.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-0.5 text-xs ring-1 ring-slate-200">
                        <span className="font-mono text-[11px] font-semibold text-brand-700">{c}</span>
                        <span className="text-slate-600">{view.codes[c] ?? ""}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-medium text-red-700">No codes yet: choose them</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {m.source ? MAPPING_SOURCE[m.source] : m.reason}
                  {m.evidence && m.source === "memory" && ` (${m.evidence.active} approval${m.evidence.active === 1 ? "" : "s"})`}
                </p>
              </div>
              <select
                ref={(el) => {
                  if (el) inputs.current.set(i.key, el);
                  else inputs.current.delete(i.key);
                }}
                aria-label={`Codes for ${line.text}`}
                disabled={readOnly}
                value={removed ? REMOVE : codesKey(codes ?? [])}
                onFocus={() => onFocus(i.key)}
                onChange={(e) => {
                  const v = e.target.value;
                  onChoose(i.key, v === REMOVE ? null : v ? v.split(",") : []);
                }}
                className={`w-40 shrink-0 rounded-md border bg-white px-2 py-1.5 text-xs focus:outline-none sm:w-56 ${
                  on ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200"
                }`}
              >
                {m.codes ? (
                  <option value={codesKey(m.codes)}>Proposed: {m.codes.join(" + ")}</option>
                ) : (
                  <option value="">Choose the codes…</option>
                )}
                {candidates.length > 0 && (
                  <optgroup label="Catalog candidates">
                    {candidates.map((c) => (
                      <option key={c.ref} value={codesKey(c.codes)}>
                        {c.codes.join(" + ")} · {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={REMOVE}>Not a test: remove the line</option>
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
