"use client";

/**
 * The fields of the request, grouped, each with its traffic light, the value proposed, and
 * where it came from: what the document says, what the lab's records say, and who changed it.
 * A conflict proposes no value: the technician takes the document's or the records', or types.
 */
import type { RefObject } from "react";

import type { RecordKind } from "@/lib/fusion/types";

import type { ProposalView } from "../../../_ui/api";
import { GROUPS, LIGHT_DOT, LINK_LABEL, LINK_STYLE, REASON, type Item } from "./model";

type FieldItem = Extract<Item, { kind: "field" }>;

const RECORD_LABEL: Record<RecordKind, string> = { patient: "Patient", physician: "Physician", insurer: "Insurer" };

export function Links({ view }: { view: ProposalView }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {(Object.keys(RECORD_LABEL) as RecordKind[]).map((k) => {
        const link = view.proposal.fused.links[k];
        const record = link.recordId ? view.records[link.recordId] : null;
        return (
          <div key={k} className="rounded-lg bg-white p-3 ring-1 ring-slate-200" title={link.reason}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{RECORD_LABEL[k]}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${LINK_STYLE[link.status]}`}>
                {LINK_LABEL[link.status]}
              </span>
            </div>
            {record ? (
              <>
                <div className="mt-1.5 truncate text-sm font-medium">{record.title}</div>
                <div className="truncate text-[11px] text-slate-500">{record.detail}</div>
              </>
            ) : link.candidates.length > 1 ? (
              <div className="mt-1.5 text-xs text-slate-600">{link.candidates.length} records look like it</div>
            ) : (
              <div className="mt-1.5 text-xs text-slate-500">{link.reason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Fields({
  view,
  items,
  values,
  touched,
  focused,
  readOnly,
  inputs,
  onFocus,
  onChange,
}: {
  view: ProposalView;
  items: FieldItem[];
  values: Record<string, string>;
  touched: Set<string>;
  focused: string | null;
  readOnly: boolean;
  inputs: RefObject<Map<string, HTMLElement>>;
  onFocus: (key: string) => void;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const group = items.filter((i) => i.spec.group === g.id);
        if (group.length === 0) return null;
        return (
          <section key={g.id}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g.label}</h3>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
              {group.map((i) => (
                <FieldRow
                  key={i.key}
                  view={view}
                  item={i}
                  value={values[i.key] ?? ""}
                  edited={touched.has(i.key)}
                  focused={focused === i.key}
                  readOnly={readOnly}
                  inputs={inputs}
                  onFocus={onFocus}
                  onChange={onChange}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FieldRow({
  view,
  item,
  value,
  edited,
  focused,
  readOnly,
  inputs,
  onFocus,
  onChange,
}: {
  view: ProposalView;
  item: FieldItem;
  value: string;
  edited: boolean;
  focused: boolean;
  readOnly: boolean;
  inputs: RefObject<Map<string, HTMLElement>>;
  onFocus: (key: string) => void;
  onChange: (key: string, value: string) => void;
}) {
  const { fused, spec, key } = item;
  const conflict = fused.reason === "conflict";
  const showSources = focused || conflict || fused.state === "red";
  const record = fused.lis ? view.records[fused.lis.recordId] : null;
  return (
    <div
      className={`relative px-3.5 py-3 transition ${focused ? "bg-brand-50/50" : ""}`}
      onClick={() => onFocus(key)}
    >
      {focused && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" aria-hidden />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-nowrap">
        <span className={`size-2.5 shrink-0 rounded-full ${LIGHT_DOT[fused.state]}`} title={fused.state} />
        <label htmlFor={key} className="shrink-0 text-xs text-slate-600 sm:w-36">
          {spec.label}
          {spec.required && <span className="text-slate-400"> *</span>}
        </label>
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
          placeholder={conflict ? "Choose below" : "–"}
          className={`order-last w-full min-w-0 rounded-md border sm:order-none sm:w-auto sm:flex-1 bg-white px-2.5 py-1.5 text-sm font-medium focus:outline-none ${
            focused ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200"
          } ${readOnly ? "bg-slate-50" : ""}`}
        />
        {edited && (
          <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">
            edited
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500 sm:pl-[10.5rem]">{REASON[fused.reason]}</p>
      {showSources && (fused.ai || fused.lis) && (
        <div className="mt-2 flex flex-wrap gap-2 sm:pl-[10.5rem]">
          {fused.ai && (
            <SourceButton
              label="Document"
              value={fused.ai.value}
              note={fused.ai.page ? `page ${fused.ai.page}` : null}
              warn={fused.ai.warnings.length > 0 ? fused.ai.warnings.join(", ") : null}
              active={!readOnly && conflict}
              onPick={() => onChange(key, fused.ai!.value)}
              shortcut={conflict ? "Alt+1" : null}
            />
          )}
          {fused.lis && (
            <SourceButton
              label={fused.lis.confirmed ? "Records" : "Candidate record"}
              value={fused.lis.value}
              note={record && record.title !== fused.lis.value ? record.title : fused.lis.recordId}
              warn={null}
              active={!readOnly && conflict}
              onPick={() => onChange(key, fused.lis!.value)}
              shortcut={conflict ? "Alt+2" : null}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SourceButton({
  label,
  value,
  note,
  warn,
  active,
  onPick,
  shortcut,
}: {
  label: string;
  value: string;
  note: string | null;
  warn: string | null;
  active: boolean;
  onPick: () => void;
  shortcut: string | null;
}) {
  const body = (
    <>
      <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
      {note && <span className="text-slate-500">· {note}</span>}
      {warn && <span className="text-red-700">· {warn}</span>}
      {shortcut && <kbd className="ml-1 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">{shortcut}</kbd>}
    </>
  );
  if (!active) return <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">{body}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs ring-1 ring-slate-300 transition hover:bg-brand-50 hover:ring-brand-400"
    >
      {body}
    </button>
  );
}
