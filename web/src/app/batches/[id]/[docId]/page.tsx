"use client";

/**
 * Verifying one document (F5 block 3): the pages on the left with a box on every value read,
 * the proposal on the right, field by field and line by line, each with its traffic light and
 * provenance. Opening it locks it to the technician; leaving it for later releases it.
 *
 * The technician's changes are kept here until approval, which comes with block 4 and records
 * exactly what was approved.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, type ProposalView } from "../../../_ui/api";
import { ArrowLeft, ArrowRight, FileText } from "../../../_ui/icons";
import { useSession } from "../../../_ui/session";
import { StateBadge } from "../../../_ui/states";
import { Fields, Links } from "./fields";
import { itemsOf, type Light } from "./model";
import { Tests, type Chosen } from "./tests";
import { Viewer } from "./viewer";

type Lock = { status: "mine" } | { status: "locked"; message: string } | { status: "closed"; message: string };

export default function VerifyPage() {
  const { id: batchId, docId } = useParams<{ id: string; docId: string }>();
  const router = useRouter();
  const { technician } = useSession();
  const [view, setView] = useState<ProposalView | null>(null);
  const [lock, setLock] = useState<Lock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Chosen>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const inputs = useRef(new Map<string, HTMLElement>());

  const open = useCallback(
    (takeOver = false) => api.open(docId, takeOver).then(() => ({ status: "mine" }) as Lock, lockedBy),
    [docId],
  );

  useEffect(() => {
    let current = true;
    api.proposal(docId).then(
      (v) => {
        if (!current) return;
        const items = itemsOf(v);
        setView(v);
        setValues(Object.fromEntries(items.flatMap((i) => (i.kind === "field" ? [[i.key, i.fused.value ?? ""]] : []))));
        setChosen(Object.fromEntries(items.flatMap((i) => (i.kind === "test" ? [[i.key, v.proposal.tests[i.index].mapping.codes ?? []]] : []))));
        setTouched(new Set());
        setFocused(items[0]?.key ?? null);
      },
      (e: Error) => current && setError(e.message),
    );
    open().then((l) => current && setLock(l));
    return () => {
      current = false;
    };
  }, [docId, open]);

  const items = useMemo(() => (view ? itemsOf(view) : []), [view]);
  const lights = useMemo(
    () =>
      Object.fromEntries(
        items.map((i) => [i.key, (i.kind === "field" ? i.fused.state : view!.proposal.tests[i.index].mapping.state) as Light]),
      ),
    [items, view],
  );
  const readOnly = lock?.status !== "mine";

  const focusItem = useCallback((key: string, moveCaret = true) => {
    setFocused(key);
    if (moveCaret) inputs.current.get(key)?.focus({ preventScroll: false });
  }, []);

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  }

  function chooseCodes(key: string, codes: string[] | null) {
    setChosen((c) => ({ ...c, [key]: codes }));
    setTouched((t) => new Set(t).add(key));
  }

  const siblings = view?.siblings ?? [];
  const at = siblings.findIndex((s) => s.id === docId);
  const prev = at > 0 ? siblings[at - 1] : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;

  const leave = useCallback(
    async (to: string) => {
      if (touched.size > 0 && !window.confirm("Your changes to this document are not approved yet and will be lost. Leave anyway?")) return;
      if (lock?.status === "mine") await api.release(docId).catch(() => undefined);
      router.push(to);
    },
    [touched, lock, docId, router],
  );

  // Keyboard: Alt+↓/↑ next and previous item, Alt+1/2 take the document's or the records'
  // value in a conflict, Alt+→/← next and previous document, ? the list of shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === "?" && !typing) {
        setHelp((h) => !h);
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (!e.altKey || items.length === 0) return;
      const at = Math.max(0, items.findIndex((i) => i.key === focused));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const to = e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
        focusItem(items[to].key);
      } else if ((e.key === "1" || e.key === "2" || e.code === "Digit1" || e.code === "Digit2") && !readOnly) {
        const item = items[at];
        if (item.kind !== "field" || item.fused.reason !== "conflict") return;
        e.preventDefault();
        const source = e.code === "Digit1" || e.key === "1" ? item.fused.ai : item.fused.lis;
        if (source) setField(item.key, source.value);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        void leave(`/batches/${batchId}/${next.id}`);
      } else if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        void leave(`/batches/${batchId}/${prev.id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, focused, readOnly, next, prev, batchId, leave, focusItem]);

  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!view) {
    return (
      <div className="grid h-[calc(100vh-6rem)] gap-4 lg:grid-cols-2">
        <div className="animate-pulse rounded-xl bg-slate-200" />
        <div className="card animate-pulse" />
      </div>
    );
  }

  const fields = items.filter((i) => i.kind === "field");
  const tests = items.filter((i) => i.kind === "test");
  // Left to resolve: a red field still empty, a required one empty, a line with no codes.
  const unresolved = items.filter((i) =>
    i.kind === "field"
      ? !values[i.key]?.trim() && (i.fused.state === "red" || i.spec.required)
      : Array.isArray(chosen[i.key]) && chosen[i.key]!.length === 0,
  ).length;
  const extractor = view.proposal.prediction.extractor;

  return (
    // Two columns, the document and the proposal; from 2560 px the proposal splits into fields
    // and tests side by side (see the body below), so everything is in view at once.
    <div className="grid gap-4 lg:h-[calc(100dvh-5.5rem-1px)] lg:grid-cols-[minmax(0,1fr)_minmax(34rem,44rem)] lg:grid-rows-1 3xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] 4xl:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <div className="h-[60vh] lg:h-full">
        <Viewer
          documentId={docId}
          pages={view.proposal.prediction.pages}
          items={items}
          lights={lights}
          focused={focused}
          onFocus={(k) => focusItem(k, false)}
        />
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => leave(`/batches/${batchId}`)}
              className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-900"
            >
              <ArrowLeft className="size-3.5" /> {view.batch?.name ?? "Batch"}
            </button>
            <span className="ml-auto inline-flex items-center gap-1">
              <NavButton disabled={!prev} onClick={() => prev && leave(`/batches/${batchId}/${prev.id}`)} label="Previous document (Alt+←)">
                <ArrowLeft className="size-4" />
              </NavButton>
              <span className="px-1 text-xs tabular-nums text-slate-500">
                {at + 1} / {siblings.length}
              </span>
              <NavButton disabled={!next} onClick={() => next && leave(`/batches/${batchId}/${next.id}`)} label="Next document (Alt+→)">
                <ArrowRight className="size-4" />
              </NavButton>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <FileText className="size-4 text-slate-400" />
            <h1 className="font-mono text-sm font-semibold">{view.document.fileName.replace(/\.pdf$/, "")}</h1>
            <StateBadge state={lock?.status === "mine" ? "in_verification" : view.document.state} />
            <span className="text-[11px] text-slate-500">
              read by {extractor.model} in {(extractor.latency_ms / 1000).toFixed(1)} s
              {view.proposal.recorded && " (recorded)"}
            </span>
          </div>
          {lock && lock.status !== "mine" && (
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <span className="flex-1">{lock.message}. Shown read-only.</span>
              {lock.status === "locked" && (
                <button type="button" onClick={() => open(true).then(setLock)} className="font-medium underline-offset-2 hover:underline">
                  Take it over as {technician.name}
                </button>
              )}
            </div>
          )}
        </header>

        <div className="@container min-h-0 flex-1">
          <div className="grid h-full overflow-y-auto @min-[88rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[88rem]:overflow-hidden">
            <div className="@container space-y-4 p-4 @min-[88rem]:overflow-y-auto">
              <section>
                <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">The lab&apos;s records</h2>
                <Links view={view} />
              </section>
              <section>
                <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Fields · {fields.length}</h2>
                <Fields
            view={view}
            items={fields}
            values={values}
            touched={touched}
            focused={focused}
            readOnly={readOnly}
            inputs={inputs}
            onFocus={(k) => setFocused(k)}
            onChange={setField}
                />
              </section>
            </div>
            <section className="@container p-4 pt-0 @min-[88rem]:overflow-y-auto @min-[88rem]:border-l @min-[88rem]:border-slate-200 @min-[88rem]:pt-4">
              <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Requested tests · {tests.length} line{tests.length === 1 ? "" : "s"}
              </h2>
              <Tests
              view={view}
              items={tests}
              chosen={chosen}
              touched={touched}
              focused={focused}
              readOnly={readOnly}
              inputs={inputs}
              onFocus={(k) => setFocused(k)}
              onChoose={chooseCodes}
              />
            </section>
          </div>
        </div>

        <footer className="border-t border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500">
              {unresolved > 0 ? (
                <span className="font-medium text-red-700">{unresolved} left to resolve</span>
              ) : (
                <span className="font-medium text-emerald-700">Nothing left to resolve</span>
              )}
              {touched.size > 0 && <> · {touched.size} change{touched.size === 1 ? "" : "s"}</>}
            </span>
            <button type="button" onClick={() => setHelp((h) => !h)} className="text-xs text-slate-500 underline-offset-2 hover:underline">
              Shortcuts <kbd className="rounded bg-slate-100 px-1 font-mono">?</kbd>
            </button>
            <span className="ml-auto inline-flex gap-2">
              <button
                type="button"
                onClick={() => leave(`/batches/${batchId}`)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                Leave for later
              </button>
              <button
                type="button"
                disabled
                title="Approval is the next block of F5: it records exactly what you approve."
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white opacity-40"
              >
                Approve
              </button>
            </span>
          </div>
          {help && <Shortcuts />}
        </footer>
      </div>
    </div>
  );
}

/** Why a document could not be opened for verification: another technician has it, or it is done. */
function lockedBy(e: unknown): Lock {
  const err = e as ApiError;
  return err.status === 409 && /verifying/.test(err.message)
    ? { status: "locked", message: err.message }
    : { status: "closed", message: err.message };
}

function NavButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Shortcuts() {
  const rows = [
    ["Alt + ↓ / ↑", "Next or previous field or line"],
    ["Tab / Shift + Tab", "Next or previous input"],
    ["Alt + 1 / Alt + 2", "In a conflict, take the document's or the records' value"],
    ["Alt + → / ←", "Next or previous document of the batch"],
    ["Esc", "Leave the input; close this list"],
  ];
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-slate-200">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>
            <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">{k}</kbd>
          </dt>
          <dd className="text-slate-600">{v}</dd>
        </div>
      ))}
      <p className="col-span-2 mt-1 text-[11px] text-slate-500">
        On a page, click a box to go to its field. <Link href="/" className="underline">Switch technician</Link> from the header.
      </p>
    </dl>
  );
}
