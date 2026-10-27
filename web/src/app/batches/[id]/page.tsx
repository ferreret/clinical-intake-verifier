"use client";

/**
 * One batch: its documents in order, where each one is, and for those already read, who read
 * them and how their fields and lines came out. Refreshed while any document is moving.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ACTIVE_STATES, api, PROVIDER_LABEL, type BatchDetail, type DocumentState } from "../../_ui/api";
import { usePolling } from "../../_ui/polling";
import { useSession } from "../../_ui/session";
import { describe, LightCounts, StateBadge, StatesBar } from "../../_ui/states";

export default function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const { technicians } = useSession();
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
  if (!detail) return <p className="text-sm text-neutral-500">Loading…</p>;

  const { batch, documents } = detail;
  const states = Object.fromEntries(
    (["queued", "extracting", "failed", "awaiting_verification", "in_verification", "approved", "rejected"] as DocumentState[]).map(
      (s) => [s, documents.filter((d) => d.state === s).length],
    ),
  ) as Record<DocumentState, number>;
  const creator = technicians.find((t) => t.id === batch.createdBy)?.name ?? batch.createdBy;

  return (
    <>
      <Link href="/batches" className="text-sm text-neutral-500 hover:underline">
        ← Batches
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-semibold tracking-tight">{batch.name}</h1>
        <span className="text-sm text-neutral-500">
          {PROVIDER_LABEL[batch.provider]} · created by {creator}, {new Date(batch.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="mt-4">
        <StatesBar states={states} total={documents.length} />
        <p className="mt-1.5 text-xs text-neutral-500">{describe(states)}</p>
      </div>
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Document</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Fields</th>
              <th className="px-3 py-2 font-medium">Tests</th>
              <th className="px-3 py-2 font-medium">Read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {documents.map((d) => (
              <tr key={d.id} className="align-top">
                <td className="px-3 py-2.5 tabular-nums text-neutral-500">{d.position}</td>
                <td className="px-3 py-2.5">
                  <span className="font-mono text-xs">{d.fileName}</span>
                  {d.origin === "upload" && <span className="ml-2 text-xs text-neutral-500">uploaded</span>}
                  {d.state === "failed" && d.error && <p className="mt-1 max-w-sm text-xs text-rose-700">{d.error}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <StateBadge state={d.state} />
                  {d.state === "failed" && (
                    <button
                      type="button"
                      onClick={() => retry(d.id)}
                      disabled={retrying === d.id}
                      className="ml-2 text-xs font-medium text-neutral-700 underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">{d.summary ? <LightCounts counts={d.summary.fields} /> : "–"}</td>
                <td className="px-3 py-2.5 text-xs">{d.summary ? <LightCounts counts={d.summary.tests} /> : "–"}</td>
                <td className="px-3 py-2.5 text-xs text-neutral-600">
                  {d.summary ? (
                    <>
                      {d.summary.model}, {(d.summary.latencyMs / 1000).toFixed(1)} s
                      {d.summary.recorded && <span className="ml-1 text-amber-800">(recorded)</span>}
                    </>
                  ) : d.attempts > 1 ? (
                    `attempt ${d.attempts}`
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Colours are signals, never acceptance: green means a proposal with strong evidence, still to be approved.
      </p>
    </>
  );
}
