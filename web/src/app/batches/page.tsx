"use client";

/** The workspace's batches, newest first, each with its progress; refreshed while any is moving. */
import Link from "next/link";
import { useEffect, useState } from "react";

import { ACTIVE_STATES, api, PROVIDER_LABEL, type BatchSummary, type DocumentState } from "../_ui/api";
import { ArrowRight, Cloud, Cpu, Layers, Plus } from "../_ui/icons";
import { usePolling } from "../_ui/polling";
import { PageHeader } from "../_ui/session";
import { StatesBar, StatesLegend } from "../_ui/states";

export default function BatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const moving = batches?.some((b) => ACTIVE_STATES.some((s) => b.states[s] > 0)) ?? false;

  const load = () => api.batches().then((r) => setBatches(r.batches), (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  usePolling(load, moving);

  const total = (s: DocumentState) => batches?.reduce((a, b) => a + b.states[s], 0) ?? 0;
  const tiles = [
    { label: "To verify", value: total("awaiting_verification"), tone: "text-violet-700" },
    { label: "Reading", value: total("extracting") + total("queued"), tone: "text-sky-700" },
    { label: "Approved", value: total("approved"), tone: "text-teal-700" },
    { label: "Failed", value: total("failed"), tone: "text-rose-700" },
  ];

  return (
    <>
      <PageHeader
        title="Batches"
        subtitle="Each document is read, checked against the lab's records and mapped to its codes, then waits for you."
        action={
          <Link
            href="/batches/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700"
          >
            <Plus className="size-4" /> New batch
          </Link>
        }
      />

      {batches && batches.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="card px-4 py-3.5">
              <div className={`text-2xl font-semibold tracking-tight tabular-nums ${t.value ? t.tone : "text-slate-300"}`}>{t.value}</div>
              <div className="text-xs text-slate-500">{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-rose-700">{error}</p>}
      {batches === null && !error && <div className="card h-28 animate-pulse" />}

      {batches?.length === 0 && (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <Layers className="size-7" />
          </span>
          <p className="mt-5 text-lg font-semibold">No batches yet</p>
          <p className="mt-1 max-w-sm text-sm text-slate-600">
            Put a few synthetic requests in a batch and watch them being read, checked and mapped.
          </p>
          <Link
            href="/batches/new"
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            <Plus className="size-4" /> Create your first batch
          </Link>
        </div>
      )}

      <ul className="space-y-3">
        {batches?.map((b) => {
          const ProviderIcon = b.provider === "gemini" ? Cloud : Cpu;
          const toVerify = b.states.awaiting_verification;
          return (
            <li key={b.id}>
              <Link
                href={`/batches/${b.id}`}
                className="card group block p-4 transition hover:-translate-y-px hover:shadow-[var(--shadow-lift)] sm:p-5"
              >
                <div className="flex items-start gap-4">
                  <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-200 sm:flex">
                    <ProviderIcon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="truncate font-semibold">{b.name}</span>
                      {toVerify > 0 && (
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 ring-inset">
                          {toVerify} to verify
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {PROVIDER_LABEL[b.provider]} · {b.documents} document{b.documents === 1 ? "" : "s"} ·{" "}
                      {new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    <StatesBar states={b.states} total={b.documents} className="mt-3.5 h-1.5" />
                    <div className="mt-2.5">
                      <StatesLegend states={b.states} />
                    </div>
                  </div>
                  <ArrowRight className="mt-2 size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
