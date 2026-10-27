"use client";

/**
 * The working session for the pages behind the technician picker: who is working, in which
 * mode, and the header that says so. Without a technician (or once the sandbox has expired)
 * the visitor is sent back to the picker.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api, type SessionInfo, type Technician } from "./api";
import { Avatar } from "./avatar";
import { Logo } from "./icons";

const SessionContext = createContext<(SessionInfo & { technician: Technician }) | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionShell");
  return s;
}

export function SessionShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  // Pages are kept to a reading width, except the verification screen, which needs the room.
  const wide = /^\/batches\/[^/]+\/[^/]+/.test(usePathname() ?? "");

  useEffect(() => {
    api.session().then((s) => {
      if (!s.technician) router.replace("/");
      else setSession(s);
    });
  }, [router]);

  if (!session?.technician) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Logo className="size-10 animate-pulse" />
      </div>
    );
  }
  return (
    <SessionContext.Provider value={{ ...session, technician: session.technician }}>
      <Header session={session} technician={session.technician} wide={wide} />
      <main className={wide ? "px-4 py-4 sm:px-6" : "mx-auto max-w-6xl px-4 py-8 sm:px-6"}>{children}</main>
    </SessionContext.Provider>
  );
}

function Header({ session, technician, wide }: { session: SessionInfo; technician: Technician; wide: boolean }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
      <div className={`mx-auto flex h-14 items-center gap-3 px-4 sm:gap-6 sm:px-6 ${wide ? "" : "max-w-6xl"}`}>
        <Link href="/batches" className="flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="hidden font-semibold tracking-tight sm:inline">Intake Verifier</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/batches"
            className={`rounded-md px-2.5 py-1.5 font-medium transition ${
              path?.startsWith("/batches") ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Batches
          </Link>
        </nav>
        {session.mode === "replay" ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
            title={`The models' real replies, recorded beforehand and replayed ${session.replaySpeed}× faster. Nothing is sent to a model; your work stays in a sandbox of your own.`}
          >
            <span className="size-1.5 rounded-full bg-amber-500" />
            <span className="md:hidden">Demo</span>
            <span className="hidden md:inline">Demo · recorded replies, {session.replaySpeed}× faster</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
            <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />
            <span className="md:hidden">Live</span>
            <span className="hidden md:inline">Live · models called now</span>
          </span>
        )}
        <Link
          href="/"
          className="ml-auto flex items-center gap-2.5 rounded-full py-1 pr-1 pl-3 text-sm transition hover:bg-slate-100"
          title="Switch technician"
        >
          <span className="hidden text-right leading-tight sm:block">
            <span className="block font-medium">{technician.name}</span>
            <span className="block text-[11px] text-slate-500">Switch technician</span>
          </span>
          <Avatar name={technician.name} className="size-8 text-xs" />
        </Link>
      </div>
    </header>
  );
}

/** A page's title, a line under it, and its main action. */
export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

/** "← Batches" and the like, above a page's title. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-900">
      <span aria-hidden>←</span> {children}
    </Link>
  );
}
