import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fuse } from "@/lib/fusion/fuse";
import { chosenLink } from "@/lib/fusion/link";
import { readSnapshot } from "@/lib/lis/snapshot";
import { approveDocument, checkApproval, getDecision, rejectDocument, type ApprovalInput } from "@/lib/batches/decide";
import { BatchQueue, failure } from "@/lib/batches/queue";
import { deleteAllBatches, deleteBatch } from "@/lib/batches/remove";
import { batchDocuments } from "@/lib/batches/schema";
import { addressFrom } from "@/lib/batches/session";
import { describeBundled, listBundled } from "@/lib/batches/sources";
import {
  claimNext,
  countReading,
  createBatch,
  getBatch,
  getDocument,
  getProposal,
  listBatches,
  openDocument,
  releaseExpiredLocks,
  releaseDocument,
  requeueInterrupted,
  retryDocument,
  summarise,
  TooManyDocuments,
  TooManyReading,
} from "@/lib/batches/store";
import {
  createSandbox,
  isWorkspaceId,
  listWorkspaces,
  openWorkspace,
  SandboxesFull,
  sweepSandboxes,
  TooManySandboxes,
  deleteSandbox,
  WorkspaceGone,
} from "@/lib/batches/workspace";
import { sha256Hex } from "@/lib/extractor/pdf";
import { loadLis, openLis } from "@/lib/lis/db";
import { requests } from "@/lib/lis/schema";
import { loadCatalog } from "@/lib/mapping/catalog";
import { DbMemory } from "@/lib/mapping/memory";
import { textKey } from "@/lib/mapping/propose";
import { FIELD_NAMES, FIELDS } from "@/lib/schema/fields";

import { documentError } from "@/app/_ui/api";
import { cleanName } from "@/lib/http";
import { en } from "@/app/_ui/messages/en";
import { explainField, explainLine } from "@/app/batches/[id]/[docId]/explain";
import { checkOf, itemsOf } from "@/app/batches/[id]/[docId]/model";
import type { Prediction } from "@/lib/schema/prediction";

let root: string;
const ENV = ["APP_MODE", "APP_DATA_DIR", "LIS_TEMPLATE", "DEMO_DOCUMENTS", "REPLAY_GEMINI_RUN", "REPLAY_SPEED", "MAPPING_MODEL_CACHE", "REPLAY_MAPPING"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

async function pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

function recorded(file: string, sha256: string, tests: string[]): Prediction {
  const values: Record<string, string> = { Paciente: "GARCÍA LÓPEZ, MARÍA", DocumentoIdentidad: "12345678Z", NombreMutua: "Garbí Salut" };
  return {
    prediction_version: 1,
    id: file.replace(".pdf", ""),
    file,
    sha256,
    extractor: {
      model: "recorded",
      model_version: null,
      prompt_version: "6",
      input_mode: "pdf-inline",
      temperature: 0,
      thinking_level: null,
      attempts: 1,
      latency_ms: 5000,
      usage: { input_tokens: null, output_tokens: null, thinking_tokens: null },
      created_at: "2026-10-27T00:00:00Z",
      error: null,
    },
    pages: [{ number: 1, width_pt: 595, height_pt: 842 }],
    fields: Object.fromEntries(FIELD_NAMES.map((n) => [n, n in values ? { value: values[n], page: 1, bbox: null } : null])),
    tests: tests.map((value) => ({ value, page: 1, bbox: null })),
    warnings: [],
  };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "civ-batches-"));
  const bundled = path.join(root, "bundled");
  const run = path.join(root, "run");
  await Promise.all([fs.mkdir(bundled), fs.mkdir(run)]);

  // Two bundled documents; only the first has a recorded reply.
  const [a, b] = [await pdf(), await pdf()];
  b[b.length - 2] ^= 1; // another hash
  await fs.writeFile(path.join(bundled, "doc-a.pdf"), a);
  await fs.writeFile(path.join(bundled, "doc-b.pdf"), b);
  await fs.writeFile(path.join(run, "doc-a.pred.json"), JSON.stringify(recorded("doc-a.pdf", sha256Hex(a), ["Glucosa", "Hemograma"])));

  const template = path.join(root, "template.sqlite");
  const db = await openLis(`file:${template}`);
  await loadLis(db, {
    lis_version: 1,
    seed: 1,
    patients: [
      {
        id: "P1",
        first_name: "María",
        last_name1: "García",
        last_name2: "López",
        sex: "M",
        birth_date: "03/02/1961",
        doc_id: "12345678Z",
        phone: "612345678",
      },
    ],
    physicians: [],
    insurers: [{ id: "A1", name: "Garbí Salut Mútua", aliases: ["Garbí Salut"] }],
  });
  await loadCatalog(db, {
    catalog_version: 2,
    tests: [
      { code: "BQ0001", name: "Glucosa", section: "BQ", analyte: "glucosa", synonyms: ["GLU"], specimen: "suero", default_specimen: true, variant: null },
    ],
    profiles: [],
    specimens: { suero: "Suero" },
  });
  db.$client.close();

  Object.assign(process.env, {
    APP_MODE: "replay",
    APP_DATA_DIR: path.join(root, "data"),
    LIS_TEMPLATE: template,
    DEMO_DOCUMENTS: bundled,
    REPLAY_GEMINI_RUN: run,
    REPLAY_SPEED: "1000",
    MAPPING_MODEL_CACHE: path.join(root, "model-cache"),
    REPLAY_MAPPING: path.join(root, "no-recording.json"),
  });
});

afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(root, { recursive: true, force: true });
});

const newDoc = async (name: string) => ({
  fileName: name,
  sha256: sha256Hex(await fs.readFile(path.join(root, "bundled", name))),
  origin: "bundled" as const,
  location: name,
});

describe("workspaces", () => {
  it("accepts only the live workspace and sandbox ids", () => {
    expect(isWorkspaceId("live")).toBe(true);
    expect(isWorkspaceId("0b7e8d2c-1f4a-4c1e-9a33-5d6f7e8a9b0c")).toBe(true);
    expect(isWorkspaceId("../template")).toBe(false);
  });

  it("starts each sandbox as a copy of the template, apart from the others", async () => {
    const [one, two] = [await createSandbox(), await createSandbox()];
    await createBatch(await openWorkspace(one), { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    expect(await listBatches(await openWorkspace(one))).toHaveLength(1);
    expect(await listBatches(await openWorkspace(two))).toHaveLength(0);
  });

  it("lets the server write while another process reads the workspace", async () => {
    const id = await createSandbox();
    const db = await openWorkspace(id);
    const other = createClient({ url: `file:${path.join(root, "data", "workspaces", `${id}.sqlite`)}` });
    const reading = await other.transaction("read");
    await reading.execute("select count(*) from batches");
    const started = Date.now();
    await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    expect(Date.now() - started).toBeLessThan(1000);
    await reading.rollback();
    other.close();
  });

  it("does not bring a deleted sandbox back when it is opened again", async () => {
    const id = await createSandbox();
    await openWorkspace(id);
    await deleteSandbox(id);
    await expect(openWorkspace(id)).rejects.toBeInstanceOf(WorkspaceGone);
    expect(await listWorkspaces()).not.toContain(id);
  });

  it("makes sandboxes one at a time, so that many at once cannot pass MAX_SANDBOXES", async () => {
    const before = await listWorkspaces();
    process.env.MAX_SANDBOXES = String(before.length + 3);
    try {
      const made = await Promise.allSettled(Array.from({ length: 8 }, () => createSandbox()));
      expect(made.filter((m) => m.status === "fulfilled")).toHaveLength(3);
      expect(made.filter((m) => m.status === "rejected" && m.reason instanceof SandboxesFull)).toHaveLength(5);
      expect(await listWorkspaces()).toHaveLength(before.length + 3);
    } finally {
      delete process.env.MAX_SANDBOXES;
    }
  });

  it("makes at most NEW_SANDBOXES_PER_HOUR sandboxes an hour for one client address", async () => {
    process.env.NEW_SANDBOXES_PER_HOUR = "2";
    try {
      const now = new Date();
      await createSandbox(now, "203.0.113.7");
      await createSandbox(now, "203.0.113.7");
      await expect(createSandbox(now, "203.0.113.7")).rejects.toBeInstanceOf(TooManySandboxes);
      // Another address is not held up, and an hour later the first may make more.
      await createSandbox(now, "198.51.100.20");
      await createSandbox(new Date(now.getTime() + 3601 * 1000), "203.0.113.7");
    } finally {
      delete process.env.NEW_SANDBOXES_PER_HOUR;
    }
  });

  it("tells clients apart by the address the proxy in front of the app saw", () => {
    const from = (h: Record<string, string>, header?: string) => addressFrom(new Headers(h), header);
    // Behind Cloudflare, X-Forwarded-For ends with Cloudflare's address: every visitor's.
    expect(from({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7, 172.70.1.1" })).toBe("203.0.113.7");
    // Before the proxy's own entry, the client could have written anything.
    expect(from({ "x-forwarded-for": "10.9.9.9, 198.51.100.20" })).toBe("198.51.100.20");
    expect(from({ "x-real-ip": "198.51.100.21" })).toBe("198.51.100.21");
    expect(from({})).toBe("direct");
    expect(from({ "x-client": "192.0.2.5", "cf-connecting-ip": "203.0.113.7" }, "x-client")).toBe("192.0.2.5");
  });

  it("keeps at most MAX_SANDBOXES, a new one taking the place of the one unused for longest", async () => {
    const before = await listWorkspaces();
    process.env.MAX_SANDBOXES = String(before.length + 2);
    try {
      const first = await createSandbox();
      const second = await createSandbox();
      const old = new Date(Date.now() - 3600_000);
      await fs.utimes(path.join(root, "data", "workspaces", `${first}.sqlite`), old, old);
      for (const w of before) await fs.utimes(path.join(root, "data", "workspaces", `${w}.sqlite`), new Date(), new Date());
      const third = await createSandbox();
      const now = await listWorkspaces();
      expect(now).toHaveLength(before.length + 2);
      expect(now).toEqual(expect.arrayContaining([second, third]));
      expect(now).not.toContain(first);

      // None unused for long enough: the new visitor waits, nobody's sandbox is deleted.
      await expect(createSandbox()).rejects.toBeInstanceOf(SandboxesFull);
      expect(await listWorkspaces()).toEqual(expect.arrayContaining(now));
      expect(await listWorkspaces()).toHaveLength(before.length + 2);
    } finally {
      delete process.env.MAX_SANDBOXES;
    }
  });

  it("deletes sandboxes unused for longer than their lifetime", async () => {
    const old = await createSandbox();
    const recent = await createSandbox();
    const file = path.join(root, "data", "workspaces", `${old}.sqlite`);
    const past = new Date(Date.now() - 48 * 3600 * 1000);
    await fs.utimes(file, past, past);
    expect(await sweepSandboxes()).toEqual([old]);
    expect(await listWorkspaces()).toContain(recent);
    expect(await listWorkspaces()).not.toContain(old);
  });
});

describe("the queue", () => {
  it("replays the recorded reply, fuses it and maps its lines into a proposal", async () => {
    expect(await listBundled("gemini")).toEqual(["doc-a.pdf"]);
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();

    const { documents } = (await getBatch(db, batch.id))!;
    expect(documents[0]).toMatchObject({ state: "awaiting_verification", attempts: 1, error: null });
    const proposal = (await getProposal(db, documents[0].id))!;
    expect(proposal.recorded).toBe(true);
    expect(proposal.fused.links.patient).toMatchObject({ status: "linked", recordId: "P1" });
    expect(proposal.tests.map((t) => [t.text, t.mapping.codes])).toEqual([
      ["Glucosa", ["BQ0001"]],
      ["Hemograma", null],
    ]);
    // What the decision log needs and cannot derive later: the memory as it was, the model's consultation.
    expect(proposal.tests[0].mapping.seen).toMatchObject({ memory: [], elsewhere: [], search: { minScore: 0.55 } });
    expect(proposal.trace).toMatchObject({
      mapping: { scope: "A1", language: "es", policy: "red", model: { status: "unavailable", error: "no recorded reply for this request" } },
    });
    const [summary] = await listBatches(db);
    expect(summary).toMatchObject({ documents: 1, states: { awaiting_verification: 1, queued: 0 } });
    expect((await summarise(db, [documents[0].id])).get(documents[0].id)).toMatchObject({
      model: "recorded",
      recorded: true,
      latencyMs: 5000,
      pages: 1,
      tests: { green: 0, orange: 1, red: 1 },
    });
    // No golden next to these PDFs: nothing to say about them but their name.
    expect(await describeBundled(["doc-a.pdf"])).toEqual([
      { name: "doc-a.pdf", pages: null, scanned: null, handwritten: null, language: null, template: null },
    ]);
  });

  it("fails a document with no recorded reply, and queues it again on retry", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-b.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    expect(doc).toMatchObject({ state: "failed", error: "no recorded gemini reply for doc-b.pdf" });
    expect(await retryDocument(db, doc.id)).toBe(true);
    expect(await retryDocument(db, doc.id)).toBe(false);
  });

  it("queues again what was left extracting when the server stopped", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    await db.update(batchDocuments).set({ state: "extracting" }).where(eq(batchDocuments.batchId, batch.id));
    expect(await requeueInterrupted(db)).toBe(1);
    expect((await getBatch(db, batch.id))!.documents[0].state).toBe("queued");
  });
});

describe("races", () => {
  it("counts the documents being read in the batch's own transaction", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const doc = await newDoc("doc-a.pdf");
    const make = () => createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [doc, doc, doc], maxReading: 7 });
    const made = await Promise.allSettled([make(), make(), make(), make()]);
    expect(made.filter((m) => m.status === "fulfilled")).toHaveLength(2);
    expect(made.filter((m) => m.status === "rejected" && m.reason instanceof TooManyReading)).toHaveLength(2);
    expect(await countReading(db)).toBe(6);
  });

  it("caps the documents a workspace holds, read or not, when asked to", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const doc = await newDoc("doc-a.pdf");
    const make = () => createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [doc, doc], maxDocuments: 5 });
    await make();
    await make();
    await expect(make()).rejects.toBeInstanceOf(TooManyDocuments);
    expect((await listBatches(db)).reduce((n, b) => n + b.documents, 0)).toBe(4);
  });

  it("does not claim a document whose batch was deleted after it was found", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    // The batch is deleted between the claim finding its document and marking it: the delete
    // takes its turn on the database before the claim's update does.
    let deleted: Promise<unknown> | null = null;
    const racing = new Proxy(db, {
      get: (target, prop, receiver) => {
        if (prop === "update" && !deleted) deleted = deleteBatch(db, batch.id);
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(await claimNext(racing, ["gemini"])).toBeNull();
    expect(await deleted).toEqual({ ok: true });
    expect(await getBatch(db, batch.id)).toBeNull();
  });
});

describe("names sent by a client", () => {
  it("are stored without control characters or the ones that turn text around", () => {
    expect(cleanName("\u202Efdp.exe\u0000 Lote  1\n", 100)).toBe("fdp.exe Lote 1");
    expect(cleanName("x".repeat(300), 200)).toHaveLength(200);
    expect(cleanName("\u200f\u2066 ", 100)).toBe("");
  });
});

describe("releasing a lock", () => {
  it("releases only the lock the page got, not one taken after it", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    const first = await openDocument(db, doc.id, "T01");
    if (!first.ok) throw new Error("not opened");
    await new Promise((r) => setTimeout(r, 5));
    // The technician came back at once: the new page's open got there before the old one's release.
    const again = await openDocument(db, doc.id, "T01");
    if (!again.ok) throw new Error("not opened again");
    expect(await releaseDocument(db, doc.id, "T01", first.document.lockedAt!)).toBe(false);
    expect((await getDocument(db, doc.id))!).toMatchObject({ state: "in_verification", lockedBy: "T01" });
    expect(await releaseDocument(db, doc.id, "T01", again.document.lockedAt!)).toBe(true);
    expect((await getDocument(db, doc.id))!.state).toBe("awaiting_verification");
  });
});

describe("a failed document's error", () => {
  it("shows no SQL, parameters or paths, and keeps the cause for the log", () => {
    const busy = Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" });
    const query = new Error('Failed query: select "doc_id" from "patients" params: 12345678Z', { cause: busy });
    expect(failure(query)).toEqual({ shown: "the database was busy: retry the document", logged: "SQLITE_BUSY: database is locked" });
    const full = new Error("Failed query: insert …", { cause: Object.assign(new Error("SQLITE_FULL: database or disk is full"), { code: "SQLITE_FULL" }) });
    expect(failure(full).shown).toBe("the database could not save it: retry the document");
    const missing = Object.assign(new Error("ENOENT: no such file or directory, open '/data/docs/a.pdf'"), { code: "ENOENT", syscall: "open" });
    expect(failure(missing)).toEqual({ shown: "the document's file could not be read", logged: missing.message });
    expect(failure(new Error("no reply within 120 s")).shown).toBe("no reply within 120 s");
    expect(documentError('Failed query: select "doc_id" from "patients" params: 12345678Z')).toBe("the database could not save it: retry the document");
  });
});

describe("the decision log", () => {
  it("tells each field and line's steps from what was recorded when the document was processed", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    const proposal = (await getProposal(db, doc.id))!;
    const view = { document: doc, batch: null, proposal, codes: { BQ0001: "Glucosa" }, records: { P1: { id: "P1", kind: "patient" as const, title: "María García López", detail: "" } }, siblings: [], decision: null };
    const work = { view, values: {}, chosen: {}, added: [], confirmed: new Set<string>(), checks: {}, names: view.codes };
    const items = itemsOf(view);
    const step = (steps: { kind: string; text: string }[], kind: string) => steps.filter((s) => s.kind === kind).map((s) => s.text);

    const name = explainField(items.find((i) => i.key === "f:Paciente") as Extract<(typeof items)[number], { kind: "field" }>, work, en);
    expect(step(name, "records")).toEqual(["María García López holds “María García López”."]);
    expect(step(name, "compare")[0]).toMatch(/^as names, given name or surnames first: .*the same\.$/);
    expect(step(name, "rule")).toEqual(["The document and the lab's records agree: green."]);

    const glucosa = explainLine(items.find((i) => i.key === "t:0") as Extract<(typeof items)[number], { kind: "test" }>, work, en);
    expect(step(glucosa, "memory")).toEqual(["Never approved for this insurer."]);
    expect(step(glucosa, "search")[1]).toMatch(/it stands out, orange\.$/);
    expect(step(glucosa, "model")).toEqual(["Not asked: only lines left red go to the model."]);
    const hemograma = explainLine(items.find((i) => i.key === "t:1") as Extract<(typeof items)[number], { kind: "test" }>, work, en);
    expect(step(hemograma, "model")).toEqual(["Could not be asked (no recorded reply for this request): the line stays red."]);
    expect(step(hemograma, "result")).toEqual(["Red: no codes proposed."]);
  });
});

describe("verification locks", () => {
  it("locks a ready document to the technician who opens it, until they leave it", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const [doc] = (await getBatch(db, batch.id))!.documents;
    expect(await openDocument(db, doc.id, "T01")).toMatchObject({ ok: false, reason: "not_ready" });

    await db.update(batchDocuments).set({ state: "awaiting_verification" }).where(eq(batchDocuments.id, doc.id));
    expect(await openDocument(db, doc.id, "T01")).toMatchObject({ ok: true, document: { state: "in_verification", lockedBy: "T01" } });
    expect(await openDocument(db, doc.id, "T01")).toMatchObject({ ok: true });
    expect(await openDocument(db, doc.id, "T02")).toMatchObject({ ok: false, reason: "locked" });
    expect(await releaseDocument(db, doc.id, "T02")).toBe(false);
    expect(await openDocument(db, doc.id, "T02", true)).toMatchObject({ ok: true, document: { lockedBy: "T02" } });
    expect(await releaseDocument(db, doc.id, "T02")).toBe(true);
    expect((await getBatch(db, batch.id))!.documents[0]).toMatchObject({ state: "awaiting_verification", lockedBy: null });
    expect(await openDocument(db, "nope", "T01")).toEqual({ ok: false, reason: "missing" });
  });

  it("frees a lock its page stopped renewing, and only that one", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, {
      name: "B",
      provider: "gemini",
      createdBy: "T01",
      documents: [await newDoc("doc-a.pdf"), await newDoc("doc-b.pdf")],
    });
    const [stale, fresh] = (await getBatch(db, batch.id))!.documents;
    await db.update(batchDocuments).set({ state: "awaiting_verification" }).where(eq(batchDocuments.batchId, batch.id));
    await openDocument(db, stale.id, "T01");
    await openDocument(db, fresh.id, "T01");
    // T01's page for the first one went away 40 minutes ago, past the 30 a lock lasts.
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    await db.update(batchDocuments).set({ lockedAt: old }).where(eq(batchDocuments.id, stale.id));

    expect(await openDocument(db, fresh.id, "T02")).toMatchObject({ ok: false, reason: "locked" });
    expect(await openDocument(db, stale.id, "T02")).toMatchObject({ ok: true, document: { lockedBy: "T02" } });

    await db.update(batchDocuments).set({ lockedBy: "T01", lockedAt: old }).where(eq(batchDocuments.id, stale.id));
    expect(await releaseExpiredLocks(db)).toBe(1);
    const [a, b] = (await getBatch(db, batch.id))!.documents;
    expect(a).toMatchObject({ state: "awaiting_verification", lockedBy: null });
    expect(b).toMatchObject({ state: "in_verification", lockedBy: "T01" });
  });
});

/** A value in the field's form, for a required field the document left empty. */
const filler = (f: (typeof FIELDS)[number]) => (f.type === "date" ? "01/01/2000" : (f.enum?.[0] ?? "X"));

/** An approval that resolves everything as proposed: required fields filled, red and orange confirmed. */
function resolved(proposal: NonNullable<Awaited<ReturnType<typeof getProposal>>>): ApprovalInput {
  const fused = new Map(proposal.fused.fields.map((f) => [f.name, f]));
  const fields = Object.fromEntries(FIELDS.map((f) => [f.name, fused.get(f.name)!.value ?? (f.required ? filler(f) : null)]));
  const confirmed = FIELDS.filter((f) => fields[f.name] === fused.get(f.name)!.value && ["red", "orange"].includes(fused.get(f.name)!.state));
  return {
    fields,
    lines: proposal.tests.map(() => ["BQ0001"]),
    added: [],
    confirmed: [...confirmed.map((f) => `f:${f.name}`), ...proposal.tests.map((_, i) => `t:${i}`)],
  };
}

describe("decisions", () => {
  it("approves with a link the technician chose, checking the fields against it and recording it", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    await openDocument(db, doc.id, "T01");
    const stored = (await getProposal(db, doc.id))!;
    expect(stored.fused.links.patient.recordId).toBe("P1");

    // "No record": the patient's fields stand on the document alone, and must be checked as such.
    const asFound = resolved(stored);
    expect(await approveDocument(db, doc.id, "T01", { ...asFound, links: { patient: null } })).toMatchObject({ ok: false, reason: "invalid" });
    const refused = fuse(stored.prediction, await readSnapshot(db), { patient: null });
    const result = await approveDocument(db, doc.id, "T01", { ...resolved({ ...stored, fused: refused }), links: { patient: null } });
    expect(result).toMatchObject({ ok: true });
    const decision = (await getDecision(db, doc.id))!;
    expect(decision.approved).toMatchObject({ chosen: { patient: null }, links: { patient: null, insurer: "A1" } });
    const [request] = await db.select().from(requests).where(eq(requests.decisionId, decision.id));
    expect(request.patientId).toBeNull();
  });

  it("records each field's provenance in the decision, as it was when approved", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    await openDocument(db, doc.id, "T01");
    const stored = (await getProposal(db, doc.id))!;
    expect(await approveDocument(db, doc.id, "T01", resolved(stored))).toMatchObject({ ok: true });
    const fused = stored.fused.fields.find((f) => f.name === "DocumentoIdentidad")!;
    const approved = (await getDecision(db, doc.id))!.approved!.fields.find((f) => f.name === "DocumentoIdentidad")!;
    expect(approved).toMatchObject({
      source: fused.source,
      ai: fused.ai?.value ?? null,
      lis: fused.lis ? { value: fused.lis.value, recordId: fused.lis.recordId } : null,
    });
    expect(approved.lis?.recordId).toBe("P1");
  });

  it("refuses a link to a record of another kind, or to no record at all", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    await openDocument(db, doc.id, "T01");
    const asFound = resolved((await getProposal(db, doc.id))!);
    expect(await approveDocument(db, doc.id, "T01", { ...asFound, links: { patient: "A1" } })).toEqual({
      ok: false,
      reason: "invalid",
      problems: ["the chosen patient A1 is not a record of its kind"],
    });
    expect(await approveDocument(db, doc.id, "T01", { ...asFound, links: { insurer: "A9" } })).toMatchObject({
      problems: ["the chosen insurer A9 is not a record of its kind"],
    });
    expect(await getDecision(db, doc.id)).toBeNull();
    expect(chosenLink("patient", "A1", await readSnapshot(db)).status).toBe("none");
  });

  it("refuses a request with no tests left, as fields.json makes them required", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    await openDocument(db, doc.id, "T01");
    const asFound = resolved((await getProposal(db, doc.id))!);
    const noLines = { ...asFound, lines: asFound.lines.map(() => null), added: [] };
    expect(await approveDocument(db, doc.id, "T01", noLines)).toMatchObject({
      ok: false,
      problems: expect.arrayContaining(["a request needs at least one test: keep or add one"]),
    });
    const oneAdded = { ...noLines, added: [{ text: "Glucosa", codes: [asFound.lines.find((l) => l?.length)![0]] }] };
    expect(await approveDocument(db, doc.id, "T01", oneAdded)).toMatchObject({ ok: true });
  });

  it("does not take a red field with no value as confirmed: one of its values must be chosen or typed", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [await newDoc("doc-a.pdf")] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [doc] = (await getBatch(db, batch.id))!.documents;
    const stored = (await getProposal(db, doc.id))!;
    // The form's phone and the record's disagree: red, and no value proposed.
    const conflict = {
      ...stored,
      fused: { ...stored.fused, fields: stored.fused.fields.map((f) => (f.name === "Telefono" ? { ...f, state: "red" as const, value: null } : f)) },
    };
    const input = resolved(conflict);
    expect(input.confirmed).toContain("f:Telefono");
    const catalog = new Set(["BQ0001"]);
    expect(checkApproval(conflict, input, catalog).problems).toEqual(["Telefono is red with no value: choose or type one"]);
    expect(checkApproval(conflict, { ...input, fields: { ...input.fields, Telefono: "600111222" } }, catalog).problems).toEqual([]);

    // The screen does not offer to confirm it either, and keeps it in the way of approving.
    const field = itemsOf({ proposal: conflict } as Parameters<typeof itemsOf>[0]).find((i) => i.key === "f:Telefono")!;
    const view = { proposal: conflict } as Parameters<typeof checkOf>[1];
    expect(checkOf(field, view, "", undefined, true)).toEqual({ pending: true, confirmable: false });
    expect(checkOf(field, view, "600111222", undefined, false)).toEqual({ pending: false, confirmable: false });
  });

  it("refuses a request number already registered in the LIS", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const doc = await newDoc("doc-a.pdf");
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [doc, doc] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [first, second] = (await getBatch(db, batch.id))!.documents;
    for (const d of [first, second]) await openDocument(db, d.id, "T01");
    const input = resolved((await getProposal(db, first.id))!);
    const number = { ...input, fields: { ...input.fields, NumeroPeticion: "R-0001" } };
    expect(await approveDocument(db, first.id, "T01", number)).toMatchObject({ ok: true });
    expect(await approveDocument(db, second.id, "T01", number)).toEqual({
      ok: false,
      reason: "invalid",
      problems: ["NumeroPeticion R-0001 is already registered: reject the document as a duplicate"],
    });
    // Nothing of the refused approval stays: the document is still the technician's to decide on.
    expect((await getDocument(db, second.id))!.state).toBe("in_verification");
    expect(await db.select().from(requests)).toHaveLength(1);
    expect(await approveDocument(db, second.id, "T01", { ...number, fields: { ...number.fields, NumeroPeticion: "R-0002" } })).toMatchObject({ ok: true });
  });

  it("goes on to the next document to decide on: one free or the technician's own first, else one another has open", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const doc = await newDoc("doc-a.pdf");
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [doc, doc, doc] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [one, two, three] = (await getBatch(db, batch.id))!.documents;
    await openDocument(db, two.id, "T02"); // left open by another technician

    await openDocument(db, one.id, "T01");
    // Copies of one document, each approved as a request of its own number.
    const own = (input: ApprovalInput, n: string) => ({ ...input, fields: { ...input.fields, NumeroPeticion: n } });
    const first = await approveDocument(db, one.id, "T01", own(resolved((await getProposal(db, one.id))!), "R-1"));
    expect(first).toMatchObject({ ok: true, next: three.id });

    await openDocument(db, three.id, "T01");
    const second = await approveDocument(db, three.id, "T01", own(resolved((await getProposal(db, three.id))!), "R-3"));
    expect(second).toMatchObject({ ok: true, next: two.id });
  });

  it("approves only what is resolved, records it once, registers the request and teaches the memory", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const batch = await createBatch(db, {
      name: "B",
      provider: "gemini",
      createdBy: "T01",
      documents: [await newDoc("doc-a.pdf"), await newDoc("doc-a.pdf")],
    });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [first, second] = (await getBatch(db, batch.id))!.documents;
    const proposal = (await getProposal(db, first.id))!;

    // Not opened by this technician: not theirs to approve.
    const asProposed: ApprovalInput = {
      fields: Object.fromEntries(proposal.fused.fields.map((f) => [f.name, f.value])),
      lines: proposal.tests.map((t) => t.mapping.codes ?? []),
      added: [],
      confirmed: [],
    };
    expect(await approveDocument(db, first.id, "T01", asProposed)).toMatchObject({ ok: false, reason: "not_yours" });
    await openDocument(db, first.id, "T01");

    // As proposed: required fields empty, orange and red items neither changed nor confirmed.
    const refused = await approveDocument(db, first.id, "T01", asProposed);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    const problems = refused.ok ? [] : refused.problems!;
    expect(problems).toContain("line 1 (Glucosa) is orange: change or confirm it");
    expect(problems).toContain("line 2 (Hemograma) has no codes");
    expect(problems.some((p) => /is required/.test(p))).toBe(true);

    // Resolved: required fields filled, the other red and orange ones confirmed, a code chosen
    // for the red line, the first line confirmed, a test added.
    const fused = new Map(proposal.fused.fields.map((f) => [f.name, f]));
    const fields = Object.fromEntries(FIELDS.map((f) => [f.name, fused.get(f.name)!.value ?? (f.required ? filler(f) : null)]));
    const confirmed = FIELDS.filter((f) => ["red", "orange"].includes(fused.get(f.name)!.state) && fields[f.name] === fused.get(f.name)!.value).map(
      (f) => `f:${f.name}`,
    );
    const resolution = { lines: [["BQ0001"], ["BQ0001"]], added: [{ text: "", codes: ["BQ0001"] }], confirmed: [...confirmed, "t:0"] };

    // A value out of its field's form is refused, whatever the technician confirmed.
    const malformed = await approveDocument(db, first.id, "T01", { ...resolution, fields: { ...fields, FechaNacimiento: "31/02/1990", Sexo: "X" } });
    expect(malformed).toMatchObject({ ok: false, reason: "invalid" });
    expect(malformed.ok ? [] : malformed.problems).toEqual([
      "FechaNacimiento is not in its form: 31/02/1990",
      "Sexo is not in its form: X",
    ]);

    const approved = await approveDocument(db, first.id, "T01", { ...resolution, fields });
    expect(approved).toMatchObject({ ok: true, next: second.id, decision: { decision: "approved", technician: "T01" } });

    const decision = (await getDecision(db, first.id))!;
    expect(decision.approved!.tests.map((t) => t.action)).toEqual(["confirmed", "chosen", "added"]);
    expect(decision.approved!.links).toMatchObject({ patient: "P1", insurer: "A1" });
    const [request] = await db.select().from(requests).where(eq(requests.decisionId, decision.id));
    expect(request).toMatchObject({ patientId: "P1", insurerId: "A1" });
    expect(request.tests).toEqual([
      { text: "Glucosa", codes: ["BQ0001"] },
      { text: "Hemograma", codes: ["BQ0001"] },
      { text: "", codes: ["BQ0001"] },
    ]);
    const memory = new DbMemory(db);
    expect(await memory.lookup("A1", textKey("Glucosa"))).toEqual([{ codes: ["BQ0001"], active: 1, passive: 0, corrections: 0 }]);
    expect(await memory.lookup("A1", textKey("Hemograma"))).toEqual([{ codes: ["BQ0001"], active: 1, passive: 0, corrections: 0 }]);
    expect((await getBatch(db, batch.id))!.documents[0]).toMatchObject({ state: "approved", lockedBy: null });

    // Written once: the document is no longer anyone's to approve.
    expect(await approveDocument(db, first.id, "T01", asProposed)).toMatchObject({ ok: false, reason: "not_yours" });

    // Rejecting keeps the document and its proposal, and says why; nothing left to verify after it.
    await openDocument(db, second.id, "T02");
    expect(await rejectDocument(db, second.id, "T02", "illegible", " smudged ")).toMatchObject({
      ok: true,
      next: null,
      decision: { decision: "rejected", technician: "T02", reason: "illegible: smudged", approved: null },
    });
    expect((await getBatch(db, batch.id))!.documents[1].state).toBe("rejected");
    expect(await getProposal(db, second.id)).not.toBeNull();
  });
});

describe("deleting a batch", () => {
  it("takes away its documents, proposals, decisions and registered requests, but not what the memory learned", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const doc = await newDoc("doc-a.pdf");
    const batch = await createBatch(db, { name: "B", provider: "gemini", createdBy: "T01", documents: [doc, doc] });
    const keep = await createBatch(db, { name: "Keep", provider: "gemini", createdBy: "T01", documents: [doc] });
    const q = new BatchQueue();
    q.kick(ws);
    await q.idle();
    const [one] = (await getBatch(db, batch.id))!.documents;
    await openDocument(db, one.id, "T01");
    expect(await approveDocument(db, one.id, "T01", resolved((await getProposal(db, one.id))!))).toMatchObject({ ok: true });
    expect(await db.select().from(requests)).toHaveLength(1);

    await db.update(batchDocuments).set({ state: "extracting" }).where(eq(batchDocuments.id, (await getBatch(db, batch.id))!.documents[1].id));
    expect(await deleteBatch(db, batch.id)).toEqual({ ok: false, reason: "reading" });
    await db.update(batchDocuments).set({ state: "awaiting_verification" }).where(eq(batchDocuments.batchId, batch.id));

    expect(await deleteBatch(db, batch.id)).toEqual({ ok: true });
    expect(await getBatch(db, batch.id)).toBeNull();
    expect(await getProposal(db, one.id)).toBeNull();
    expect(await getDecision(db, one.id)).toBeNull();
    expect(await db.select().from(requests)).toHaveLength(0);
    expect(await new DbMemory(db).lookup("A1", textKey("Glucosa"))).toHaveLength(1);
    expect((await listBatches(db)).map((b) => b.id)).toEqual([keep.id]);
    expect(await deleteBatch(db, batch.id)).toEqual({ ok: false, reason: "missing" });
  });

  it("deletes them all at once, but those still being read", async () => {
    const ws = await createSandbox();
    const db = await openWorkspace(ws);
    const doc = await newDoc("doc-a.pdf");
    for (const name of ["A", "B"]) await createBatch(db, { name, provider: "gemini", createdBy: "T01", documents: [doc] });
    const reading = await createBatch(db, { name: "C", provider: "gemini", createdBy: "T01", documents: [doc] });
    await db.update(batchDocuments).set({ state: "extracting" }).where(eq(batchDocuments.batchId, reading.id));
    expect(await deleteAllBatches(db)).toEqual({ deleted: 2, reading: 1 });
    expect((await listBatches(db)).map((b) => b.name)).toEqual(["C"]);
  });
});
