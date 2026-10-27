/**
 * The browser's side of the API (docs/workflow.md): typed fetches, and the shapes they return.
 * Types only are taken from the server's modules; nothing of theirs reaches the browser.
 */
import type { DocumentState } from "@/lib/batches/schema";
import type { BundledInfo } from "@/lib/batches/sources";
import type { Batch, BatchDocument, BatchSummary, DocumentSummary, StoredProposal } from "@/lib/batches/store";
import type { Technician } from "@/lib/batches/technicians";
import type { Candidate } from "@/lib/mapping/search";

export type { BatchSummary, BundledInfo, Candidate, DocumentState, Technician };
export type Provider = Batch["provider"];

export interface SessionInfo {
  mode: "replay" | "live";
  /** Replay mode: how many times faster than measured the recorded replies come. */
  replaySpeed: number | null;
  technicians: Technician[];
  technician: Technician | null;
}

export interface BatchDetail {
  batch: Batch;
  documents: (BatchDocument & { summary: DocumentSummary | null })[];
}

export interface RecordView {
  id: string;
  title: string;
  detail: string;
}

/** A document's proposal, with what the verification screen shows around it. */
export interface ProposalView {
  document: BatchDocument;
  batch: Batch | null;
  proposal: StoredProposal;
  /** Catalog name of each code proposed or offered. */
  codes: Record<string, string>;
  /** LIS records linked or offered as candidates, by id. */
  records: Record<string, RecordView>;
  siblings: Pick<BatchDocument, "id" | "position" | "fileName" | "state">[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The whole reply, for what it says beyond the message. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`, body as Record<string, unknown>);
  return body;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  session: () => call<SessionInfo>("/api/session"),
  pickTechnician: (technician: string) => call<SessionInfo>("/api/session", postJson({ technician })),
  bundled: (provider: Provider) => call<{ documents: BundledInfo[] }>(`/api/bundled?provider=${provider}`),
  batches: () => call<{ batches: BatchSummary[] }>("/api/batches"),
  batch: (id: string) => call<BatchDetail>(`/api/batches/${id}`),
  createBatch: (input: { provider: Provider; name: string; documents: string[]; files: File[] }) => {
    if (input.files.length === 0) {
      return call<{ batch: Batch }>("/api/batches", postJson({ provider: input.provider, name: input.name, documents: input.documents }));
    }
    const form = new FormData();
    form.set("provider", input.provider);
    form.set("name", input.name);
    for (const d of input.documents) form.append("documents", d);
    for (const f of input.files) form.append("files", f);
    return call<{ batch: Batch }>("/api/batches", { method: "POST", body: form });
  },
  retry: (documentId: string) => call<unknown>(`/api/documents/${documentId}/retry`, { method: "POST" }),
  proposal: (documentId: string) => call<ProposalView>(`/api/documents/${documentId}/proposal`),
  open: (documentId: string, takeOver = false) =>
    call<{ document: BatchDocument }>(`/api/documents/${documentId}/open`, postJson({ takeOver })),
  release: (documentId: string) => call<{ released: boolean }>(`/api/documents/${documentId}/release`, { method: "POST" }),
  catalog: (q: string, signal?: AbortSignal) =>
    call<{ results: Candidate[]; names: Record<string, string> }>(`/api/catalog?q=${encodeURIComponent(q)}`, { signal }),
  pageUrl: (documentId: string, page: number) => `/api/documents/${documentId}/pages/${page}`,
};

/** States that are still moving: a page showing them keeps polling. */
export const ACTIVE_STATES: DocumentState[] = ["queued", "extracting"];
