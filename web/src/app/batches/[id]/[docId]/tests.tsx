"use client";

/**
 * The requested lines as a table: each as it was read, the lab's codes proposed for it and
 * where from, and the codes selected, which the technician keeps, replaces with another of
 * the catalog's candidates, or drops when the line is not a test.
 */
import type { RefObject } from "react";

import type { ProposalView } from "../../../_ui/api";
import { codesKey, LIGHT_DOT, MAPPING_SOURCE, type Item } from "./model";

type TestItem = Extract<Item, { kind: "test" }>;

/** A line's codes as the technician has them: none chosen yet ([]), or removed (null). */
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
  const codeChip = (c: string) => (
    <span key={c} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded bg-slate-50 px-1.5 py-px text-xs ring-1 ring-slate-200" title={view.codes[c]}>
      <span className="font-mono text-[11px] font-semibold text-brand-700">{c}</span>
      <span className="truncate text-slate-600">{view.codes[c] ?? ""}</span>
    </span>
  );
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            {/* Widths on the header cells: a fixed table takes them from its first row, skipping hidden ones. */}
            <th className="w-7 py-2" />
            <th className="px-2 py-2">Read</th>
            <th className="hidden w-[36%] px-2 py-2 @min-[44rem]:table-cell">Proposed</th>
            <th className="w-[42%] px-2 py-2">Selected</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((i) => {
            const line = view.proposal.tests[i.index];
            const m = line.mapping;
            const codes = chosen[i.key];
            const on = focused === i.key;
            const removed = codes === null;
            const candidates = m.candidates.filter((c) => codesKey(c.codes) !== codesKey(m.codes)).slice(0, 12);
            const source = m.source ? MAPPING_SOURCE[m.source] : m.reason;
            return (
              <tr key={i.key} className={`align-top transition ${on ? "bg-brand-50/60" : "hover:bg-slate-50/60"}`} onClick={() => onFocus(i.key)}>
                <td className="relative py-2.5 pl-3">
                  {on && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" aria-hidden />}
                  <span className={`mt-1 block size-2.5 rounded-full ${LIGHT_DOT[m.state]}`} title={source} />
                </td>
                <td className="px-2 py-2">
                  <div className={`truncate text-[13px] font-medium ${removed ? "text-slate-400 line-through" : "text-slate-800"}`} title={line.text}>
                    {line.text}
                  </div>
                  <div className="text-[11px] text-slate-400">{line.page ? `p. ${line.page}` : "no page"}</div>
                </td>
                <td className="hidden px-2 py-2 @min-[44rem]:table-cell">
                  <div className="flex flex-wrap gap-1">{m.codes ? m.codes.map(codeChip) : <span className="text-xs font-medium text-red-700">None: you choose</span>}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500" title={source}>
                    {source}
                    {m.evidence && m.source === "memory" && ` (${m.evidence.active})`}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
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
                      className={`min-w-0 flex-1 rounded-md border bg-white px-2 py-1 text-[13px] font-semibold focus:outline-none ${
                        on ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200"
                      } ${!removed && codes?.length === 0 ? "border-red-300 bg-red-50/40" : ""}`}
                    >
                      {m.codes ? (
                        <option value={codesKey(m.codes)}>{m.codes.join(" + ")} · proposed</option>
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
                      <option value={REMOVE}>Not a test: drop the line</option>
                    </select>
                    {touched.has(i.key) && <span className="size-1.5 shrink-0 rounded-full bg-brand-600" title="Changed by you" aria-label="edited" />}
                  </div>
                  {!removed && codes && codes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 @min-[44rem]:hidden">{codes.map(codeChip)}</div>
                  )}
                  {!removed && codes && codes.length > 0 && codesKey(codes) !== codesKey(m.codes) && (
                    <div className="mt-1 hidden flex-wrap gap-1 @min-[44rem]:flex">{codes.map(codeChip)}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
