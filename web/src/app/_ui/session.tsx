"use client";

/**
 * The working session for the pages behind the technician picker: who is working, in which
 * mode, and the header that says so. Without a technician (or once the sandbox has expired)
 * the visitor is sent back to the picker.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api, type SessionInfo, type Technician } from "./api";

const SessionContext = createContext<(SessionInfo & { technician: Technician }) | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionShell");
  return s;
}

export function SessionShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    api.session().then((s) => {
      if (!s.technician) router.replace("/");
      else setSession(s);
    });
  }, [router]);

  if (!session?.technician) return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  return (
    <SessionContext.Provider value={{ ...session, technician: session.technician }}>
      <Header session={session} technician={session.technician} />
      <ModeNote mode={session.mode} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </SessionContext.Provider>
  );
}

function Header({ session, technician }: { session: SessionInfo; technician: Technician }) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-6">
        <Link href="/batches" className="whitespace-nowrap font-semibold tracking-tight">
          clinical-intake-verifier
        </Link>
        <span
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            session.mode === "replay" ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-sky-50 text-sky-800 ring-1 ring-sky-200"
          }`}
        >
          {session.mode === "replay" ? "Demo · recorded replies" : "Live"}
        </span>
        <span className="ml-auto whitespace-nowrap text-sm text-neutral-600">
          <span className="hidden sm:inline">Working as </span>
          <span className="font-medium text-neutral-900">{technician.name}</span>
          <Link href="/" className="ml-3 text-neutral-500 underline-offset-2 hover:underline">
            Switch
          </Link>
        </span>
      </div>
    </header>
  );
}

function ModeNote({ mode }: { mode: SessionInfo["mode"] }) {
  if (mode === "live") return null;
  return (
    <p className="border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-center text-xs text-amber-900">
      This demo replays what the models really answered for these synthetic documents, at the latency measured
      when it was recorded. Nothing is sent to a model, and your work stays in a sandbox of your own.
    </p>
  );
}
