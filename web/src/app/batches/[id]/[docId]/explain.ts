/**
 * The decision log in words: for each field and line, the steps that led to its proposal and
 * what the technician did with it; for the document, how it was read, linked and mapped.
 *
 * What cannot be derived later was recorded when the document was processed (the memory as
 * it was, the mapping model's consultation: `seen`, `trace`). The rest is derived here from
 * what is stored, the same way the engine did: the reading from the prediction, and each
 * field's comparison from the fusion and fields.json, so it also holds after the technician
 * links a record by hand.
 */
import type { MemoryEntry } from "@/lib/mapping/memory";
import { compareKey, valuesMatch } from "@/lib/schema/compare";

import { hideModels, type ProposalView } from "../../../_ui/api";
import type { Messages } from "../../../_ui/messages/en";
import { codesKey, type Check, type Item, type Light } from "./model";
import type { AddedLine, Chosen } from "./tests";

export type StepKind = keyof Messages["log"]["steps"];

export interface Step {
  kind: StepKind;
  text: string;
  /** The colour the step led to, when it set one. */
  tone?: Light;
}

/** The technician's work on the page, which the last step of each item tells. */
export interface Work {
  view: ProposalView;
  values: Record<string, string>;
  chosen: Chosen;
  added: AddedLine[];
  confirmed: Set<string>;
  checks: Record<string, Check>;
  names: Record<string, string>;
}

type FieldItem = Extract<Item, { kind: "field" }>;
type TestItem = Extract<Item, { kind: "test" }>;

const codesText = (codes: string[], names: Record<string, string>) =>
  codes.map((c) => (codes.length <= 2 && names[c] ? `${c} (${names[c]})` : c)).join(" + ");

export function explainField(item: FieldItem, w: Work, t: Messages): Step[] {
  const l = t.log;
  const { fused: f, spec } = item;
  const steps: Step[] = [];

  steps.push({ kind: "read", text: f.ai ? l.readValue(f.ai.value, f.ai.page) : l.notRead });
  if (f.ai && f.ai.warnings.length > 0) steps.push({ kind: "read", text: l.readWarnings(f.ai.warnings.join(", ")) });

  if (!spec.lis) steps.push({ kind: "records", text: l.noRecordField });
  else if (!f.lis) steps.push({ kind: "records", text: l.noRecordLinked });
  else {
    const who = w.view.records[f.lis.recordId]?.title ?? f.lis.recordId;
    steps.push({ kind: "records", text: l.recordValue(f.lis.value, who, f.lis.confirmed) });
  }

  if (f.ai && f.lis && spec.lis) {
    const mode = spec.lis.compare;
    const same = valuesMatch(f.ai.value, f.lis.value, mode);
    steps.push({
      kind: "compare",
      text: l.compared(l.modes[mode] ?? mode, compareKey(f.ai.value, mode), compareKey(f.lis.value, mode), same),
    });
    // Agreeing although the two differ: it matched one of the insurer's other names.
    if (!same && (f.reason === "agree" || f.reason === "candidate_agrees")) steps.push({ kind: "compare", text: l.alias });
  }

  steps.push({ kind: "rule", text: l.rule(t.reasons[f.reason], l.lights[f.state]), tone: f.state });

  if (f.value !== null && f.source) {
    const stored = f.source === "ai" && f.ai && spec.stored_as && f.value !== f.ai.value;
    const from = t.fields.from(t.fields.sources[f.source]) + (stored ? `, ${l.storedAs}` : "");
    steps.push({ kind: "proposed", text: l.proposedFrom(f.value, from) });
  } else {
    steps.push({ kind: "proposed", text: l.noneProposed });
  }

  const you = youOnField(item, w, t);
  if (you) steps.push(you);
  return steps;
}

function youOnField(item: FieldItem, w: Work, t: Messages): Step | null {
  const l = t.log;
  const record = w.view.decision?.approved;
  if (record) {
    const done = record.fields.find((x) => x.name === item.spec.name);
    if (!done) return null;
    const text = done.action === "changed" ? (done.value ? l.youChanged(done.value) : l.youEmptied) : l.actions[done.action];
    return { kind: "you", text: capitalise(text) };
  }
  const value = (w.values[item.key] ?? "").trim();
  if (value !== (item.fused.value ?? "").trim()) return { kind: "you", text: value ? l.youChanged(value) : l.youEmptied };
  const check = w.checks[item.key];
  if (check?.confirmable) return { kind: "you", text: w.confirmed.has(item.key) ? l.youConfirmed : l.youPending };
  if (item.fused.state === "green") return { kind: "you", text: l.youCovered };
  return null;
}

/** How the memory's entries for a line decided it, as propose.ts does. */
function memoryVerdict(memory: MemoryEntry[], t: Messages): Step {
  const l = t.log;
  const trusted = memory.filter((e) => e.active > 0);
  if (trusted.length > 1) return { kind: "memory", text: l.memoryConflict(trusted.length), tone: "red" };
  if (trusted.length === 1) {
    const e = trusted[0];
    return e.active >= 2 && e.corrections === 0
      ? { kind: "memory", text: l.memoryGreen(e.active), tone: "green" }
      : { kind: "memory", text: l.memoryOrange, tone: "orange" };
  }
  return { kind: "memory", text: memory.length > 0 ? l.memoryPassive : l.memoryNone };
}

export function explainLine(item: TestItem, w: Work, t: Messages): Step[] {
  const l = t.log;
  const line = w.view.proposal.tests[item.index];
  const m = line.mapping;
  const seen = m.seen;
  const fmt = (n: number) => n.toLocaleString(t.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const steps: Step[] = [{ kind: "read", text: l.lineRead(line.text, line.page) }];

  if (!seen) {
    steps.push({ kind: "memory", text: l.noTrace });
  } else {
    for (const e of seen.memory) {
      steps.push({ kind: "memory", text: l.memoryEntry(codesText(e.codes, w.names), e.active, e.passive, e.corrections) });
    }
    steps.push(memoryVerdict(seen.memory, t));
    if (seen.elsewhere !== null) {
      const other = seen.elsewhere.filter((e) => e.active > 0).sort((a, b) => b.active - a.active)[0];
      steps.push(
        other
          ? { kind: "elsewhere", text: l.elsewhereUsed(codesText(other.codes, w.names), other.active), tone: "orange" }
          : { kind: "elsewhere", text: l.elsewhereNone },
      );
    }
  }

  // The catalog search decides only when the memory did not.
  const settled = m.source === "memory" || m.source === "memory_elsewhere" || (seen && seen.memory.filter((e) => e.active > 0).length > 1);
  if (settled) {
    steps.push({ kind: "search", text: l.notConsulted });
  } else {
    const [first, second] = m.candidates;
    if (!first) steps.push({ kind: "search", text: l.searchNothing, tone: "red" });
    else {
      const top = m.candidates.slice(0, 3).map((c) => `${c.label} (${fmt(c.score)})`);
      steps.push({ kind: "search", text: l.searchTop(top.join(", ")) });
      if (seen) {
        const lead = first.score - (second?.score ?? 0);
        const stands = first.score >= seen.search.minScore && lead >= seen.search.minLead;
        steps.push({
          kind: "search",
          text: l.searchRule(fmt(first.score), fmt(lead), fmt(seen.search.minScore), fmt(seen.search.minLead), stands),
          tone: stands ? "orange" : "red",
        });
      }
    }
    const model = w.view.proposal.trace?.mapping.model;
    if (seen?.model) {
      steps.push(
        seen.model.answer
          ? { kind: "model", text: l.modelAnswer(codesText(seen.model.answer, w.names)), tone: "orange" }
          : { kind: "model", text: l.modelNone, tone: "red" },
      );
    } else if (m.state === "red" && model?.status === "unavailable") {
      steps.push({ kind: "model", text: l.modelUnavailable(hideModels(model.error)), tone: "red" });
    } else if (seen) {
      steps.push({ kind: "model", text: l.modelNotNeeded });
    }
  }

  const source = m.source ? t.mappingSource[m.source] : t.server(m.reason);
  steps.push({
    kind: "result",
    text: capitalise(m.codes ? l.result(l.lights[m.state], codesText(m.codes, w.names), source) : l.resultNone(l.lights[m.state])),
    tone: m.state,
  });

  const you = youOnLine(item, w, t);
  if (you) steps.push(you);
  return steps;
}

function youOnLine(item: TestItem, w: Work, t: Messages): Step | null {
  const l = t.log;
  const record = w.view.decision?.approved;
  if (record) {
    const done = record.tests[item.index];
    if (!done) return null;
    if (done.action === "dropped") return { kind: "you", text: l.youDropped };
    const text = done.action === "corrected" || done.action === "chosen" ? l.youCodes(codesText(done.codes ?? [], w.names)) : l.actions[done.action];
    return { kind: "you", text: capitalise(text) };
  }
  const codes = w.chosen[item.key];
  const m = w.view.proposal.tests[item.index].mapping;
  if (codes === null) return { kind: "you", text: l.youDropped };
  if (codes && codesKey(codes) !== codesKey(m.codes)) return { kind: "you", text: l.youCodes(codesText(codes, w.names)) };
  const check = w.checks[item.key];
  if (check?.confirmable) return { kind: "you", text: w.confirmed.has(item.key) ? l.youConfirmed : l.youPending };
  if (m.state === "green") return { kind: "you", text: l.youCovered };
  return null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
