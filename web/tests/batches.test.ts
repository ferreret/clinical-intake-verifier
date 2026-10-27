import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approveDocument, getDecision, rejectDocument, type ApprovalInput } from "@/lib/batches/decide";
import { BatchQueue } from "@/lib/batches/queue";
import { batchDocuments } from "@/lib/batches/schema";
import { describeBundled, listBundled } from "@/lib/batches/sources";
import {
  createBatch,
  getBatch,
  getProposal,
  listBatches,
  openDocument,
  releaseDocument,
  requeueInterrupted,
  retryDocument,
  summarise,
} from "@/lib/batches/store";
import { createSandbox, isWorkspaceId, listWorkspaces, openWorkspace, sweepSandboxes } from "@/lib/batches/workspace";
import { sha256Hex } from "@/lib/extractor/pdf";
import { loadLis, openLis } from "@/lib/lis/db";
import { requests } from "@/lib/lis/schema";
import { loadCatalog } from "@/lib/mapping/catalog";
import { DbMemory } from "@/lib/mapping/memory";
import { textKey } from "@/lib/mapping/propose";
import { FIELD_NAMES, FIELDS } from "@/lib/schema/fields";
import type { Prediction } from "@/lib/schema/prediction";

let root: string;
const ENV = ["APP_MODE", "APP_DATA_DIR", "LIS_TEMPLATE", "DEMO_DOCUMENTS", "REPLAY_GEMINI_RUN", "REPLAY_SPEED", "MAPPING_MODEL_CACHE"];
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
});

/** An approval that resolves everything as proposed: required fields filled, red and orange confirmed. */
function resolved(proposal: NonNullable<Awaited<ReturnType<typeof getProposal>>>): ApprovalInput {
  const fused = new Map(proposal.fused.fields.map((f) => [f.name, f]));
  const fields = Object.fromEntries(FIELDS.map((f) => [f.name, fused.get(f.name)!.value ?? (f.required ? "X" : null)]));
  const confirmed = FIELDS.filter((f) => fields[f.name] === fused.get(f.name)!.value && ["red", "orange"].includes(fused.get(f.name)!.state));
  return {
    fields,
    lines: proposal.tests.map(() => ["BQ0001"]),
    added: [],
    confirmed: [...confirmed.map((f) => `f:${f.name}`), ...proposal.tests.map((_, i) => `t:${i}`)],
  };
}

describe("decisions", () => {
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
    const first = await approveDocument(db, one.id, "T01", resolved((await getProposal(db, one.id))!));
    expect(first).toMatchObject({ ok: true, next: three.id });

    await openDocument(db, three.id, "T01");
    const second = await approveDocument(db, three.id, "T01", resolved((await getProposal(db, three.id))!));
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
    const fields = Object.fromEntries(FIELDS.map((f) => [f.name, fused.get(f.name)!.value ?? (f.required ? "X" : null)]));
    const confirmed = FIELDS.filter((f) => ["red", "orange"].includes(fused.get(f.name)!.state) && fields[f.name] === fused.get(f.name)!.value).map(
      (f) => `f:${f.name}`,
    );
    const approved = await approveDocument(db, first.id, "T01", {
      fields,
      lines: [["BQ0001"], ["BQ0001"]],
      added: [{ text: "", codes: ["BQ0001"] }],
      confirmed: [...confirmed, "t:0"],
    });
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
