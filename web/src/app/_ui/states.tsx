/**
 * How a document's state and a batch's progress are shown. The workflow's states have their
 * own colours, kept apart from the traffic light's green, orange and red, which say how sure
 * a proposal is, never where a document is.
 */
import type { DocumentState } from "./api";

export const STATE_LABEL: Record<DocumentState, string> = {
  queued: "Queued",
  extracting: "Reading",
  failed: "Failed",
  awaiting_verification: "To verify",
  in_verification: "In verification",
  approved: "Approved",
  rejected: "Rejected",
};

const STATE_STYLE: Record<DocumentState, { badge: string; dot: string; bar: string }> = {
  queued: { badge: "bg-slate-50 text-slate-600 ring-slate-200", dot: "bg-slate-400", bar: "bg-slate-200" },
  extracting: { badge: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500 animate-pulse", bar: "bg-sky-400" },
  failed: { badge: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500", bar: "bg-rose-500" },
  awaiting_verification: { badge: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", bar: "bg-violet-500" },
  in_verification: { badge: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "bg-indigo-500", bar: "bg-indigo-600" },
  approved: { badge: "bg-teal-50 text-teal-700 ring-teal-200", dot: "bg-teal-600", bar: "bg-teal-600" },
  rejected: { badge: "bg-neutral-100 text-neutral-600 ring-neutral-200", dot: "bg-neutral-500", bar: "bg-neutral-400" },
};

/** The order a batch's progress is drawn in, from done to not started. */
export const BAR_ORDER: DocumentState[] = [
  "approved",
  "rejected",
  "in_verification",
  "awaiting_verification",
  "failed",
  "extracting",
  "queued",
];

export function StateBadge({ state }: { state: DocumentState }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${s.badge}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      {STATE_LABEL[state]}
    </span>
  );
}

export function StatesBar({ states, total, className = "h-2" }: { states: Record<DocumentState, number>; total: number; className?: string }) {
  return (
    <div className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 ${className}`} role="img" aria-label={describe(states)}>
      {BAR_ORDER.filter((s) => states[s] > 0).map((s) => (
        <div
          key={s}
          className={`${STATE_STYLE[s].bar} transition-[width] duration-500 first:rounded-l-full last:rounded-r-full`}
          style={{ width: `${(100 * states[s]) / total}%` }}
          title={`${STATE_LABEL[s]}: ${states[s]}`}
        />
      ))}
    </div>
  );
}

/** The states present, as small labelled dots. */
export function StatesLegend({ states }: { states: Record<DocumentState, number> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {BAR_ORDER.filter((s) => states[s] > 0).map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${STATE_STYLE[s].dot}`} aria-hidden />
          <span className="font-medium tabular-nums text-slate-900">{states[s]}</span> {STATE_LABEL[s].toLowerCase()}
        </li>
      ))}
    </ul>
  );
}

export function describe(states: Record<DocumentState, number>): string {
  return BAR_ORDER.filter((s) => states[s] > 0)
    .map((s) => `${states[s]} ${STATE_LABEL[s].toLowerCase()}`)
    .join(" · ");
}

const LIGHT = {
  green: { dot: "bg-emerald-500", label: "green" },
  orange: { dot: "bg-amber-500", label: "orange" },
  red: { dot: "bg-red-500", label: "red" },
  grey: { dot: "bg-slate-300", label: "grey" },
} as const;
type Light = keyof typeof LIGHT;

/** A count per traffic-light colour, drawn as a short stacked bar with the numbers beside it. */
export function LightCounts({ counts }: { counts: Partial<Record<Light, number>> }) {
  const lights = (Object.keys(LIGHT) as Light[]).filter((c) => (counts[c] ?? 0) > 0);
  const total = lights.reduce((a, c) => a + (counts[c] ?? 0), 0);
  if (total === 0) return <span className="text-slate-400">–</span>;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex h-1.5 w-16 gap-px overflow-hidden rounded-full" aria-hidden>
        {lights.map((c) => (
          <span key={c} className={LIGHT[c].dot} style={{ width: `${(100 * (counts[c] ?? 0)) / total}%` }} />
        ))}
      </span>
      <span className="inline-flex gap-2 text-xs tabular-nums text-slate-600">
        {lights.map((c) => (
          <span key={c} className="inline-flex items-center gap-1" title={`${counts[c]} ${LIGHT[c].label}`}>
            <span className={`size-1.5 rounded-full ${LIGHT[c].dot}`} aria-hidden />
            {counts[c]}
            <span className="sr-only">{LIGHT[c].label}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
