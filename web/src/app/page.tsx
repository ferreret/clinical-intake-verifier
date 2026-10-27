"use client";

/**
 * The entry: what the product does, in the order a request goes through it, and the
 * technician to work as. Picking one is not a login (decision of 2026-10-27); it is who the
 * audit trail will say approved each request.
 */
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";

import { api, type SessionInfo } from "./_ui/api";
import { Avatar } from "./_ui/avatar";
import { LanguageSwitch, useI18n } from "./_ui/i18n";
import { ArrowRight, Database, Logo, ScanLine, Sparkles, Tags, UserCheck } from "./_ui/icons";

/** The four steps' icons, in the order of the texts (messages: entry.steps). */
const STEPS: ComponentType<SVGProps<SVGSVGElement>>[] = [ScanLine, Database, Tags, UserCheck];

const LIGHTS = ["bg-emerald-500", "bg-amber-500", "bg-red-500", "bg-neutral-300"];

/** Measured on 200 synthetic requests (docs/roadmap.md, F4 block 6), as fractions or counts. */
const FIGURES: { value: number; percent: boolean }[] = [
  { value: 0.998, percent: true },
  { value: 0, percent: false },
  { value: 0.015, percent: true },
  { value: 0, percent: false },
];

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const m = t.entry;

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
          <span className="ml-auto flex items-center gap-2">
            {session?.mode === "replay" && (
              <span className="hidden rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 backdrop-blur sm:inline">
                {m.demoBadge}
              </span>
            )}
            <LanguageSwitch />
          </span>
        </nav>

        <section className="grid items-center gap-10 pt-10 pb-12 sm:pt-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 backdrop-blur">
              <Sparkles className="size-3.5" />
              {m.eyebrow}
            </span>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl xl:text-6xl">
              {m.title[0]} <span className="text-brand-600">{m.title[1]}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-pretty text-slate-600">
              {m.lead}
            </p>
          </div>
          <Image
            src="/hero-intake.webp"
            alt={m.heroAlt}
            width={1400}
            height={788}
            priority
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="w-full mix-blend-multiply lg:scale-110"
          />
        </section>

        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {m.steps.map((s, i) => {
            const Icon = STEPS[i];
            return (
            <li key={i} className="card relative p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <Icon className="size-5" />
                </span>
                <span className="text-xs font-semibold tracking-wide text-slate-400">0{i + 1}</span>
              </div>
              <h2 className="mt-4 font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            </li>
            );
          })}
        </ol>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          <div className="card p-5">
            <h2 className="text-sm font-semibold">{m.lightsTitle}</h2>
            <p className="mt-1 text-xs text-slate-500">{m.lightsNote}</p>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {m.lights.map((label, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm text-slate-700">
                  <span className={`size-2.5 rounded-full ${LIGHTS[i]} ring-4 ring-white shadow-sm`} />
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <div className="card grid grid-cols-2 gap-px overflow-hidden bg-slate-100 sm:grid-cols-4 lg:grid-cols-2">
            {FIGURES.map((f, i) => (
              <div key={i} className="bg-white p-5">
                <div className="text-3xl font-semibold tracking-tight tabular-nums">
                  {f.percent ? f.value.toLocaleString(t.locale, { style: "percent", maximumFractionDigits: 1 }) : f.value}
                </div>
                <div className="mt-1 text-xs text-slate-500">{m.figures[i]}</div>
              </div>
            ))}
          </div>
        </div>

        <section className="py-14">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{m.start}</h2>
              <p className="mt-1 text-sm text-slate-600">{m.startNote}</p>
            </div>
            {session?.mode === "replay" && (
              <p className="max-w-md text-xs text-slate-500">{m.replayNote(session.replaySpeed)}</p>
            )}
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {(session?.technicians ?? []).map((p) => {
              const current = session?.technician?.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p.id)}
                    disabled={busy !== null}
                    className={`card group flex w-full items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] disabled:opacity-60 ${
                      current ? "ring-2 ring-brand-500" : ""
                    }`}
                  >
                    <Avatar name={p.name} className="size-11 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="text-xs text-slate-500">
                        {busy === p.id ? m.opening : current ? m.continue : m.role}
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
          {m.footer}
        </footer>
      </div>
    </div>
  );
}

