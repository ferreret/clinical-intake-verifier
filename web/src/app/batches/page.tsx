"use client";

/** The workspace's batches, newest first, each with its progress; refreshed while any is moving. */
import Link from "next/link";
import { useEffect, useState } from "react";

import { ACTIVE_STATES, api, PROVIDER_LABEL, type BatchSummary } from "../_ui/api";
import { usePolling } from "../_ui/polling";
import { describe, StatesBar } from "../_ui/states";

export default function BatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const moving = batches?.some((b) => ACTIVE_STATES.some((s) => b.states[s] > 0)) ?? false;

  const load = () => api.batches().then((r) => setBatches(r.batches), (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  usePolling(load, moving);

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Batches</h1>
          <p className="mt-1 text-sm text-neutral-600">Each document is read, checked against the lab&apos;s records and waits for verification.</p>
        </div>
        <Link
          href="/batches/new"
          className="shrink-0 rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          New batch
        </Link>
      </div>

      {error && <p className="mt-6 text-sm text-rose-700">{error}</p>}
      {batches?.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center">
          <p className="font-medium">No batches yet</p>
          <p className="mt-1 text-sm text-neutral-600">Create one from the synthetic requests to see them read and checked.</p>
        </div>
      )}

      <ul className="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
        {batches?.map((b) => {
          const toVerify = b.states.awaiting_verification;
          return (
            <li key={b.id}>
              <Link href={`/batches/${b.id}`} className="block px-4 py-3.5 hover:bg-neutral-50">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-xs text-neutral-500">
                    {PROVIDER_LABEL[b.provider]} · {b.documents} document{b.documents === 1 ? "" : "s"} · created{" "}
                    {new Date(b.createdAt).toLocaleString()}
                  </span>
                  {toVerify > 0 && (
                    <span className="ml-auto text-xs font-medium text-violet-800">{toVerify} to verify</span>
                  )}
                </div>
                <div className="mt-2.5">
                  <StatesBar states={b.states} total={b.documents} />
                </div>
                <p className="mt-1.5 text-xs text-neutral-500">{describe(b.states)}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
