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
import { useI18n } from "../../../_ui/i18n";
import type { Messages } from "../../../_ui/messages/en";
import { ArrowLeft, ArrowRight, FileText } from "../../../_ui/icons";
import { useSession } from "../../../_ui/session";
import { StateBadge } from "../../../_ui/states";
import { Fields, Links } from "./fields";
import { Lens } from "./lens";
import { itemsOf, type Light } from "./model";
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
        setValues(Object.fromEntries(items.flatMap((i) => (i.kind === "field" ? [[i.key, i.fused.value ?? ""]] : []))));
        setChosen(Object.fromEntries(items.flatMap((i) => (i.kind === "test" ? [[i.key, v.proposal.tests[i.index].mapping.codes ?? []]] : []))));
        setAdded([]);
        setNames(v.codes);
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

  const leave = useCallback(
    async (to: string) => {
      if (touched.size > 0 && !window.confirm(m.confirmLeave)) return;
      if (lock?.status === "mine") await api.release(docId).catch(() => undefined);
      router.push(to);
    },
    [touched, lock, docId, router, m],
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
  }, [items, focused, readOnly, next, prev, batchId, leave, focusItem, toggleLens]);

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
  // Left to resolve: a red field still empty, a required one empty, a line with no codes
  // (one read and kept, or one added).
  const unresolved =
    items.filter((i) =>
      i.kind === "field"
        ? !values[i.key]?.trim() && (i.fused.state === "red" || i.spec.required)
        : Array.isArray(chosen[i.key]) && chosen[i.key]!.length === 0,
    ).length + added.filter((a) => a.codes.length === 0).length;
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
          {lock && lock.status !== "mine" && (
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
            onFocus={(k) => setFocused(k)}
            onChange={setField}
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
              onFocus={(k) => setFocused(k)}
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
              {unresolved > 0 ? (
                <span className="font-medium text-red-700">{m.leftToResolve(unresolved)}</span>
              ) : (
                <span className="font-medium text-emerald-700">{m.nothingLeft}</span>
              )}
              {touched.size > 0 && <> · {m.changes(touched.size)}</>}
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
            <button type="button" onClick={() => setHelp((h) => !h)} className="text-xs text-slate-500 underline-offset-2 hover:underline">
              {m.shortcuts} <kbd className="rounded bg-slate-100 px-1 font-mono">?</kbd>
            </button>
            <span className="ml-auto inline-flex gap-2">
              <button
                type="button"
                onClick={() => leave(`/batches/${batchId}`)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                {m.leave}
              </button>
              <button
                type="button"
                disabled
                title={m.approveTitle}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white opacity-40"
              >
                {m.approve}
              </button>
            </span>
          </div>
          {help && <Shortcuts m={m} switchLabel={t.common.switchTechnician} />}
        </footer>
      </div>
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

function Shortcuts({ m, switchLabel }: { m: Messages["verify"]; switchLabel: string }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-slate-200">
      {m.keys.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>
            <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">{k}</kbd>
          </dt>
          <dd className="text-slate-600">{v}</dd>
        </div>
      ))}
      <p className="col-span-2 mt-1 text-[11px] text-slate-500">
        {m.keysNote}{" "}
        <Link href="/" className="underline">
          {switchLabel}
        </Link>{" "}
        {m.keysSwitch}
      </p>
    </dl>
  );
}
