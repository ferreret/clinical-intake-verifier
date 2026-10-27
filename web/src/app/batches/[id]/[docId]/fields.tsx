"use client";

/**
 * The request's fields as a table: for each, what was read on the document, what the lab's
 * records hold, what the engine proposes and from where, and the value selected, which the
 * technician sets. A source cell that holds a value can be clicked to select it, so a
 * conflict, which proposes nothing, is settled in one click (or Alt+1 / Alt+2).
 *
 * Built for wide screens. The table narrows with its container: records go under what was
 * read, and the proposed column goes, before anything else does.
 */
import type { RefObject } from "react";

import type { RecordKind } from "@/lib/fusion/types";

import type { ProposalView } from "../../../_ui/api";
import { GROUPS, LIGHT_DOT, LINK_LABEL, LINK_STYLE, REASON, type Item } from "./model";

type FieldItem = Extract<Item, { kind: "field" }>;

const RECORD_LABEL: Record<RecordKind, string> = { patient: "Patient", physician: "Physician", insurer: "Insurer" };
const SOURCE_LABEL = { lis: "records", ai: "document", default: "default" } as const;

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim() && !!a?.trim();

export function Links({ view }: { view: ProposalView }) {
  return (
    <div className="grid gap-2 @min-[40rem]:grid-cols-3">
      {(Object.keys(RECORD_LABEL) as RecordKind[]).map((k) => {
        const link = view.proposal.fused.links[k];
        const record = link.recordId ? view.records[link.recordId] : null;
        return (
          <div key={k} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200" title={link.reason}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{RECORD_LABEL[k]}</span>
                <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset ${LINK_STYLE[link.status]}`}>
                  {LINK_LABEL[link.status]}
                </span>
              </div>
              {record ? (
                <div className="truncate text-sm">
                  <span className="font-medium">{record.title}</span> <span className="text-xs text-slate-500">{record.detail}</span>
                </div>
              ) : (
                <div className="truncate text-xs text-slate-500">
                  {link.candidates.length > 1 ? `${link.candidates.length} records look like it` : link.reason}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface FieldsProps {
  view: ProposalView;
  items: FieldItem[];
  values: Record<string, string>;
  touched: Set<string>;
  focused: string | null;
  readOnly: boolean;
  inputs: RefObject<Map<string, HTMLElement>>;
  onFocus: (key: string) => void;
  onChange: (key: string, value: string) => void;
}

export function Fields(props: FieldsProps) {
  const { items } = props;
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            {/* Widths on the header cells: a fixed table takes them from its first row, skipping hidden ones. */}
            <th className="w-7 py-2" />
            <th className="w-[19%] px-2 py-2">Field</th>
            <th className="px-2 py-2">Read</th>
            <th className="hidden w-[17%] px-2 py-2 @min-[56rem]:table-cell">Records</th>
            <th className="hidden w-[17%] px-2 py-2 @min-[44rem]:table-cell">Proposed</th>
            <th className="w-[23%] px-2 py-2">Selected</th>
          </tr>
        </thead>
        {GROUPS.map((g) => {
          const group = items.filter((i) => i.spec.group === g.id);
          if (group.length === 0) return null;
          return (
            <tbody key={g.id} className="divide-y divide-slate-100 border-t border-slate-200">
              <tr>
                <td colSpan={6} className="bg-slate-50/60 px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  {g.label}
                </td>
              </tr>
              {group.map((i) => (
                <FieldRow key={i.key} {...props} item={i} />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function FieldRow({ view, item, values, touched, focused, readOnly, inputs, onFocus, onChange }: FieldsProps & { item: FieldItem }) {
  const { fused, spec, key } = item;
  const value = values[key] ?? "";
  const on = focused === key;
  const conflict = fused.reason === "conflict";
  const record = fused.lis ? view.records[fused.lis.recordId] : null;
  const read = fused.ai && (
    <SourceCell
      value={fused.ai.value}
      note={fused.ai.page ? `p. ${fused.ai.page}` : null}
      warn={fused.ai.warnings.length > 0 ? fused.ai.warnings.join(", ") : null}
      chosen={same(value, fused.ai.value)}
      pick={readOnly ? null : () => onChange(key, fused.ai!.value)}
      shortcut={conflict ? "Alt+1" : null}
    />
  );
  const lis = fused.lis && (
    <SourceCell
      value={fused.lis.value}
      note={fused.lis.confirmed ? null : "candidate"}
      title={record ? `${record.title} · ${record.detail}` : fused.lis.recordId}
      warn={null}
      chosen={same(value, fused.lis.value)}
      pick={readOnly ? null : () => onChange(key, fused.lis!.value)}
      shortcut={conflict ? "Alt+2" : null}
    />
  );
  return (
    <tr className={`align-top transition ${on ? "bg-brand-50/60" : "hover:bg-slate-50/60"}`} onClick={() => onFocus(key)}>
      <td className="relative py-2.5 pl-3">
        {on && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" aria-hidden />}
        <span className={`mt-1 block size-2.5 rounded-full ${LIGHT_DOT[fused.state]}`} title={REASON[fused.reason]} />
      </td>
      <td className="px-2 py-2">
        <label htmlFor={key} className="block truncate text-[13px] font-medium text-slate-800">
          {spec.label}
          {spec.required && <span className="text-slate-400"> *</span>}
        </label>
        <span className={`block truncate text-[11px] ${fused.state === "red" ? "text-red-700" : "text-slate-500"}`} title={REASON[fused.reason]}>
          {REASON[fused.reason]}
        </span>
      </td>
      <td className="px-2 py-2">
        {read ?? <Empty />}
        {/* Narrow: the records' value goes under what was read. */}
        {lis && <div className="mt-1 @min-[56rem]:hidden">{lis}</div>}
      </td>
      <td className="hidden px-2 py-2 @min-[56rem]:table-cell">{lis ?? <Empty />}</td>
      <td className="hidden px-2 py-2 @min-[44rem]:table-cell">
        {fused.value !== null ? (
          <div className="truncate">
            <span className="font-medium text-slate-800">{fused.value}</span>
            {fused.source && <span className="ml-1.5 text-[11px] text-slate-500">from {SOURCE_LABEL[fused.source]}</span>}
          </div>
        ) : conflict ? (
          <span className="text-xs font-medium text-red-700">None: you choose</span>
        ) : (
          <Empty />
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <input
            id={key}
            ref={(el) => {
              if (el) inputs.current.set(key, el);
              else inputs.current.delete(key);
            }}
            value={value}
            readOnly={readOnly}
            onFocus={() => onFocus(key)}
            onChange={(e) => onChange(key, e.target.value)}
            placeholder={conflict ? "Choose or type" : "–"}
            className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-[13px] font-semibold focus:outline-none ${
              on ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200"
            } ${readOnly ? "bg-slate-50" : "bg-white"} ${!value.trim() && (fused.state === "red" || spec.required) ? "border-red-300 bg-red-50/40" : ""}`}
          />
          {touched.has(key) && (
            <span className="size-1.5 shrink-0 rounded-full bg-brand-600" title="Changed by you" aria-label="edited" />
          )}
        </div>
      </td>
    </tr>
  );
}

function SourceCell({
  value,
  note,
  warn,
  chosen,
  pick,
  shortcut,
  title,
}: {
  value: string;
  note: string | null;
  warn: string | null;
  chosen: boolean;
  pick: (() => void) | null;
  shortcut: string | null;
  title?: string;
}) {
  const body = (
    <>
      <span className="truncate font-medium text-slate-800">{value}</span>
      {note && <span className="shrink-0 text-[11px] text-slate-400">{note}</span>}
      {warn && (
        <span className="shrink-0 text-[11px] text-red-700" title={warn}>
          ⚠
        </span>
      )}
      {shortcut && <kbd className="ml-auto shrink-0 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">{shortcut}</kbd>}
    </>
  );
  const style = `flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[13px] ${
    chosen ? "bg-emerald-50 ring-1 ring-emerald-300" : ""
  }`;
  if (!pick) {
    return (
      <span className={style} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title ?? "Select this value"}
      onClick={(e) => {
        e.stopPropagation();
        pick();
      }}
      className={`${style} transition hover:bg-brand-50 hover:ring-1 hover:ring-brand-300`}
    >
      {body}
    </button>
  );
}

function Empty() {
  return <span className="px-1.5 text-slate-300">–</span>;
}
