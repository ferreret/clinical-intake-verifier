"use client";

/**
 * A new batch: which model reads it, and its documents. The bundled synthetic requests in both
 * modes (in replay mode, those with a recorded reply for that model); uploaded PDFs too in
 * live mode, in the same batch if wanted. On a deployment with a private set, a discreet link
 * asks for its password, and once the workspace is unlocked the set's documents are chosen
 * the same way.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { api, type BundledInfo, type Provider } from "../../_ui/api";
import { useI18n } from "../../_ui/i18n";
import { Cloud, Cpu, FileText, Lock, Search, Shuffle, Upload, X } from "../../_ui/icons";
import { BackLink, PageHeader, useSession } from "../../_ui/session";

const MAX_DOCUMENTS = 50;
const RANDOM_SIZE = 5;

const LANGUAGE: Record<string, string> = { es: "ES", ca: "CA" };

/** The models a batch can be read by; their texts (measured on 200 synthetic requests) are in messages. */
const PROVIDERS: { id: Provider; icon: typeof Cloud }[] = [
  { id: "gemini", icon: Cloud },
  { id: "local", icon: Cpu },
];

export default function NewBatchPage() {
  const { mode } = useSession();
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("gemini");
  const [name, setName] = useState("");
  const [bundled, setBundled] = useState<BundledInfo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Absent: the deployment has no private set, and nothing about it shows. */
  const [privateSet, setPrivateSet] = useState<{ unlocked: boolean } | undefined>(undefined);
  const [privateDocs, setPrivateDocs] = useState<BundledInfo[] | null>(null);
  const [selectedPrivate, setSelectedPrivate] = useState<Set<string>>(new Set());
  /** Asked again for the documents: after the private set is unlocked. */
  const [listed, setListed] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const m = t.newBatch;

  useEffect(() => {
    let current = true;
    const keep = (docs: BundledInfo[]) => {
      const available = new Set(docs.map((d) => d.name));
      return (s: Set<string>) => new Set([...s].filter((n) => available.has(n)));
    };
    api.bundled(provider).then(
      (r) => {
        if (!current) return;
        setBundled(r.documents);
        setSelected(keep(r.documents));
        setPrivateSet(r.privateSet);
        setPrivateDocs(r.private ?? null);
        setSelectedPrivate(keep(r.private ?? []));
      },
      (e: Error) => setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [provider, listed]);

  const count = selected.size + selectedPrivate.size + files.length;

  function chooseProvider(p: Provider) {
    setProvider(p);
    setBundled(null);
    setPrivateDocs(null);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { batch } = await api.createBatch({
        provider,
        name,
        documents: [...selected].sort(),
        private: [...selectedPrivate].sort(),
        files,
      });
      router.push(`/batches/${batch.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        back={<BackLink href="/batches">{t.common.batches}</BackLink>}
        title={m.title}
        subtitle={m.subtitle}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="card p-5">
            <StepTitle n={1} title={m.whoReads} />
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
                      <span className="block font-medium">{t.providers[p.id]}</span>
                      <span className="mt-0.5 block text-xs text-slate-600">{m.providers[p.id].text}</span>
                      <span className="mt-2 block text-[11px] text-slate-500">{m.providers[p.id].meta}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="card overflow-hidden">
            <Picker
              header={<StepTitle n={2} title={m.synthetic} hint={mode === "replay" ? m.syntheticReplay(t.providers[provider]) : m.syntheticLive} />}
              documents={bundled}
              selected={selected}
              onChange={setSelected}
              room={MAX_DOCUMENTS - count}
            />
            {privateSet && !privateSet.unlocked && <PrivateSetUnlock onUnlocked={() => setListed((n) => n + 1)} />}
          </section>

          {privateSet?.unlocked && (
            <section className="card overflow-hidden">
              <Picker
                header={
                  <StepTitle
                    title={m.privateSet.title}
                    hint={`${m.privateSet.hint}${mode === "replay" ? ` ${m.syntheticReplay(t.providers[provider])}` : ""}`}
                  />
                }
                documents={privateDocs}
                selected={selectedPrivate}
                onChange={setSelectedPrivate}
                room={MAX_DOCUMENTS - count}
              />
            </section>
          )}

          {mode === "live" && (
            <section className="card p-5">
              <StepTitle n={3} title={m.yourPdfs} hint={m.yourPdfsHint} />
              <label className="mt-4 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 text-center transition hover:border-brand-300 hover:bg-brand-50/30">
                <Upload className="size-6 text-slate-400" />
                <span className="mt-2 text-sm font-medium">{m.choosePdfs}</span>
                <span className="text-xs text-slate-500">{m.pdfLimit}</span>
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
            <span className="text-sm font-medium">{m.name}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.namePlaceholder}
              maxLength={100}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
          </label>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{m.inBatch}</span>
              <span className={`text-sm tabular-nums ${count > MAX_DOCUMENTS ? "text-rose-700" : "text-slate-500"}`}>
                {count} / {MAX_DOCUMENTS}
              </span>
            </div>
            {count === 0 ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">{m.nothingYet}</p>
            ) : (
              <ul className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {[...selected].sort().map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => setSelected((s) => toggled(s, n))}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pr-1 pl-2 font-mono text-[11px] text-slate-700 transition hover:bg-slate-200"
                      title={t.common.remove}
                    >
                      {n.replace(/\.pdf$/, "")}
                      <X className="size-3 text-slate-400" />
                    </button>
                  </li>
                ))}
                {[...selectedPrivate].sort().map((n) => (
                  <li key={`private:${n}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedPrivate((s) => toggled(s, n))}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-50 py-0.5 pr-1 pl-2 font-mono text-[11px] text-amber-900 ring-1 ring-amber-200 transition hover:bg-amber-100"
                      title={t.common.remove}
                    >
                      <Lock className="size-3" />
                      {n.replace(/\.pdf$/, "")}
                      <X className="size-3 opacity-60" />
                    </button>
                  </li>
                ))}
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="inline-flex items-center gap-1 rounded-md bg-sky-50 py-0.5 pr-1 pl-2 text-[11px] text-sky-800 ring-1 ring-sky-200 transition hover:bg-sky-100"
                      title={t.common.remove}
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
            {m.readBy(t.providers[provider])}
          </div>
          {error && <p className="text-sm text-rose-700">{t.server(error)}</p>}
          <button
            type="button"
            onClick={create}
            disabled={busy || count === 0 || count > MAX_DOCUMENTS}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? m.creating : m.create(count)}
          </button>
        </aside>
      </div>
    </>
  );
}

/** The selection with `n` ticked, or unticked if it was. */
function toggled(s: Set<string>, n: string): Set<string> {
  const next = new Set(s);
  if (next.has(n)) next.delete(n);
  else next.add(n);
  return next;
}

/**
 * A list of documents to tick, with a filter and a random pick: the bundled ones, or the
 * private set's. `room`: how many more the batch can take.
 */
function Picker({
  header,
  documents,
  selected,
  onChange,
  room,
}: {
  header: ReactNode;
  documents: BundledInfo[] | null;
  selected: Set<string>;
  /** Given how to change the selection, as React's state setter is: clicks in a row each see the one before. */
  onChange: (update: (s: Set<string>) => Set<string>) => void;
  room: number;
}) {
  const [filter, setFilter] = useState("");
  const { t } = useI18n();
  const m = t.newBatch;
  const shown = useMemo(
    () => (documents ?? []).filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [documents, filter],
  );

  const toggle = (n: string) => onChange((s) => toggled(s, n));

  function pickRandom() {
    const pool = shown.filter((d) => !selected.has(d.name));
    const picked: string[] = [];
    for (let left = Math.min(RANDOM_SIZE, room); left > 0 && pool.length > 0; left--) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].name);
    }
    onChange((s) => new Set([...s, ...picked]));
  }

  return (
    <>
      <div className="p-5 pb-4">
        {header}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={m.filter}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-8 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={pickRandom}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium transition hover:bg-slate-50"
          >
            <Shuffle className="size-4 text-slate-500" /> {m.random(RANDOM_SIZE)}
          </button>
          <button
            type="button"
            onClick={() => onChange(() => new Set())}
            disabled={selected.size === 0}
            className="rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          >
            {m.clear}
          </button>
        </div>
      </div>

      <div className="max-h-[26rem] overflow-y-auto border-t border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-left text-xs text-slate-500 backdrop-blur">
            <tr>
              <th className="w-10 py-2 pl-5" />
              <th className="px-3 py-2 font-medium">{m.columns.document}</th>
              <th className="px-3 py-2 font-medium">{m.columns.pages}</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">{m.columns.kind}</th>
              <th className="px-3 py-2 pr-5 font-medium">{m.columns.lang}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents === null &&
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
                      aria-label={m.include(d.name)}
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
                      {d.scanned !== null && <Chip tone={d.scanned ? "slate" : "sky"}>{d.scanned ? m.scanned : m.digital}</Chip>}
                      {d.handwritten ? <Chip tone="amber">{m.handwriting}</Chip> : null}
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
    </>
  );
}

/** The discreet link to the private set, and the password it asks for. */
function PrivateSetUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const m = t.newBatch.privateSet;

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.unlockPrivateSet(password);
      setPassword("");
      setOpen(false);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end border-t border-slate-100 px-5 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded px-1 text-xs text-slate-400 transition hover:text-slate-600"
        >
          <Lock className="size-3.5" />
          {m.link}
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={unlock} className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
      <Lock className="size-4 text-slate-400" />
      <input
        type="password"
        name="private-set-password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={m.password}
        aria-label={m.password}
        maxLength={256}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy || password === ""}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-40"
      >
        {busy ? m.unlocking : m.unlock}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setPassword("");
          setError(null);
        }}
        className="rounded-lg px-2 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
      >
        {m.cancel}
      </button>
      {error && <p className="w-full text-xs text-rose-700">{t.server(error)}</p>}
    </form>
  );
}

/** A step's number, or a lock for the private set, which comes with the step before it. */
function StepTitle({ n, title, hint }: { n?: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${n === undefined ? "bg-amber-600" : "bg-slate-900"}`}
      >
        {n ?? <Lock className="size-3.5" />}
      </span>
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
