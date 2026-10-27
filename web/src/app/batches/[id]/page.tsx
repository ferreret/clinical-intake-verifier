"use client";

/**
 * One batch: its documents in order, where each one is, and for those already read, who read
 * them and how their fields and lines came out. Refreshed while any document is moving.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ACTIVE_STATES, api, PROVIDER_LABEL, type BatchDetail, type DocumentState } from "../../_ui/api";
import { Avatar } from "../../_ui/avatar";
import { ArrowRight, Clock, Cloud, Cpu, FileText, Retry, Upload } from "../../_ui/icons";
import { usePolling } from "../../_ui/polling";
import { BackLink, PageHeader, useSession } from "../../_ui/session";
import { BAR_ORDER, LightCounts, StateBadge, StatesBar, StatesLegend } from "../../_ui/states";

export default function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const { technicians, replaySpeed } = useSession();
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = () => api.batch(id).then(setDetail, (e: Error) => setError(e.message));
  useEffect(() => void load(), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const moving = detail?.documents.some((d) => ACTIVE_STATES.includes(d.state)) ?? false;
  usePolling(load, moving);

  async function retry(documentId: string) {
    setRetrying(documentId);
    try {
      await api.retry(documentId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(null);
    }
  }

  if (error && !detail) return <p className="text-sm text-rose-700">{error}</p>;
  if (!detail) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
        <div className="card h-40 animate-pulse" />
      </div>
    );
  }

  const { batch, documents } = detail;
  const states = Object.fromEntries(BAR_ORDER.map((s) => [s, documents.filter((d) => d.state === s).length])) as Record<
    DocumentState,
    number
  >;
  const creator = technicians.find((t) => t.id === batch.createdBy)?.name ?? batch.createdBy;
  const ProviderIcon = batch.provider === "gemini" ? Cloud : Cpu;
  const read = documents.filter((d) => d.summary);
  const meanSeconds = read.length ? read.reduce((a, d) => a + d.summary!.latencyMs, 0) / read.length / 1000 : null;
  const done = documents.length - states.queued - states.extracting;

  return (
    <>
      <PageHeader
        back={<BackLink href="/batches">Batches</BackLink>}
        title={batch.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <ProviderIcon className="size-4 text-slate-400" /> {PROVIDER_LABEL[batch.provider]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={creator} className="size-5 text-[9px]" /> {creator}
            </span>
            <span>{new Date(batch.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
          </span>
        }
      />

      <section className="card mb-6 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm font-medium">
              {moving ? "Reading the documents…" : states.awaiting_verification > 0 ? "Ready for verification" : "Progress"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {done} of {documents.length} read
            </div>
          </div>
          <dl className="flex gap-8 text-right">
            <div>
              <dt className="text-xs text-slate-500">To verify</dt>
              <dd className="text-xl font-semibold tabular-nums text-violet-700">{states.awaiting_verification}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Mean read time</dt>
              <dd className="text-xl font-semibold tabular-nums">{meanSeconds === null ? "–" : `${meanSeconds.toFixed(1)} s`}</dd>
            </div>
          </dl>
        </div>
        <StatesBar states={states} total={documents.length} className="mt-4 h-2.5" />
        <div className="mt-3">
          <StatesLegend states={states} />
        </div>
      </section>

      {error && <p className="mb-4 text-sm text-rose-700">{error}</p>}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="py-2.5 pl-5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Document</th>
                <th className="px-3 py-2.5 font-medium">State</th>
                <th className="px-3 py-2.5 font-medium">Fields</th>
                <th className="px-3 py-2.5 font-medium">Test lines</th>
                <th className="px-3 py-2.5 font-medium">Read</th>
                <th className="py-2.5 pr-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) => (
                <tr key={d.id} className="align-middle transition hover:bg-slate-50/60">
                  <td className="py-3 pl-5 tabular-nums text-slate-400">{d.position}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      {d.origin === "upload" ? (
                        <Upload className="size-4 text-sky-500" />
                      ) : (
                        <FileText className="size-4 text-slate-400" />
                      )}
                      <span className="font-mono text-xs">{d.fileName.replace(/\.pdf$/, "")}</span>
                    </span>
                    {d.state === "failed" && d.error && <p className="mt-1 max-w-xs text-xs text-rose-700">{d.error}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2">
                      <StateBadge state={d.state} />
                      {d.state === "failed" && (
                        <button
                          type="button"
                          onClick={() => retry(d.id)}
                          disabled={retrying === d.id}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-white disabled:opacity-50"
                        >
                          <Retry className="size-3.5" /> Retry
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3">{d.summary ? <LightCounts counts={d.summary.fields} /> : <Pending state={d.state} />}</td>
                  <td className="px-3 py-3">{d.summary ? <LightCounts counts={d.summary.tests} /> : <Pending state={d.state} />}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-600">
                    {d.summary ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3.5 text-slate-400" />
                        <span className="tabular-nums">{(d.summary.latencyMs / 1000).toFixed(1)} s</span>
                        <span className="text-slate-400">·</span>
                        <span>{d.summary.model}</span>
                        {d.summary.recorded && (
                          <span
                            className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200"
                            title={`The time the model took when recorded; replayed ${replaySpeed ?? 1}× faster here.`}
                          >
                            recorded
                          </span>
                        )}
                      </span>
                    ) : d.attempts > 1 ? (
                      `attempt ${d.attempts}`
                    ) : (
                      <span className="text-slate-300">–</span>
                    )}
                  </td>
                  <td className="py-3 pr-5 text-right">
                    {(d.state === "awaiting_verification" || d.state === "in_verification") && (
                      <Link
                        href={`/batches/${batch.id}/${d.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700"
                      >
                        Verify <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="mt-3 text-xs text-slate-500">
        Colours are signals, never acceptance: green means a proposal with strong evidence, still to be approved.
      </p>
    </>
  );
}

/** Where a value will be: a shimmer while the document is being read, a dash otherwise. */
function Pending({ state }: { state: DocumentState }) {
  if (state === "extracting") return <span className="block h-1.5 w-16 animate-pulse rounded-full bg-sky-100" />;
  return <span className="text-slate-300">–</span>;
}
