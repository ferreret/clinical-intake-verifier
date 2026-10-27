"use client";

/**
 * Deleting a batch, or all of them, asked first: what goes (the documents, their decisions
 * and the requests registered in mock-lis) and what stays (what the mapping memory learned,
 * and batches still being read).
 */
import { useState } from "react";

import { api, type DocumentState } from "./api";
import { useI18n } from "./i18n";
import { Trash } from "./icons";

export function DeleteBatchDialog({
  batch,
  batches = 1,
  readingBatches = 0,
  states,
  onDeleted,
  onCancel,
}: {
  /** The batch to delete; null to delete them all. */
  batch: { id: string; name: string } | null;
  /** Deleting them all: how many there are, and how many are still being read (they stay). */
  batches?: number;
  readingBatches?: number;
  /** Documents by state, in the batch or across all of them. */
  states: Record<DocumentState, number>;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const m = t.deleteBatch;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = Object.values(states).reduce((a, n) => a + n, 0);
  // One batch still being read cannot go; deleting them all leaves those behind.
  const reading = batch !== null && states.extracting > 0;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await (batch ? api.deleteBatch(batch.id) : api.deleteAllBatches());
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        className="card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-rose-100">
            <Trash className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="delete-title" className="font-semibold">
              {batch ? m.title(batch.name) : m.titleAll(batches)}
            </h2>
            <div className="mt-2 space-y-1.5 text-sm text-slate-600">
              <p>{batch ? m.documents(total) : m.documentsAll(total)}</p>
              {states.approved + states.rejected > 0 && <p>{m.decided(states.approved, states.rejected)}</p>}
              {states.approved > 0 && <p className="text-xs text-slate-500">{m.memory}</p>}
              {reading && <p className="font-medium text-amber-800">{m.reading}</p>}
              {!batch && readingBatches > 0 && <p className="font-medium text-amber-800">{m.readingAll(readingBatches)}</p>}
              {error && <p className="text-rose-700">{error}</p>}
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            {m.cancel}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy || reading}
            className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-40"
          >
            {busy ? m.deleting : batch ? m.confirm : m.confirmAll}
          </button>
        </div>
      </div>
    </div>
  );
}
