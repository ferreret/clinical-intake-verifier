import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLis, openLis, type LisDb, type LisFile } from "@/lib/lis/db";
import { insurerAliases, patients, physicians } from "@/lib/lis/schema";

const SAMPLE: LisFile = {
  lis_version: 1,
  seed: 1,
  patients: [
    {
      id: "P00000",
      first_name: "Rosa",
      last_name1: "Vidal",
      last_name2: "Soler",
      sex: "M",
      birth_date: "03/02/1961",
      doc_id: "12345678Z",
      phone: "600111222",
    },
    {
      id: "P00001",
      first_name: "Rosa",
      last_name1: "Vidal",
      last_name2: "Soler",
      sex: "M",
      birth_date: "14/09/1988",
      doc_id: "87654321X",
      phone: "600333444",
    },
  ],
  physicians: [
    {
      id: "M0000",
      first_name: "Pau",
      last_name1: "Roig",
      last_name2: "Mas",
      sex: "H",
      colegiado: "080812345",
    },
  ],
  insurers: [{ id: "A01", name: "Garbí Salut Mútua", aliases: ["GARBÍ SALUT MÚTUA", "Garbí Salut"] }],
};

describe("mock LIS", () => {
  let dir: string;
  let db: LisDb;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lis-"));
    db = await openLis(`file:${path.join(dir, "lis.sqlite")}`);
    await loadLis(db, SAMPLE);
  });

  afterEach(async () => {
    db.$client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("finds a patient by identity document", async () => {
    const rows = await db.select().from(patients).where(eq(patients.docId, "87654321X"));
    expect(rows.map((r) => [r.id, r.birthDate])).toEqual([["P00001", "14/09/1988"]]);
  });

  it("keeps namesakes apart", async () => {
    const rows = await db.select().from(patients).where(eq(patients.lastName1, "Vidal"));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.birthDate)).size).toBe(2);
  });

  it("finds a physician by registration number and an insurer by alias", async () => {
    const [m] = await db.select().from(physicians).where(eq(physicians.colegiado, "080812345"));
    expect(m.lastName1).toBe("Roig");
    const [a] = await db.select().from(insurerAliases).where(eq(insurerAliases.alias, "Garbí Salut"));
    expect(a.insurerId).toBe("A01");
  });

  it("replaces the records when loaded again", async () => {
    await loadLis(db, { ...SAMPLE, patients: SAMPLE.patients.slice(0, 1) });
    expect(await db.select().from(patients)).toHaveLength(1);
  });

  it("rejects a duplicate identity document", async () => {
    const dup = { ...SAMPLE, patients: [SAMPLE.patients[0], { ...SAMPLE.patients[1], doc_id: "12345678Z" }] };
    await expect(loadLis(db, dup)).rejects.toThrow();
    expect(await db.select().from(patients)).toHaveLength(2);
  });

  it("refuses another lis_version", async () => {
    await expect(loadLis(db, { ...SAMPLE, lis_version: 2 })).rejects.toThrow(/lis_version/);
  });

  it("lets a write wait for a transaction that is still open, without stopping the process", async () => {
    // Two documents completed at once: one's transaction pauses between its statements,
    // and the other's write arrives meanwhile, on another of the client's connections.
    const started = Date.now();
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 5);
    const first = db.transaction(async (tx) => {
      await tx.update(patients).set({ phone: "600000001" }).where(eq(patients.id, "P00000"));
      await new Promise((r) => setTimeout(r, 50));
      await tx.update(patients).set({ phone: "600000002" }).where(eq(patients.id, "P00000"));
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = db.update(patients).set({ phone: "600000003" }).where(eq(patients.id, "P00001"));
    await Promise.all([first, second]);
    clearInterval(timer);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ticks).toBeGreaterThan(3);
    const phones = (await db.select().from(patients)).map((p) => [p.id, p.phone]);
    expect(phones).toEqual([
      ["P00000", "600000002"],
      ["P00001", "600000003"],
    ]);
  });

  it("keeps what is written after another process's lock made a write fail", async () => {
    // The driver leaves the failed write in progress on its connection, and what was written
    // on that connection afterwards was never saved: a document marked failed stayed reading.
    const url = `file:${path.join(dir, "lis.sqlite")}`;
    db.$client.close();
    db = await openLis(url, { busyTimeoutMs: 50 });
    const other = createClient({ url });
    const lock = await other.transaction("write");
    await expect(db.update(patients).set({ phone: "600000001" }).where(eq(patients.id, "P00000"))).rejects.toMatchObject({
      cause: { code: "SQLITE_BUSY" },
    });
    await lock.rollback();
    await db.update(patients).set({ phone: "600000002" }).where(eq(patients.id, "P00001"));
    await db.transaction(async (tx) => {
      await tx.update(patients).set({ phone: "600000003" }).where(eq(patients.id, "P00000"));
    });
    const saved = await other.execute("select id, phone from patients order by id");
    other.close();
    expect(saved.rows.map((r) => [r.id, r.phone])).toEqual([
      ["P00000", "600000003"],
      ["P00001", "600000002"],
    ]);
  });

  it("keeps what is written after a commit failed on another process's read", async () => {
    const url = `file:${path.join(dir, "lis.sqlite")}`;
    db.$client.close();
    db = await openLis(url, { busyTimeoutMs: 50 });
    const other = createClient({ url });
    let reading: Awaited<ReturnType<typeof other.transaction>> | undefined;
    await expect(
      db.transaction(async (tx) => {
        await tx.update(patients).set({ phone: "600000001" }).where(eq(patients.id, "P00000"));
        // Someone reads the file before the commit, which then cannot take the file for itself.
        reading = await other.transaction("read");
        await reading.execute("select count(*) from patients");
      }),
    ).rejects.toThrow(/SQLITE_BUSY/);
    await reading!.rollback();
    await db.update(patients).set({ phone: "600000002" }).where(eq(patients.id, "P00001"));
    const saved = await other.execute("select id, phone from patients order by id");
    other.close();
    expect(saved.rows.map((r) => [r.id, r.phone])).toEqual([
      ["P00000", "600111222"],
      ["P00001", "600000002"],
    ]);
  });

  it("frees the database when a transaction fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.update(patients).set({ phone: "600000009" }).where(eq(patients.id, "P00000"));
        throw new Error("no");
      }),
    ).rejects.toThrow("no");
    const [p] = await db.select().from(patients).where(eq(patients.id, "P00000"));
    expect(p.phone).toBe("600111222");
  });
});
