/**
 * The browser's side of the API (docs/workflow.md): typed fetches, and the shapes they return.
 * Types only are taken from the server's modules; nothing of theirs reaches the browser.
 */
import type { DocumentState } from "@/lib/batches/schema";
import { withBase } from "@/lib/base-path";
import type { Decision, RejectReason } from "@/lib/batches/decide";
import type { BundledInfo } from "@/lib/batches/sources";
import type { Batch, BatchDocument, BatchSummary, DocumentSummary, StoredProposal } from "@/lib/batches/store";
import { ACTING_HEADER, type Technician } from "@/lib/batches/technicians";
import type { ChosenLinks, FusedDocument, RecordKind } from "@/lib/fusion/types";
import type { RecordView } from "@/lib/lis/records";
import type { Candidate } from "@/lib/mapping/search";

export type { BatchSummary, BundledInfo, Candidate, ChosenLinks, Decision, DocumentState, RecordKind, RejectReason, Technician };
export type Provider = Batch["provider"];

/** Which provider a recorded model id belongs to, so that the screens name it as t.providers does. */
export const providerOf = (model: string): Provider => (/^(models\/)?gemini/i.test(model) ? "gemini" : "local");

/**
 * A server's error as the screens show it: without the models' makes, which the stored error
 * keeps ("GEMINI_API_KEY is not set", "empty Gemini reply", a local model's id in its server's
 * reply). The screens name the models by where they run.
 */
export function hideModels(text: string): string {
  return text
    .replace(/\bGEMINI_API_KEY\b/g, "the cloud model's key")
    .replace(/\b(models\/)?gemini[\w.\-/:]*/gi, "cloud model")
    .replace(/\bgoogle[\w.\-]*/gi, "cloud")
    .replace(/\b[\w.\-]*\/?qwen[\w.\-/:]*/gi, "local model")
    .replace(/\bLM Studio\b/gi, "local model server");
}

/**
 * A failed document's error as the batch page shows it. Documents that failed before the queue
 * kept its errors short (lib/batches/queue.ts, `failure`) may hold a database error with its
 * SQL and its parameters, the patient's data among them: not shown.
 */
export function documentError(text: string): string {
  return /^Failed query:/.test(text) ? "the database could not save it: retry the document" : hideModels(text);
}

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

export type { RecordView };

/** A document's proposal, with what the verification screen shows around it. */
export interface ProposalView {
  document: BatchDocument;
  batch: Batch | null;
  proposal: StoredProposal;
  /** Catalog name of each code proposed or offered. */
  codes: Record<string, string>;
  /** LIS records linked or offered as candidates, by id. */
  records: Record<string, RecordView>;
  /** The batch's documents in order; `pages` is null until a document is read. */
  siblings: (Pick<BatchDocument, "id" | "position" | "fileName" | "state"> & { pages: number | null })[];
  /** The technician's decision, once the document is approved or rejected. */
  decision: Decision | null;
}

/** What approving sends (lib/batches/decide.ts, ApprovalInput). */
export interface Approval {
  fields: Record<string, string | null>;
  lines: (string[] | null)[];
  added: { text: string; codes: string[] }[];
  confirmed: string[];
  links: ChosenLinks;
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

/** Sent on window when a call finds no session: the sandbox expired, or another tab started over. */
export const NO_SESSION_EVENT = "civ:no-session";

/** The technician this page shows, sent with every call but the session's own (technicians.ts). */
let actingAs: string | null = null;

export function actAs(technician: string | null): void {
  actingAs = technician;
}

/** No reply at all: the network, or a server starting again. */
export const NO_ANSWER = "the server does not answer: try again in a few seconds";
/** A reply that is not the app's own: a failure it did not catch, or the proxy in front of it. */
const FAILED = "the server failed: try again in a few seconds";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (actingAs && url !== "/api/session") headers.set(ACTING_HEADER, actingAs);
  let res: Response;
  try {
    res = await fetch(withBase(url), { cache: "no-store", ...init, headers });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, NO_ANSWER);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && url !== "/api/session" && typeof window !== "undefined") window.dispatchEvent(new Event(NO_SESSION_EVENT));
  if (!res.ok) {
    const fallback = res.status >= 502 && res.status <= 504 ? NO_ANSWER : res.status >= 500 ? FAILED : `HTTP ${res.status}`;
    throw new ApiError(res.status, hideModels(body.error ?? fallback), body as Record<string, unknown>);
  }
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
  startOver: () => call<SessionInfo>("/api/session", { method: "DELETE" }),
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
  deleteAllBatches: () => call<{ deleted: number; reading: number }>("/api/batches", { method: "DELETE" }),
  deleteBatch: (id: string) => call<{ deleted: boolean }>(`/api/batches/${id}`, { method: "DELETE" }),
  retry: (documentId: string) => call<unknown>(`/api/documents/${documentId}/retry`, { method: "POST" }),
  proposal: (documentId: string) => call<ProposalView>(`/api/documents/${documentId}/proposal`),
  open: (documentId: string, takeOver = false) =>
    call<{ document: BatchDocument }>(`/api/documents/${documentId}/open`, postJson({ takeOver })),
  approve: (documentId: string, approval: Approval) =>
    call<{ decision: Decision; next: string | null }>(`/api/documents/${documentId}/approve`, postJson(approval)),
  reject: (documentId: string, reason: RejectReason, note: string) =>
    call<{ decision: Decision; next: string | null }>(`/api/documents/${documentId}/reject`, postJson({ reason, note })),
  release: (documentId: string) => call<{ released: boolean }>(`/api/documents/${documentId}/release`, { method: "POST" }),
  /** The same on the way out, when the page may be gone before an ordinary request finishes. */
  releaseOnExit: (documentId: string) => {
    const headers = actingAs ? { [ACTING_HEADER]: actingAs } : undefined;
    void fetch(withBase(`/api/documents/${documentId}/release`), { method: "POST", keepalive: true, headers }).catch(() => undefined);
  },
  catalog: (q: string, signal?: AbortSignal) =>
    call<{ results: Candidate[]; names: Record<string, string> }>(`/api/catalog?q=${encodeURIComponent(q)}`, { signal }),
  searchRecords: (kind: RecordKind, q: string, signal?: AbortSignal) =>
    call<{ results: RecordView[] }>(`/api/lis/search?kind=${kind}&q=${encodeURIComponent(q)}`, { signal }),
  fusion: (documentId: string, links: ChosenLinks) =>
    call<{ fused: FusedDocument; records: Record<string, RecordView> }>(`/api/documents/${documentId}/fusion`, postJson({ links })),
  pageUrl: (documentId: string, page: number) => withBase(`/api/documents/${documentId}/pages/${page}`),
};

/** States that are still moving: a page showing them keeps polling. */
export const ACTIVE_STATES: DocumentState[] = ["queued", "extracting"];
