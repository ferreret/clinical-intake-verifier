import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { openLis } from "@/lib/lis/db";
import { loadCatalog, readCatalog, type Catalog, type CatalogFile } from "@/lib/mapping/catalog";
import { DbMemory, InMemoryMemory, type MappingMemory } from "@/lib/mapping/memory";
import { GREEN_APPROVALS, propose, textKey } from "@/lib/mapping/propose";
import { CatalogIndex } from "@/lib/mapping/search";

const FILE: CatalogFile = {
  catalog_version: 2,
  specimens: { S: "suero", O: "orina" },
  tests: [
    { code: "BQ0001", name: "Glucosa, suero", section: "BQ", analyte: "Glucosa", synonyms: ["Glucemia", "GLU"], specimen: "S", default_specimen: true, variant: null },
    { code: "BQ0002", name: "Glucosa, orina", section: "BQ", analyte: "Glucosa", synonyms: ["Glucemia", "GLU"], specimen: "O", default_specimen: false, variant: null },
    { code: "BQ0003", name: "Colesterol total, suero", section: "BQ", analyte: "Colesterol total", synonyms: ["Colesterol", "CT"], specimen: "S", default_specimen: true, variant: null },
    { code: "BQ0004", name: "Sodio, suero", section: "BQ", analyte: "Sodio", synonyms: ["Na"], specimen: "S", default_specimen: true, variant: null },
    { code: "BQ0005", name: "Potasio, suero", section: "BQ", analyte: "Potasio", synonyms: ["K"], specimen: "S", default_specimen: true, variant: null },
    { code: "MI0001", name: "Urocultivo", section: "MI", analyte: "Urocultivo", synonyms: ["Cultivo de orina"], specimen: null, default_specimen: true, variant: null },
  ],
  profiles: [{ id: "PF07", name: "Iones", codes: ["BQ0004", "BQ0005"] }],
};

const CATALOG: Catalog = {
  tests: FILE.tests.map((t) => ({
    code: t.code,
    name: t.name,
    analyte: t.analyte,
    synonyms: t.synonyms,
    specimen: t.specimen ? FILE.specimens[t.specimen] : null,
    defaultSpecimen: t.default_specimen,
    variant: t.variant,
  })),
  profiles: FILE.profiles,
};
const INDEX = new CatalogIndex(CATALOG);

describe("catalog search", () => {
  it("reads a bare analyte as its usual specimen", () => {
    expect(INDEX.search("Glucosa")[0].codes).toEqual(["BQ0001"]);
    expect(INDEX.search("GLU (SUERO)")[0].codes).toEqual(["BQ0001"]);
    expect(INDEX.search("Glucosa en orina")[0].codes).toEqual(["BQ0002"]);
  });

  it("finds truncated words and profiles", () => {
    expect(INDEX.search("Colest. total")[0].codes).toEqual(["BQ0003"]);
    expect(INDEX.search("IONES")[0]).toMatchObject({ kind: "profile", codes: ["BQ0004", "BQ0005"] });
  });
});

async function learning(memory: MappingMemory) {
  const line = "Urinocultiu";
  const states: string[] = [];
  for (let i = 0; i < GREEN_APPROVALS + 1; i++) {
    const p = await propose(line, "A01", memory, INDEX);
    states.push(`${p.state}:${p.source}`);
    await memory.approve("A01", textKey(line), ["MI0001"], p.state === "green" ? "passive" : "active");
  }
  return states;
}

describe("proposals", () => {
  it("turns green only after active approvals", async () => {
    expect(await learning(new InMemoryMemory())).toEqual(["red:null", "orange:memory", "green:memory"]);
  });

  it("does not count passive approvals towards green", async () => {
    const m = new InMemoryMemory();
    await m.approve("A01", textKey("Glucèmia"), ["BQ0001"], "active");
    await m.approve("A01", textKey("Glucèmia"), ["BQ0001"], "passive");
    expect((await propose("Glucèmia", "A01", m, INDEX)).state).toBe("orange");
  });

  it("turns red when approvals contradict each other", async () => {
    const m = new InMemoryMemory();
    await m.approve("A01", textKey("GLU"), ["BQ0001"], "active");
    await m.approve("A01", textKey("GLU"), ["BQ0002"], "active");
    expect(await propose("GLU", "A01", m, INDEX)).toMatchObject({ state: "red", codes: null });
  });

  it("keeps a corrected meaning orange", async () => {
    const m = new InMemoryMemory();
    for (let i = 0; i < GREEN_APPROVALS; i++) await m.approve("A01", textKey("CT"), ["BQ0003"], "active");
    await m.correct("A01", textKey("CT"), ["BQ0003"]);
    expect((await propose("CT", "A01", m, INDEX)).state).toBe("orange");
  });

  it("suggests what other insurers approved, never green", async () => {
    const m = new InMemoryMemory();
    for (let i = 0; i < 3; i++) await m.approve("A02", textKey("Perfil iónico"), ["BQ0004", "BQ0005"], "active");
    expect(await propose("PERFIL IÓNICO", "A01", m, INDEX)).toMatchObject({
      state: "orange",
      source: "memory_elsewhere",
      codes: ["BQ0004", "BQ0005"],
    });
  });

  it("proposes a clear search result orange and an unclear one red", async () => {
    const m = new InMemoryMemory();
    expect(await propose("Colesterol total", "none", m, INDEX)).toMatchObject({ state: "orange", source: "search", codes: ["BQ0003"] });
    expect(await propose("Zzz qwerty", "none", m, INDEX)).toMatchObject({ state: "red", codes: null });
  });
});

describe("stored catalog and memory", () => {
  it("round-trips the catalog and learns the same way in the database", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mapping-"));
    try {
      const db = await openLis(`file:${path.join(dir, "lab.sqlite")}`);
      await loadCatalog(db, FILE);
      const read = await readCatalog(db);
      expect(read.tests.find((t) => t.code === "BQ0001")).toMatchObject({ specimen: "suero", defaultSpecimen: true });
      expect(read.profiles[0].codes).toEqual(["BQ0004", "BQ0005"]);
      expect(await learning(new DbMemory(db))).toEqual(["red:null", "orange:memory", "green:memory"]);
      db.$client.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
