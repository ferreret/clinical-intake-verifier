"use client";

/**
 * A new batch: which model reads it, and its documents. The bundled synthetic requests in both
 * modes (in replay mode, those with a recorded reply for that model); uploaded PDFs too in
 * live mode, in the same batch if wanted.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api, PROVIDER_LABEL, type BundledInfo, type Provider } from "../../_ui/api";
import { Cloud, Cpu, FileText, Search, Shuffle, Upload, X } from "../../_ui/icons";
import { BackLink, PageHeader, useSession } from "../../_ui/session";

const MAX_DOCUMENTS = 50;
const RANDOM_SIZE = 5;

const LANGUAGE: Record<string, string> = { es: "ES", ca: "CA" };

/** Measured on 200 synthetic requests (docs/roadmap.md, section 3). */
const PROVIDERS: { id: Provider; icon: typeof Cloud; title: string; text: string; meta: string }[] = [
  {
    id: "gemini",
    icon: Cloud,
    title: "Gemini Flash",
    text: "Google's model, in the cloud. Reads the PDF itself.",
    meta: "99.8% field precision · about 9 s per document",
  },
  {
    id: "local",
    icon: Cpu,
    title: "Qwen 3.6, local",
    text: "Open weights on this machine's GPU. Nothing leaves the machine.",
    meta: "99.5% field precision · about 80 s per document",
  },
];

export default function NewBatchPage() {
  const { mode } = useSession();
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("gemini");
  const [name, setName] = useState("");
  const [bundled, setBundled] = useState<BundledInfo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.bundled(provider).then(
      (r) => {
        if (!current) return;
        setBundled(r.documents);
        const available = new Set(r.documents.map((d) => d.name));
        setSelected((s) => new Set([...s].filter((n) => available.has(n))));
      },
      (e: Error) => setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [provider]);

  const shown = useMemo(
    () => (bundled ?? []).filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [bundled, filter],
  );
  const count = selected.size + files.length;

  function chooseProvider(p: Provider) {
    setProvider(p);
    setBundled(null);
  }

  function toggle(n: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function pickRandom() {
    const pool = shown.filter((d) => !selected.has(d.name));
    const next = new Set(selected);
    while (next.size < selected.size + RANDOM_SIZE && pool.length > 0 && next.size + files.length < MAX_DOCUMENTS) {
      next.add(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].name);
    }
    setSelected(next);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { batch } = await api.createBatch({ provider, name, documents: [...selected].sort(), files });
      router.push(`/batches/${batch.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        back={<BackLink href="/batches">Batches</BackLink>}
        title="New batch"
        subtitle="Choose who reads it and which requests go in. They are queued as soon as you create it."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="card p-5">
            <StepTitle n={1} title="Who reads it" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PROVIDERS.map((p) => {
                const active = provider === p.id;
                return (
                  <label
                    key={p.id}
                    className={`relative flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
                      active ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input type="radio" name="provider" value={p.id} checked={active} onChange={() => chooseProvider(p.id)} className="sr-only" />
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${
                        active ? "bg-brand-600 text-white ring-brand-600" : "bg-slate-50 text-slate-500 ring-slate-200"
                      }`}
                    >
                      <p.icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{p.title}</span>
                      <span className="mt-0.5 block text-xs text-slate-600">{p.text}</span>
                      <span className="mt-2 block text-[11px] text-slate-500">{p.meta}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="p-5 pb-4">
              <StepTitle
                n={2}
                title="Synthetic requests"
                hint={
                  mode === "replay"
                    ? `Those with a recorded reply from ${PROVIDER_LABEL[provider]}.`
                    : "Generated by the project, with their ground truth."
                }
              />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter by name"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-8 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={pickRandom}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium transition hover:bg-slate-50"
                >
                  <Shuffle className="size-4 text-slate-500" /> Add {RANDOM_SIZE} at random
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className="rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-[26rem] overflow-y-auto border-t border-slate-100">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50/95 text-left text-xs text-slate-500 backdrop-blur">
                  <tr>
                    <th className="w-10 py-2 pl-5" />
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Pages</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Kind</th>
                    <th className="px-3 py-2 pr-5 font-medium">Lang.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bundled === null &&
                    Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={5} className="px-5 py-2.5">
                          <div className="h-4 animate-pulse rounded bg-slate-100" />
                        </td>
                      </tr>
                    ))}
                  {shown.map((d) => {
                    const on = selected.has(d.name);
                    return (
                      <tr key={d.name} onClick={() => toggle(d.name)} className={`cursor-pointer transition ${on ? "bg-brand-50/60" : "hover:bg-slate-50"}`}>
                        <td className="py-2 pl-5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(d.name)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Include ${d.name}`}
                            className="size-4 rounded accent-brand-600"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-2 font-mono text-xs">
                            <FileText className="size-4 text-slate-400" />
                            {d.name.replace(/\.pdf$/, "")}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-600">{d.pages ?? "–"}</td>
                        <td className="hidden px-3 py-2 sm:table-cell">
                          <span className="flex flex-wrap gap-1">
                            {d.scanned !== null && <Chip tone={d.scanned ? "slate" : "sky"}>{d.scanned ? "Scanned" : "Digital"}</Chip>}
                            {d.handwritten ? <Chip tone="amber">Handwriting</Chip> : null}
                          </span>
                        </td>
                        <td className="px-3 py-2 pr-5">
                          {d.language ? <Chip tone="slate">{LANGUAGE[d.language] ?? d.language}</Chip> : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {mode === "live" && (
            <section className="card p-5">
              <StepTitle n={3} title="Your PDFs" hint="Kept on this machine, outside the repository, and read by the model you chose." />
              <label className="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 text-center transition hover:border-brand-300 hover:bg-brand-50/30">
                <Upload className="size-6 text-slate-400" />
                <span className="mt-2 text-sm font-medium">Choose PDFs to upload</span>
                <span className="text-xs text-slate-500">Up to 20 MB each</span>
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])}
                  className="sr-only"
                />
              </label>
            </section>
          )}
        </div>

        <aside className="card space-y-5 p-5 lg:sticky lg:top-20">
          <label className="block">
            <span className="text-sm font-medium">Batch name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional, e.g. Morning post"
              maxLength={100}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
          </label>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">In this batch</span>
              <span className={`text-sm tabular-nums ${count > MAX_DOCUMENTS ? "text-rose-700" : "text-slate-500"}`}>
                {count} / {MAX_DOCUMENTS}
              </span>
            </div>
            {count === 0 ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Nothing yet: tick a few requests.</p>
            ) : (
              <ul className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {[...selected].sort().map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => toggle(n)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pr-1 pl-2 font-mono text-[11px] text-slate-700 transition hover:bg-slate-200"
                      title="Remove"
                    >
                      {n.replace(/\.pdf$/, "")}
                      <X className="size-3 text-slate-400" />
                    </button>
                  </li>
                ))}
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="inline-flex items-center gap-1 rounded-md bg-sky-50 py-0.5 pr-1 pl-2 text-[11px] text-sky-800 ring-1 ring-sky-200 transition hover:bg-sky-100"
                      title="Remove"
                    >
                      <Upload className="size-3" />
                      {f.name}
                      <X className="size-3 opacity-60" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {provider === "gemini" ? <Cloud className="size-4" /> : <Cpu className="size-4" />}
            Read by {PROVIDER_LABEL[provider]}
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <button
            type="button"
            onClick={create}
            disabled={busy || count === 0 || count > MAX_DOCUMENTS}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Creating…" : count > 0 ? `Create and read ${count} document${count === 1 ? "" : "s"}` : "Create and read"}
          </button>
        </aside>
      </div>
    </>
  );
}

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{n}</span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "slate" | "sky" | "amber"; children: string }) {
  const style = {
    slate: "bg-slate-100 text-slate-600",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-800",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${style}`}>{children}</span>;
}
