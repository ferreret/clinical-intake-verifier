"use client";

/**
 * The entry: what the project is, and the technician to work as. Picking one is not a login
 * (decision of 2026-10-27); it is who the audit trail will say approved each request.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, type SessionInfo } from "./_ui/api";

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
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight">clinical-intake-verifier</h1>
      <p className="mt-4 text-neutral-700">
        AI-assisted intake of clinical lab requests, with a person in the loop. A model reads each scanned request,
        the lab&apos;s own records check what it read, and the request&apos;s tests are mapped to the lab&apos;s
        codes. Every value comes with a traffic light and its provenance, and nothing is accepted until a technician
        approves it.
      </p>
      <p className="mt-3 text-neutral-700">The model is one source among several, not the source of truth.</p>

      {session?.mode === "replay" && (
        <p className="mt-6 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          Demo mode: the documents are synthetic, and the models&apos; replies were recorded beforehand and are served
          at the latency measured then. Your batches and approvals stay in a sandbox of your own for a day.
        </p>
      )}

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-neutral-500">Work as</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {(session?.technicians ?? []).map((t) => {
          const current = session?.technician?.id === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => pick(t.id)}
                disabled={busy !== null}
                className={`w-full rounded-lg border px-4 py-3 text-left transition hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-60 ${
                  current ? "border-neutral-900" : "border-neutral-200"
                }`}
              >
                <span className="block font-medium">{t.name}</span>
                <span className="text-xs text-neutral-500">
                  {busy === t.id ? "Opening…" : current ? "Continue" : "Laboratory technician"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">Invented people: picking one is not a login.</p>
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
    </main>
  );
}
