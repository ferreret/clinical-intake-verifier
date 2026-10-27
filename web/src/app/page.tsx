"use client";

/**
 * The entry: what the product does, in the order a request goes through it, and the
 * technician to work as. Picking one is not a login (decision of 2026-10-27); it is who the
 * audit trail will say approved each request.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";

import { api, type SessionInfo } from "./_ui/api";
import { Avatar } from "./_ui/avatar";
import { ArrowRight, Database, Logo, ScanLine, Sparkles, Tags, UserCheck } from "./_ui/icons";

const STEPS: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; text: string }[] = [
  { icon: ScanLine, title: "Read", text: "A vision model reads the scanned request, field by field, with where it found each value." },
  { icon: Database, title: "Check", text: "The lab's own records confirm or contradict what was read. When they disagree, the model does not win." },
  { icon: Tags, title: "Map", text: "Each requested test, worded the insurer's way, gets the lab's own codes." },
  { icon: UserCheck, title: "Approve", text: "Nothing counts until a technician approves it: who, when and exactly what." },
];

const LIGHTS = [
  { dot: "bg-emerald-500", label: "Agrees with the lab's records" },
  { dot: "bg-amber-500", label: "Only the model says so" },
  { dot: "bg-red-500", label: "They disagree: you decide" },
  { dot: "bg-neutral-300", label: "Absent, and optional" },
];

/** Measured on 200 synthetic requests (docs/roadmap.md, F4 block 6). */
const FIGURES = [
  { value: "99.8%", label: "field precision, Gemini" },
  { value: "0", label: "reading errors shown green" },
  { value: "1.5%", label: "test lines left to the technician" },
  { value: "0", label: "documents linked to the wrong patient" },
];

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.session().then(setSession, (e: Error) => setError(e.message));
  }, []);

  async function pick(id: string) {
    setBusy(id);
    try {
      await api.pickTechnician(id);
      router.push("/batches");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="backdrop-grid pointer-events-none absolute inset-x-0 top-0 h-[44rem]" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <nav className="flex items-center gap-2.5 py-5">
          <Logo className="size-8" />
          <span className="font-semibold tracking-tight">Intake Verifier</span>
          {session?.mode === "replay" && (
            <span className="ml-auto rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 backdrop-blur">
              Demo · synthetic data
            </span>
          )}
        </nav>

        <section className="grid items-center gap-10 pt-10 pb-12 sm:pt-16 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 backdrop-blur">
              <Sparkles className="size-3.5" />
              Clinical lab requests, with a person in the loop
            </span>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl xl:text-6xl">
              The model reads. The records check. <span className="text-brand-600">A person decides.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-pretty text-slate-600">
              A technician stops typing scanned requests and starts verifying them. Every value arrives with a traffic
              light and its provenance; the model is one source among several, never the source of truth.
            </p>
          </div>
          <HeroPreview />
        </section>

        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card relative p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <s.icon className="size-5" />
                </span>
                <span className="text-xs font-semibold tracking-wide text-slate-400">0{i + 1}</span>
              </div>
              <h2 className="mt-4 font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          <div className="card p-5">
            <h2 className="text-sm font-semibold">The traffic light</h2>
            <p className="mt-1 text-xs text-slate-500">A colour is a signal, never an acceptance.</p>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {LIGHTS.map((l) => (
                <li key={l.label} className="flex items-center gap-2.5 text-sm text-slate-700">
                  <span className={`size-2.5 rounded-full ${l.dot} ring-4 ring-white shadow-sm`} />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="card grid grid-cols-2 gap-px overflow-hidden bg-slate-100 sm:grid-cols-4 lg:grid-cols-2">
            {FIGURES.map((f) => (
              <div key={f.label} className="bg-white p-5">
                <div className="text-3xl font-semibold tracking-tight tabular-nums">{f.value}</div>
                <div className="mt-1 text-xs text-slate-500">{f.label}</div>
              </div>
            ))}
          </div>
        </div>

        <section className="py-14">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Start working</h2>
              <p className="mt-1 text-sm text-slate-600">Pick the technician you are. Invented people: this is not a login.</p>
            </div>
            {session?.mode === "replay" && (
              <p className="max-w-md text-xs text-slate-500">
                The models&apos; real replies were recorded beforehand and are replayed {session.replaySpeed}× faster.
                Your batches stay in a sandbox of your own for a day.
              </p>
            )}
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {(session?.technicians ?? []).map((t) => {
              const current = session?.technician?.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => pick(t.id)}
                    disabled={busy !== null}
                    className={`card group flex w-full items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] disabled:opacity-60 ${
                      current ? "ring-2 ring-brand-500" : ""
                    }`}
                  >
                    <Avatar name={t.name} className="size-11 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="text-xs text-slate-500">
                        {busy === t.id ? "Opening…" : current ? "Continue where you left off" : "Laboratory technician"}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
        </section>

        <footer className="border-t border-slate-200 py-6 text-xs text-slate-500">
          Every document, person and insurer here is synthetic, generated by the project. Measured figures: 200
          synthetic requests, read and checked end to end.
        </footer>
      </div>
    </div>
  );
}

/** A glimpse of the verification screen: synth-000000's values, with a disagreement added to show red. */
function HeroPreview() {
  const rows: { field: string; value: string; light: string; note?: string }[] = [
    { field: "Patient", value: "Rosario Torrecilla Tovar", light: "bg-emerald-500" },
    { field: "Date of birth", value: "02/04/2006", light: "bg-emerald-500" },
    { field: "Sex", value: "M", light: "bg-red-500", note: "records say H" },
    { field: "Insurer card", value: "266880212888", light: "bg-amber-500", note: "model only" },
  ];
  return (
    <div className="relative hidden lg:block" aria-hidden>
      <div className="card absolute -top-4 right-10 h-64 w-48 rotate-6 p-4 opacity-80">
        <div className="h-2 w-20 rounded bg-slate-200" />
        <div className="mt-3 space-y-2">
          {[24, 32, 28, 36, 20, 30, 26].map((w, i) => (
            <div key={i} className="h-1.5 rounded bg-slate-100" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <div className="mt-4 h-10 rounded-md border-2 border-dashed border-brand-300 bg-brand-50/60" />
      </div>
      <div className="card relative mr-16 -rotate-1 p-5 shadow-[var(--shadow-lift)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Request 2026/696634</span>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">To verify</span>
        </div>
        <ul className="mt-4 divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.field} className="flex items-center gap-3 py-2.5">
              <span className={`size-2.5 rounded-full ${r.light}`} />
              <span className="w-28 text-xs text-slate-500">{r.field}</span>
              <span className="flex-1 truncate text-sm font-medium">{r.value}</span>
              {r.note && <span className="text-[11px] text-slate-500">{r.note}</span>}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {["UREA SÉRICA → BQ1231", "CREAT → BQ1558", "GGT → BQ7296"].map((t) => (
            <span key={t} className="rounded-md bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">
              {t}
            </span>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <span className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white">Approve request</span>
        </div>
      </div>
    </div>
  );
}
