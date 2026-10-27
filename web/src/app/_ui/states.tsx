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
  awaiting_verification: "Awaiting verification",
  in_verification: "In verification",
  approved: "Approved",
  rejected: "Rejected",
};

const STATE_STYLE: Record<DocumentState, { badge: string; bar: string }> = {
  queued: { badge: "bg-slate-100 text-slate-700", bar: "bg-slate-300" },
  extracting: { badge: "bg-sky-100 text-sky-800", bar: "bg-sky-400" },
  failed: { badge: "bg-rose-100 text-rose-800", bar: "bg-rose-500" },
  awaiting_verification: { badge: "bg-violet-100 text-violet-800", bar: "bg-violet-400" },
  in_verification: { badge: "bg-indigo-100 text-indigo-800", bar: "bg-indigo-500" },
  approved: { badge: "bg-teal-100 text-teal-800", bar: "bg-teal-600" },
  rejected: { badge: "bg-neutral-200 text-neutral-700", bar: "bg-neutral-500" },
};

/** The order a batch's progress is drawn in, from done to not started. */
const BAR_ORDER: DocumentState[] = [
  "approved",
  "rejected",
  "in_verification",
  "awaiting_verification",
  "failed",
  "extracting",
  "queued",
];

export function StateBadge({ state }: { state: DocumentState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLE[state].badge}`}>
      {state === "extracting" && <span className="size-1.5 animate-pulse rounded-full bg-sky-600" aria-hidden />}
      {STATE_LABEL[state]}
    </span>
  );
}

export function StatesBar({ states, total }: { states: Record<DocumentState, number>; total: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={describe(states)}>
      {BAR_ORDER.filter((s) => states[s] > 0).map((s) => (
        <div key={s} className={STATE_STYLE[s].bar} style={{ width: `${(100 * states[s]) / total}%` }} title={`${STATE_LABEL[s]}: ${states[s]}`} />
      ))}
    </div>
  );
}

export function describe(states: Record<DocumentState, number>): string {
  return BAR_ORDER.filter((s) => states[s] > 0)
    .map((s) => `${states[s]} ${STATE_LABEL[s].toLowerCase()}`)
    .join(" · ");
}

/** A count per traffic-light colour, as small dots. */
export function LightCounts({ counts }: { counts: Partial<Record<"green" | "orange" | "red" | "grey", number>> }) {
  const style = { green: "bg-emerald-500", orange: "bg-amber-500", red: "bg-red-500", grey: "bg-neutral-300" } as const;
  return (
    <span className="inline-flex items-center gap-2.5 tabular-nums">
      {(Object.keys(style) as (keyof typeof style)[])
        .filter((c) => (counts[c] ?? 0) > 0)
        .map((c) => (
          <span key={c} className="inline-flex items-center gap-1" title={`${counts[c]} ${c}`}>
            <span className={`size-2 rounded-full ${style[c]}`} aria-hidden />
            {counts[c]}
            <span className="sr-only">{c}</span>
          </span>
        ))}
    </span>
  );
}
