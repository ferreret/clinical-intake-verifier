"use client";

/**
 * The decision log on screen (explain.ts in words): an item's steps under its row, and the
 * whole document's log in a panel, from the reading to the technician's decision.
 */
import { useEffect, useRef } from "react";

import { hideModels, providerOf } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { X } from "../../../_ui/icons";
import { useSession } from "../../../_ui/session";
import { explainField, explainLine, type Step, type Work } from "./explain";
import { LIGHT_DOT, type Item } from "./model";

/** An item's steps, in order, each with what it is about and the colour it led to. */
export function Steps({ steps }: { steps: Step[] }) {
  const { t } = useI18n();
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2 text-xs">
          <span className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{t.log.steps[s.kind]}</span>
          <span className="flex items-baseline gap-1.5 text-slate-700">
            {s.tone && <span className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${LIGHT_DOT[s.tone]}`} aria-hidden />}
            <span>{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "Why?" under an item, which unfolds its steps below the row. */
export function WhyButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`text-[11px] font-medium underline-offset-2 hover:underline ${open ? "text-brand-700" : "text-slate-400 hover:text-brand-700"}`}
    >
      {open ? t.log.hide : t.log.why}
    </button>
  );
}

export function DecisionLog({ work, items, onFocus, onClose }: { work: Work; items: Item[]; onFocus: (key: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const { technicians } = useSession();
  const l = t.log;
  const { view } = work;
  const { prediction, fused, trace } = view.proposal;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);

  const ex = prediction.extractor;
  const seconds = (ex.latency_ms / 1000).toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const placed = [...Object.values(prediction.fields), ...prediction.tests].filter((v) => v?.bbox);
  const ocr = placed.filter((v) => v!.box_source === "ocr").length;
  const label = (name: string | null) => {
    const item = items.find((i) => i.kind === "field" && i.spec.name === name);
    return item?.kind === "field" ? t.fieldLabel(item.spec) : (name ?? "");
  };
  const empty = items.filter((i) => i.kind === "field" && !prediction.fields[i.spec.name]).map((i) => (i.kind === "field" ? t.fieldLabel(i.spec) : ""));
  const who = (id: string) => technicians.find((p) => p.id === id)?.name ?? id;
  const when = (at: string) => new Date(at).toLocaleString(t.locale, { dateStyle: "medium", timeStyle: "short" });

  const mapping = trace?.mapping;
  const insurerLink = fused.links.insurer;
  const scopeWho = !mapping
    ? null
    : insurerLink.status === "linked" && insurerLink.recordId === mapping.scope
      ? (view.records[mapping.scope]?.title ?? mapping.scope)
      : mapping.scope.startsWith("name:")
        ? l.scopeName(mapping.insurer ?? mapping.scope.slice(5))
        : l.scopeNone;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-title"
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="log-title" className="font-semibold">
              {l.title} · <span className="font-mono text-sm">{view.document.fileName.replace(/\.pdf$/, "")}</span>
            </h2>
            <p className="text-xs text-slate-500">{l.subtitle}</p>
          </div>
          <button ref={close} type="button" onClick={onClose} aria-label={l.close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm">
          <Section title={l.sections.reading}>
            <Lines
              lines={[
                l.extractor(t.providers[providerOf(ex.model)], ex.prompt_version, ex.input_mode),
                l.attempts(ex.attempts, seconds, view.proposal.recorded),
                ex.input_mode === "page-images" ? l.boxes(ocr, placed.length - ocr) : l.boxesModel,
                prediction.warnings.length > 0
                  ? l.warnings(prediction.warnings.map((w) => (w.field ? `${label(w.field)}: ${w.code}` : w.code)).join("; "))
                  : l.noWarnings,
                ...(empty.length > 0 ? [l.empty(empty.join(", "))] : []),
              ]}
            />
          </Section>

          <Section title={l.sections.records}>
            {(["patient", "physician", "insurer"] as const).map((k) => {
              const link = fused.links[k];
              const record = link.recordId ? view.records[link.recordId] : null;
              return (
                <div key={k} className="mb-2">
                  <p className="text-xs font-medium text-slate-800">
                    {t.records[k]}: {t.links[link.status]}
                    {record && <span className="font-normal text-slate-600"> · {record.title}</span>}
                  </p>
                  <Lines
                    lines={[
                      link.chosen ? l.chosenByYou : capitalise(t.server(link.reason)),
                      ...(link.matchedOn.length > 0 ? [l.matchedOn(link.matchedOn.map((x) => l.keys[x] ?? x).join(", "))] : []),
                      ...(link.candidates.length > 1 ? [l.candidates(link.candidates.length)] : []),
                    ]}
                  />
                </div>
              );
            })}
          </Section>

          <Section title={l.sections.fields}>
            {items.map((i) =>
              i.kind === "field" ? (
                <ItemLog key={i.key} light={i.fused.state} title={t.fieldLabel(i.spec)} note={t.reasons[i.fused.reason]} onGo={() => onFocus(i.key)}>
                  <Steps steps={explainField(i, work, t)} />
                </ItemLog>
              ) : null,
            )}
          </Section>

          <Section title={l.sections.mapping}>
            <Lines
              lines={
                mapping
                  ? [
                      l.scope(scopeWho ?? ""),
                      l.language(mapping.language),
                      mapping.model.status === "asked"
                        ? l.modelAsked(t.providers[providerOf(mapping.model.model)], mapping.model.lines, mapping.model.cached)
                        : mapping.model.status === "unavailable"
                          ? l.modelUnavailable(hideModels(mapping.model.error))
                          : l.modelNotNeeded,
                    ]
                  : [l.noTrace]
              }
            />
            <div className="mt-2">
              {items.map((i) => {
                if (i.kind !== "test") return null;
                const m = view.proposal.tests[i.index].mapping;
                return (
                  <ItemLog
                    key={i.key}
                    light={m.state}
                    title={view.proposal.tests[i.index].text}
                    note={m.source ? t.mappingSource[m.source] : t.server(m.reason)}
                    onGo={() => onFocus(i.key)}
                  >
                    <Steps steps={explainLine(i, work, t)} />
                  </ItemLog>
                );
              })}
            </div>
          </Section>

          {view.decision ? (
            <Section title={l.sections.decision}>
              {view.decision.decision === "approved" && view.decision.approved ? (
                <Lines
                  lines={[
                    l.approvedSummary(who(view.decision.technician), when(view.decision.at)),
                    l.actionCounts(countActions([...view.decision.approved.fields, ...view.decision.approved.tests].map((x) => x.action), l.actions)),
                    ...linkLines(view.decision.approved.chosen ?? {}, view, t),
                  ]}
                />
              ) : (
                <Lines
                  lines={[
                    l.rejectedSummary(who(view.decision.technician), when(view.decision.at)),
                    rejection(view.decision.reason ?? "", t),
                  ]}
                />
              )}
            </Section>
          ) : (
            <Section title={l.sections.yours}>
              <Lines lines={yourWork(work, items, t)} />
            </Section>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-0.5 text-xs text-slate-700">
      {lines.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

/** One item of the log: folded to its title and outcome, unfolded to its steps. */
function ItemLog({ light, title, note, onGo, children }: { light: keyof typeof LIGHT_DOT; title: string; note: string; onGo: () => void; children: React.ReactNode }) {
  return (
    <details className="group border-b border-slate-100 py-1.5 last:border-0" open={light === "red" || light === "orange"}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
        <span className={`size-2 shrink-0 rounded-full ${LIGHT_DOT[light]}`} aria-hidden />
        <span className="font-medium text-slate-800">{title}</span>
        <span className="min-w-0 flex-1 truncate text-slate-500">{note}</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onGo();
          }}
          className="shrink-0 text-slate-400 hover:text-brand-700"
          aria-label={title}
        >
          →
        </button>
      </summary>
      <div className="mt-1.5 pb-1 pl-4">{children}</div>
    </details>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function countActions(actions: string[], names: Record<string, string>): string {
  const counts = new Map<string, number>();
  for (const a of actions) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts].map(([a, n]) => `${n} ${names[a] ?? a}`).join(", ");
}

function rejection(reason: string, t: ReturnType<typeof useI18n>["t"]): string {
  const [code, ...note] = reason.split(": ");
  const text = (t.verify.rejectReasons as Record<string, string>)[code] ?? code;
  return note.length > 0 ? `${text} · ${note.join(": ")}` : text;
}

function linkLines(chosen: Partial<Record<"patient" | "physician" | "insurer", string | null>>, view: Work["view"], t: ReturnType<typeof useI18n>["t"]): string[] {
  return (Object.entries(chosen) as ["patient" | "physician" | "insurer", string | null][]).map(([k, id]) =>
    id ? t.log.linkSet(t.records[k], view.records[id]?.title ?? id) : t.log.linkNone(t.records[k]),
  );
}

/** What the technician has done on the page so far, before approving. */
function yourWork(w: Work, items: Item[], t: ReturnType<typeof useI18n>["t"]): string[] {
  const l = t.log;
  const out: string[] = [];
  for (const i of items) {
    if (i.kind === "field") {
      const v = (w.values[i.key] ?? "").trim();
      const p = (i.fused.value ?? "").trim();
      if (v !== p) out.push(`${t.fieldLabel(i.spec)}: «${p || "–"}» → «${v || "–"}»`);
    } else {
      const codes = w.chosen[i.key];
      const m = w.view.proposal.tests[i.index].mapping;
      const text = w.view.proposal.tests[i.index].text;
      if (codes === null) out.push(`${text}: ${l.actions.dropped}`);
      else if (codes && codes.join() !== (m.codes ?? []).join()) out.push(`${text}: ${codes.join(" + ") || "–"}`);
    }
  }
  for (const a of w.added) out.push(`${a.text || l.actions.added}: ${a.codes.join(" + ") || "–"} (${l.actions.added})`);
  if (w.confirmed.size > 0) out.push(t.verify.confirmedCount(w.confirmed.size));
  out.push(...linkLines(chosenOf(w), w.view, t));
  return out.length > 0 ? out : [l.nothingYet];
}

/** The links set by hand, read from the fusion on screen. */
function chosenOf(w: Work) {
  const links = w.view.proposal.fused.links;
  return Object.fromEntries(
    (["patient", "physician", "insurer"] as const).filter((k) => links[k].chosen).map((k) => [k, links[k].recordId]),
  ) as Partial<Record<"patient" | "physician" | "insurer", string | null>>;
}
