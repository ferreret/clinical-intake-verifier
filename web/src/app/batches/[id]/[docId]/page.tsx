"use client";

/**
 * Verifying one document (F5 block 3): the pages on the left with a box on every value read,
 * the proposal on the right, field by field and line by line, each with its traffic light and
 * provenance. Opening it locks it to the technician; leaving it for later releases it.
 *
 * The technician's changes are kept here until they approve (block 4): every red and orange
 * item resolved or confirmed, then one approval of the whole request, recorded with exactly
 * what was approved. Or they reject it, saying why. A decided document opens read-only, as
 * the decision recorded it.
 */
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, type Decision, type ProposalView, type RejectReason } from "../../../_ui/api";
import { useI18n } from "../../../_ui/i18n";
import { ArrowLeft, ArrowRight, Check as CheckIcon, FileText, Keyboard } from "../../../_ui/icons";
import { useSession } from "../../../_ui/session";
import { StateBadge } from "../../../_ui/states";
import { Fields, Links } from "./fields";
import { Lens } from "./lens";
import { ShortcutsDialog } from "./shortcuts";
import { checkOf, itemsOf, type Check, type Light } from "./model";
import { Tests, type AddedLine, type Chosen } from "./tests";
import { Viewer } from "./viewer";

/** Whether the document is this technician's to verify; otherwise why not, as the server said. */
type Lock = { status: "mine" } | { status: "locked"; holder: string } | { status: "closed"; message: string };

export default function VerifyPage() {
  const { id: batchId, docId } = useParams<{ id: string; docId: string }>();
  const router = useRouter();
  const { technician, technicians } = useSession();
  const { t } = useI18n();
  const m = t.verify;
  const [view, setView] = useState<ProposalView | null>(null);
  const [lock, setLock] = useState<Lock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Chosen>({});
  const [added, setAdded] = useState<AddedLine[]>([]);
  // Catalog names of the codes on screen: the proposal's, and those found by searching.
  const [names, setNames] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // Red and orange items confirmed as proposed.
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"approving" | "rejecting" | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  // The item whose Read cell is under the pointer: what the lens shows.
  const [peek, setPeek] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // The lens (lens.tsx) is on unless the technician turned it off; remembered in this browser.
  const [lens, setLens] = useState(() => {
    try {
      return typeof window === "undefined" || window.localStorage.getItem("civ.lens") !== "off";
    } catch {
      return true;
    }
  });
  const toggleLens = useCallback(() => {
    setLens((on) => {
      try {
        window.localStorage.setItem("civ.lens", on ? "off" : "on");
      } catch {
        // Storage may be blocked; the switch still works for this page.
      }
      return !on;
    });
  }, []);
  const inputs = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);

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
        // A decided document shows what was approved; one to verify, what was proposed.
        const record = v.decision?.approved ?? null;
        const approvedField = new Map(record?.fields.map((f) => [f.name, f.value]) ?? []);
        setValues(
          Object.fromEntries(
            items.flatMap((i) => (i.kind === "field" ? [[i.key, (record ? approvedField.get(i.spec.name) : i.fused.value) ?? ""]] : [])),
          ),
        );
        setChosen(
          Object.fromEntries(
            items.flatMap((i) =>
              i.kind === "test" ? [[i.key, record ? record.tests[i.index].codes : (v.proposal.tests[i.index].mapping.codes ?? [])]] : [],
            ),
          ),
        );
        setAdded(
          (record?.tests ?? [])
            .filter((l) => l.action === "added")
            .map((l, n) => ({ key: `a:${n}`, text: l.text, codes: l.codes ?? [] })),
        );
        setConfirmed(
          new Set([
            ...(record?.fields.filter((f) => f.action === "confirmed").map((f) => `f:${f.name}`) ?? []),
            ...(record?.tests.flatMap((l, n) => (l.action === "confirmed" ? [`t:${n}`] : [])) ?? []),
          ]),
        );
        setNames(v.codes);
        setTouched(new Set());
        setProblems(null);
        setRejecting(false);
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
  const labels = useMemo(
    () =>
      Object.fromEntries(
        items.map((i) => [
          i.key,
          i.kind === "field"
            ? { label: t.fieldLabel(i.spec), read: i.fused.ai?.value ?? "" }
            : { label: t.lens.testLine(i.index + 1), read: view!.proposal.tests[i.index].text },
        ]),
      ),
    [items, view, t],
  );

  const focusItem = useCallback((key: string, moveCaret = true) => {
    setFocused(key);
    if (moveCaret) inputs.current.get(key)?.focus({ preventScroll: false });
  }, []);

  const checks = useMemo(
    () =>
      Object.fromEntries(
        view ? items.map((i) => [i.key, checkOf(i, view, values[i.key], chosen[i.key], confirmed.has(i.key))]) : [],
      ) as Record<string, Check>,
    [items, view, values, chosen, confirmed],
  );

  const toggleConfirm = useCallback((key: string) => {
    setConfirmed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  }

  function chooseCodes(key: string, codes: string[] | null) {
    setChosen((c) => ({ ...c, [key]: codes }));
    setTouched((t) => new Set(t).add(key));
  }

  function addLine() {
    const key = `a:${Date.now().toString(36)}`;
    setAdded((a) => [...a, { key, text: "", codes: [] }]);
    setTouched((t) => new Set(t).add(key));
    setFocused(key);
    pendingFocus.current = key;
  }

  // A line just added gets the caret once it is on screen, ready to choose its codes.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    inputs.current.get(key)?.focus();
  }, [added]);

  function editAdded(key: string, patch: Partial<Omit<AddedLine, "key">>) {
    setAdded((a) => a.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeAdded(key: string) {
    setAdded((a) => a.filter((l) => l.key !== key));
    setTouched((t) => {
      const next = new Set(t);
      next.delete(key);
      return next;
    });
  }

  const siblings = view?.siblings ?? [];
  const at = siblings.findIndex((s) => s.id === docId);
  const prev = at > 0 ? siblings[at - 1] : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;

  const unresolved = items.filter((i) => checks[i.key]?.pending).length + added.filter((a) => a.codes.length === 0).length;
  const canApprove = !readOnly && !busy && view !== null && !view.decision && unresolved === 0;

  /** After a decision: the batch's next document to verify, or the batch. */
  const goOn = useCallback(
    (nextId: string | null) => {
      setTouched(new Set());
      setConfirmed(new Set());
      router.push(nextId ? `/batches/${batchId}/${nextId}` : `/batches/${batchId}`);
    },
    [router, batchId],
  );

  const approve = useCallback(async () => {
    if (!view) return;
    setBusy("approving");
    setProblems(null);
    try {
      const r = await api.approve(docId, {
        fields: Object.fromEntries(items.flatMap((i) => (i.kind === "field" ? [[i.spec.name, values[i.key]?.trim() || null]] : []))),
        lines: items.flatMap((i) => (i.kind === "test" ? [chosen[i.key] === undefined ? [] : chosen[i.key]] : [])),
        added: added.map((a) => ({ text: a.text, codes: a.codes })),
        confirmed: [...confirmed],
      });
      goOn(r.next);
    } catch (e) {
      const err = e as ApiError;
      setProblems(Array.isArray(err.body?.problems) ? (err.body.problems as string[]) : [err.message]);
      setBusy(null);
    }
  }, [view, docId, items, values, chosen, added, confirmed, goOn]);

  async function reject(reason: RejectReason, note: string) {
    setBusy("rejecting");
    setProblems(null);
    try {
      const r = await api.reject(docId, reason, note);
      goOn(r.next);
    } catch (e) {
      setProblems([(e as Error).message]);
      setBusy(null);
    }
  }

  const leave = useCallback(
    async (to: string) => {
      if ((touched.size > 0 || confirmed.size > 0) && !view?.decision && !window.confirm(m.confirmLeave)) return;
      if (lock?.status === "mine") await api.release(docId).catch(() => undefined);
      router.push(to);
    },
    [touched, confirmed, view, lock, docId, router, m],
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
      if (e.altKey && (e.key === "z" || e.key === "Z" || e.code === "KeyZ")) {
        e.preventDefault();
        toggleLens();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (canApprove) void approve();
        return;
      }
      if (e.altKey && e.key === "Enter" && !readOnly) {
        // Confirm the item in focus as proposed, then on to the next one still in the way.
        e.preventDefault();
        const here = Math.max(0, items.findIndex((i) => i.key === focused));
        if (checks[items[here]?.key]?.confirmable && !confirmed.has(items[here].key)) toggleConfirm(items[here].key);
        const after = [...items.slice(here + 1), ...items.slice(0, here)].find((i) => checks[i.key]?.pending);
        if (after) focusItem(after.key);
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
  }, [items, focused, readOnly, next, prev, batchId, leave, focusItem, toggleLens, checks, confirmed, toggleConfirm, canApprove, approve]);

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
          peek={lens ? peek : null}
          onFocus={(k) => focusItem(k, false)}
        />
      </div>

      <div
        className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200"
        onPointerOver={(e) => {
          const read = (e.target as HTMLElement).closest("[data-read]");
          setPeek(read?.closest("[data-row]")?.getAttribute("data-row") ?? null);
        }}
        onPointerLeave={() => setPeek(null)}
      >
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => leave(`/batches/${batchId}`)}
              className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-900"
            >
              <ArrowLeft className="size-3.5" /> {view.batch?.name ?? m.batch}
            </button>
            <span className="ml-auto inline-flex items-center gap-2">
              <NavButton disabled={!prev} onClick={() => prev && leave(`/batches/${batchId}/${prev.id}`)} label={m.previousTitle} keys="Alt+←">
                <ArrowLeft className="size-4" /> {m.previous}
              </NavButton>
              <span className="px-1 text-sm text-slate-500 tabular-nums">
                <span className="font-semibold text-slate-900">{m.position(at + 1, siblings.length)[0]}</span>
                {m.position(at + 1, siblings.length)[1]}
              </span>
              <NavButton
                primary
                disabled={!next}
                onClick={() => next && leave(`/batches/${batchId}/${next.id}`)}
                label={next ? m.nextTitle(next.fileName.replace(/\.pdf$/, "")) : m.lastTitle}
                keys="Alt+→"
              >
                {m.next} <ArrowRight className="size-4" />
              </NavButton>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <FileText className="size-4 text-slate-400" />
            <h1 className="font-mono text-sm font-semibold">{view.document.fileName.replace(/\.pdf$/, "")}</h1>
            <StateBadge state={lock?.status === "mine" ? "in_verification" : view.document.state} />
            <span className="text-[11px] text-slate-500">
              {m.readBy(extractor.model, (extractor.latency_ms / 1000).toLocaleString(t.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }))}
              {view.proposal.recorded && m.recorded}
            </span>
          </div>
          {view.decision && <DecisionBanner decision={view.decision} />}
          {lock && lock.status !== "mine" && !view.decision && (
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <span className="flex-1">
                {m.readOnly(lock.status === "locked" ? m.lockedBy(technicians.find((p) => p.id === lock.holder)?.name ?? lock.holder) : m.closed(lock.message))}
              </span>
              {lock.status === "locked" && (
                <button type="button" onClick={() => open(true).then(setLock)} className="font-medium underline-offset-2 hover:underline">
                  {m.takeOver(technician.name)}
                </button>
              )}
            </div>
          )}
        </header>

        <div className="@container min-h-0 flex-1">
          <div className="grid h-full overflow-y-auto @min-[88rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[88rem]:overflow-hidden">
            <div className="@container space-y-4 p-4 @min-[88rem]:overflow-y-auto">
              <section>
                <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{m.records}</h2>
                <Links view={view} />
              </section>
              <section>
                <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{m.fieldsTitle(fields.length)}</h2>
                <Fields
            view={view}
            items={fields}
            values={values}
            touched={touched}
            focused={focused}
            readOnly={readOnly}
            inputs={inputs}
            checks={checks}
            confirmed={confirmed}
            onFocus={(k) => setFocused(k)}
            onChange={setField}
            onConfirm={toggleConfirm}
                />
              </section>
            </div>
            <section className="@container p-4 pt-0 @min-[88rem]:overflow-y-auto @min-[88rem]:border-l @min-[88rem]:border-slate-200 @min-[88rem]:pt-4">
              <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                {m.testsTitle(tests.length, added.length)}
              </h2>
              <Tests
              view={view}
              items={tests}
              chosen={chosen}
              added={added}
              names={names}
              touched={touched}
              focused={focused}
              readOnly={readOnly}
              inputs={inputs}
              checks={checks}
              confirmed={confirmed}
              onFocus={(k) => setFocused(k)}
              onConfirm={toggleConfirm}
              onChoose={chooseCodes}
              onAdd={addLine}
              onEditAdded={editAdded}
              onRemoveAdded={removeAdded}
              onNames={(n) => setNames((all) => ({ ...all, ...n }))}
              />
            </section>
          </div>
        </div>

        <footer className="border-t border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500">
              {view.decision ? null : unresolved > 0 ? (
                <span className="font-medium text-red-700">{m.leftToResolve(unresolved)}</span>
              ) : (
                <span className="font-medium text-emerald-700">{m.nothingLeft}</span>
              )}
              {!view.decision && touched.size > 0 && <> · {m.changes(touched.size)}</>}
              {!view.decision && confirmed.size > 0 && <> · {m.confirmedCount(confirmed.size)}</>}
            </span>
            <button
              type="button"
              onClick={toggleLens}
              title={m.lensTitle}
              className={`hidden rounded-md px-2 py-1 text-xs font-medium ring-1 transition lg:inline-flex ${
                lens ? "bg-brand-50 text-brand-700 ring-brand-200" : "text-slate-500 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {m.lens(lens)}
            </button>
            <button
              type="button"
              onClick={() => setHelp((h) => !h)}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
            >
              <Keyboard className="size-4" />
              {m.shortcuts}
              <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">?</kbd>
            </button>
            <span className="ml-auto inline-flex gap-2">
              {view.decision || readOnly ? (
                <button
                  type="button"
                  onClick={() => leave(`/batches/${batchId}`)}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                >
                  {m.backToBatch}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setRejecting((r) => !r)}
                    disabled={busy !== null}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-40"
                  >
                    {m.reject}
                  </button>
                  <button
                    type="button"
                    onClick={() => leave(`/batches/${batchId}`)}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    {m.leave}
                  </button>
                  <button
                    type="button"
                    onClick={() => void approve()}
                    disabled={!canApprove}
                    title={canApprove ? m.approveReady : m.approveBlocked}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                  >
                    <CheckIcon className="size-4" strokeWidth={2.25} />
                    {busy === "approving" ? m.approving : m.approve}
                  </button>
                </>
              )}
            </span>
          </div>
          {problems && (
            <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200">
              <p className="font-medium">{m.notApproved}</p>
              <ul className="mt-1 list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {rejecting && !readOnly && <RejectPanel busy={busy === "rejecting"} onCancel={() => setRejecting(false)} onReject={reject} />}
        </footer>
      </div>
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      <Lens
        documentId={docId}
        pages={view.proposal.prediction.pages}
        items={items}
        lights={lights}
        shown={peek}
        labels={labels}
        enabled={lens}
      />
    </div>
  );
}

/** Why a document could not be opened for verification: another technician has it, or it is done. */
function lockedBy(e: unknown): Lock {
  const err = e as ApiError;
  return err.status === 409 && typeof err.body.lockedBy === "string"
    ? { status: "locked", holder: err.body.lockedBy }
    : { status: "closed", message: err.message };
}

/** Who decided on the document, when, and how: approved as shown, or rejected and why. */
function DecisionBanner({ decision }: { decision: Decision }) {
  const { t } = useI18n();
  const { technicians } = useSession();
  const m = t.verify;
  const who = technicians.find((p) => p.id === decision.technician)?.name ?? decision.technician;
  const when = new Date(decision.at).toLocaleString(t.locale, { dateStyle: "medium", timeStyle: "short" });
  if (decision.decision === "approved") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200">
        <CheckIcon className="size-4 shrink-0" strokeWidth={2.25} />
        <span>
          <span className="font-medium">{m.approvedBy(who, when)}</span> {m.approvedNote}
        </span>
      </div>
    );
  }
  const [code, ...note] = (decision.reason ?? "").split(": ");
  const reason = m.rejectReasons[code as RejectReason] ?? code;
  return (
    <div className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-800 ring-1 ring-neutral-200">
      <span className="font-medium">{m.rejectedBy(who, when)}</span>: {reason}
      {note.length > 0 && <> · {note.join(": ")}</>}
    </div>
  );
}

const REASONS: RejectReason[] = ["illegible", "not_a_request", "duplicate", "other"];

/** Rejecting asks why: one of a few reasons, and a note, required with "other". */
function RejectPanel({ busy, onCancel, onReject }: { busy: boolean; onCancel: () => void; onReject: (reason: RejectReason, note: string) => void }) {
  const { t } = useI18n();
  const m = t.verify;
  const [reason, setReason] = useState<RejectReason>("illegible");
  const [note, setNote] = useState("");
  const ready = !busy && (reason !== "other" || note.trim() !== "");
  return (
    <div className="mt-3 rounded-lg bg-rose-50/60 p-3 ring-1 ring-rose-200">
      <p className="text-sm font-medium text-rose-900">{m.rejectTitle}</p>
      <p className="text-xs text-rose-800/80">{m.rejectNote}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {REASONS.map((r) => (
          <label
            key={r}
            className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition ${
              reason === r ? "bg-rose-600 text-white ring-rose-600" : "bg-white text-slate-700 ring-slate-200 hover:ring-rose-300"
            }`}
          >
            <input type="radio" name="reject-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
            {m.rejectReasons[r]}
          </label>
        ))}
      </div>
      <label className="mt-2 block">
        <span className="sr-only">{m.note}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={m.notePlaceholder}
          maxLength={500}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100 focus:outline-none"
        />
      </label>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-white">
          {m.cancel}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onReject(reason, note)}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-40"
        >
          {busy ? m.rejecting : m.rejectTitle}
        </button>
      </div>
    </div>
  );
}

/** Moving between the batch's documents: labelled, so that it is found at a glance. */
function NavButton({
  disabled,
  onClick,
  label,
  keys,
  primary = false,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  keys: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={`${label} (${keys})`}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${
        primary
          ? "bg-brand-600 text-white ring-brand-600 hover:bg-brand-700 disabled:hover:bg-brand-600"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400 disabled:hover:bg-white"
      }`}
    >
      {children}
    </button>
  );
}
