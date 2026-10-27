"use client";

/**
 * The requested tests as a table: each line as it was read, the lab's codes proposed for it
 * and where from, and the codes selected, which the technician sets from the whole catalog
 * (codes.tsx). A line that is not a test is dropped: it stays in view, struck through, so the
 * approval records that it was read and left out. Tests the form asks for but the reading
 * missed are added by hand, with no page or box.
 */
import { Fragment, type ReactNode, type RefObject } from "react";

import type { ProposalView } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { Plus, Retry, X } from "../../../_ui/icons";
import { CodeEditor } from "./codes";
import { ConfirmToggle } from "./fields";
import type { Step } from "./explain";
import { Steps, WhyButton } from "./log";
import { LIGHT_DOT, type Check, type Item } from "./model";

type TestItem = Extract<Item, { kind: "test" }>;

/** A read line's codes as the technician has them: none chosen yet ([]), or dropped (null). */
export type Chosen = Record<string, string[] | null>;

/** A test the technician added: what the form says, if they wrote it, and its codes. */
export interface AddedLine {
  key: string;
  text: string;
  codes: string[];
}

export function Tests({
  view,
  items,
  chosen,
  added,
  names,
  touched,
  focused,
  readOnly,
  inputs,
  checks,
  confirmed,
  onFocus,
  onConfirm,
  onChoose,
  onAdd,
  onEditAdded,
  onRemoveAdded,
  onNames,
  why,
  onWhy,
  explain,
}: {
  view: ProposalView;
  items: TestItem[];
  chosen: Chosen;
  added: AddedLine[];
  names: Record<string, string>;
  touched: Set<string>;
  focused: string | null;
  readOnly: boolean;
  inputs: RefObject<Map<string, HTMLElement>>;
  checks: Record<string, Check>;
  confirmed: Set<string>;
  onFocus: (key: string) => void;
  onConfirm: (key: string) => void;
  onChoose: (key: string, codes: string[] | null) => void;
  onAdd: () => void;
  onEditAdded: (key: string, patch: Partial<Omit<AddedLine, "key">>) => void;
  onRemoveAdded: (key: string) => void;
  onNames: (names: Record<string, string>) => void;
  why: string | null;
  onWhy: (key: string) => void;
  explain: (key: string) => Step[];
}) {
  const { t } = useI18n();
  const m = t.tests;
  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };
  const codeChip = (c: string) => (
    <span key={c} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded bg-slate-50 px-1.5 py-px text-xs ring-1 ring-slate-200" title={names[c]}>
      <span className="font-mono text-[11px] font-semibold text-brand-700">{c}</span>
      <span className="truncate text-slate-600">{names[c] ?? ""}</span>
    </span>
  );
  const rowStyle = (on: boolean) => `align-top transition ${on ? "bg-brand-50/60" : "hover:bg-slate-50/60"}`;
  const marker = (on: boolean) => on && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-600" aria-hidden />;
  const edited = (key: string) =>
    touched.has(key) && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" title={t.fields.changed} aria-label={t.fields.changed} />;

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            {/* Widths on the header cells: a fixed table takes them from its first row, skipping hidden ones. */}
            <th className="w-7 py-2" />
            <th className="px-2 py-2">{m.columns.read}</th>
            <th className="hidden w-[32%] px-2 py-2 @min-[44rem]:table-cell">{m.columns.proposed}</th>
            <th className="w-[40%] px-2 py-2">{m.columns.selected}</th>
            <th className="w-16 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 && added.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                {m.noLines}
              </td>
            </tr>
          )}
          {items.map((i) => {
            const line = view.proposal.tests[i.index];
            const mapping = line.mapping;
            const codes = chosen[i.key];
            const on = focused === i.key;
            const dropped = codes === null;
            const source = mapping.source ? t.mappingSource[mapping.source] : t.server(mapping.reason);
            return (
              <Fragment key={i.key}>
              <tr data-row={i.key} className={rowStyle(on)} onClick={() => onFocus(i.key)}>
                <td className="relative py-2.5 pl-3">
                  {marker(on)}
                  <span className={`mt-1 block size-2.5 rounded-full ${dropped ? "bg-slate-200" : LIGHT_DOT[mapping.state]}`} title={source} />
                </td>
                <td className="px-2 py-2" data-read>
                  <div className={`truncate text-[13px] font-medium ${dropped ? "text-slate-400 line-through" : "text-slate-800"}`} title={line.text}>
                    {line.text}
                  </div>
                  <div className="flex items-baseline gap-2 text-[11px] text-slate-400">
                    {line.page ? t.fields.page(line.page) : m.noPage}
                    <WhyButton open={why === i.key} onClick={() => onWhy(i.key)} />
                  </div>
                </td>
                <td className={`hidden px-2 py-2 @min-[44rem]:table-cell ${dropped ? "opacity-40" : ""}`}>
                  <div className="flex flex-wrap gap-1">{mapping.codes ? mapping.codes.map(codeChip) : <span className="text-xs font-medium text-red-700">{m.noneChoose}</span>}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500" title={source}>
                    {source}
                    {mapping.evidence && mapping.source === "memory" && ` (${mapping.evidence.active})`}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      {dropped ? (
                        <div className="py-0.5 text-xs text-slate-500">{m.dropped}</div>
                      ) : (
                        <CodeEditor
                          codes={codes ?? []}
                          names={names}
                          proposed={mapping.codes}
                          suggestions={mapping.candidates}
                          readOnly={readOnly}
                          addRef={register(i.key)}
                          onFocus={() => onFocus(i.key)}
                          onChange={(c) => onChoose(i.key, c)}
                          onNames={onNames}
                        />
                      )}
                    </div>
                    {edited(i.key)}
                  </div>
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex items-center justify-end gap-1">
                  {checks[i.key]?.confirmable && (
                    <ConfirmToggle on={confirmed.has(i.key)} readOnly={readOnly} onClick={() => onConfirm(i.key)} />
                  )}
                  {!readOnly &&
                    (dropped ? (
                      <RowAction label={m.undo} onClick={() => onChoose(i.key, mapping.codes ?? [])}>
                        <Retry className="size-3.5" />
                      </RowAction>
                    ) : (
                      <RowAction label={m.drop} danger onClick={() => onChoose(i.key, null)}>
                        <X className="size-3.5" />
                      </RowAction>
                    ))}
                  </div>
                </td>
              </tr>
              {why === i.key && (
                <tr className="bg-slate-50/70">
                  <td />
                  <td colSpan={4} className="px-2 pt-1 pb-3">
                    <Steps steps={explain(i.key)} />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
          {added.map((a) => {
            const on = focused === a.key;
            return (
              <tr key={a.key} data-row={a.key} className={rowStyle(on)} onClick={() => onFocus(a.key)}>
                <td className="relative py-2.5 pl-3">
                  {marker(on)}
                  <span className="mt-1 block size-2.5 rounded-full bg-brand-500" title={m.added} />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={a.text}
                    readOnly={readOnly}
                    onFocus={() => onFocus(a.key)}
                    onChange={(e) => onEditAdded(a.key, { text: e.target.value })}
                    placeholder={m.addedPlaceholder}
                    aria-label={m.addedLabel}
                    className="w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] font-medium focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
                  />
                  <div className="mt-0.5 text-[11px] text-brand-700">{m.addedNote}</div>
                </td>
                <td className="hidden px-2 py-2 @min-[44rem]:table-cell">
                  <span className="text-xs text-slate-400">{m.nothingProposed}</span>
                </td>
                <td className="px-2 py-1.5">
                  <CodeEditor
                    codes={a.codes}
                    names={names}
                    proposed={null}
                    suggestions={[]}
                    readOnly={readOnly}
                    addRef={register(a.key)}
                    onFocus={() => onFocus(a.key)}
                    onChange={(codes) => onEditAdded(a.key, { codes })}
                    onNames={onNames}
                  />
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {!readOnly && (
                    <RowAction label={m.removeAdded} danger onClick={() => onRemoveAdded(a.key)}>
                      <X className="size-3.5" />
                    </RowAction>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs font-medium text-brand-700 transition hover:bg-brand-50/60"
        >
          <Plus className="size-3.5" /> {m.add}
        </button>
      )}
    </div>
  );
}

function RowAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-md p-1 text-slate-400 transition ${danger ? "hover:bg-red-50 hover:text-red-700" : "hover:bg-slate-100 hover:text-slate-700"}`}
    >
      {children}
    </button>
  );
}
