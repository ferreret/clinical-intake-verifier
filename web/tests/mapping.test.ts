import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { openLis } from "@/lib/lis/db";
import { loadCatalog, readCatalog, type Catalog, type CatalogFile } from "@/lib/mapping/catalog";
import { proposeDocument } from "@/lib/mapping/document";
import { DbMemory, InMemoryMemory, type MappingMemory } from "@/lib/mapping/memory";
import { buildPrompt, consult, type Provider } from "@/lib/mapping/model";
import { GREEN_APPROVALS, propose, textKey } from "@/lib/mapping/propose";
import { browse, codeNames } from "@/lib/mapping/browse";
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
const INDEX_SYNC_IONES = [
  { kind: "profile" as const, ref: "PF07", codes: ["BQ0004", "BQ0005"], label: "Iones", score: 1 },
  { kind: "test" as const, ref: "BQ0004", codes: ["BQ0004"], label: "Sodio, suero", score: 0.3 },
];

describe("catalog search", () => {
  it("reads a bare analyte as its usual specimen", async () => {
    expect((await INDEX.search("Glucosa"))[0].codes).toEqual(["BQ0001"]);
    expect((await INDEX.search("GLU (SUERO)"))[0].codes).toEqual(["BQ0001"]);
    expect((await INDEX.search("Glucosa en orina"))[0].codes).toEqual(["BQ0002"]);
  });

  it("finds truncated words and profiles", async () => {
    expect((await INDEX.search("Colest. total"))[0].codes).toEqual(["BQ0003"]);
    expect((await INDEX.search("IONES"))[0]).toMatchObject({ kind: "profile", codes: ["BQ0004", "BQ0005"] });
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

describe("browsing the catalog by hand", () => {
  it("puts the codes that start with the query first", () => {
    const found = browse(INDEX, "bq000");
    expect(found.slice(0, 5).map((c) => c.ref)).toEqual(["BQ0001", "BQ0002", "BQ0003", "BQ0004", "BQ0005"]);
    expect(browse(INDEX, "PF07")[0]).toMatchObject({ kind: "profile", codes: ["BQ0004", "BQ0005"] });
  });

  it("finds by name, and nothing for an empty query or noise", () => {
    expect(browse(INDEX, "urocultivo")[0].ref).toBe("MI0001");
    expect(browse(INDEX, "iones")[0].ref).toBe("PF07");
    expect(browse(INDEX, "  ")).toEqual([]);
    expect(browse(INDEX, "zzzz")).toEqual([]);
  });

  it("names codes as the catalog does, and an unknown one by itself", () => {
    expect(codeNames(CATALOG, ["BQ0001", "XX9999", "BQ0001"])).toEqual({ BQ0001: "Glucosa, suero", XX9999: "XX9999" });
  });
});

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

/** A provider that answers from a table, and records what it was asked. */
function fakeProvider(answers: Record<string, string[]>): Provider & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    name: "local",
    model: "fake",
    asked,
    async complete(_system, user, schema) {
      const ids = Object.keys((schema as { properties: Record<string, unknown> }).properties);
      asked.push(ids);
      const lines = Object.fromEntries(ids.map((id) => [id, answers[user.match(new RegExp(`${id}: "([^"]*)"`))![1]] ?? []]));
      return { text: JSON.stringify(lines), usage: { inputTokens: 10, outputTokens: 2 } };
    },
  };
}

describe("model layer", () => {
  const ctx = { scope: "A01", insurer: "Garbí Salut Mútua", language: "ca" };
  const lines = ["Colesterol total", "Zzz qwerty", "Urinocultiu"];

  it("asks only about red lines under the red policy, once per document", async () => {
    const provider = fakeProvider({ "Zzz qwerty": [], Urinocultiu: ["MI0001"] });
    const out = await proposeDocument(lines, ctx, new InMemoryMemory(), INDEX, undefined, {
      provider,
      policy: "red",
      catalog: CATALOG,
      cacheDir: null,
    });
    expect(provider.asked).toHaveLength(1);
    expect(out.proposals.map((p) => `${p.state}:${p.source}`)).toEqual(["orange:search", "red:null", "orange:model"]);
    expect(out.proposals[2].codes).toEqual(["MI0001"]);
  });

  it("lets the model overrule the search under the all policy, and none means red", async () => {
    const provider = fakeProvider({ "Colesterol total": [], Urinocultiu: ["MI0001"] });
    const out = await proposeDocument(lines, ctx, new InMemoryMemory(), INDEX, undefined, {
      provider,
      policy: "all",
      catalog: CATALOG,
      cacheDir: null,
    });
    expect(out.proposals[0]).toMatchObject({ state: "red", codes: null });
  });

  it("holds a recorded answer to the line's candidates, as the live model is", async () => {
    const provider = fakeProvider({});
    const replay = (asked: { id: string }[]) => ({
      // A code the line was never offered, as a recording made with another catalog could hold.
      choices: new Map(asked.map((l) => [l.id, ["ZZ9999"]])),
      usage: { inputTokens: null, outputTokens: null },
      latencyMs: 0,
      cached: true,
    });
    const out = await proposeDocument(["Zzz qwerty"], ctx, new InMemoryMemory(), INDEX, undefined, {
      provider,
      policy: "red",
      catalog: CATALOG,
      cacheDir: null,
      replay,
    });
    expect(out.proposals[0]).toMatchObject({ state: "red", codes: null });
    expect(out.model.get(0)).toBeNull();
  });

  it("offers a profile's components and lists only candidate codes in the schema", () => {
    const prompt = buildPrompt(
      {
        insurer: null,
        language: "es",
        formLines: ["IONES"],
        lines: [{ id: "L1", text: "IONES", candidates: INDEX_SYNC_IONES }],
      },
      CATALOG,
    );
    const enumOf = (prompt.schema.properties as Record<string, { items: { enum: string[] } }>).L1.items.enum;
    expect(enumOf).toEqual(expect.arrayContaining(["BQ0004", "BQ0005"]));
    expect(enumOf).not.toContain("PF07");
    expect(prompt.user).toContain('lab profile "Iones" = BQ0004, BQ0005');
  });
});

describe("model replies", () => {
  const req = { insurer: null, language: "es", formLines: ["IONES"], lines: [{ id: "L1", text: "IONES", candidates: INDEX_SYNC_IONES }] };
  /** A provider that answers each call with the next of `texts`. */
  const scripted = (texts: string[]): Provider & { calls: number } => {
    const p = {
      name: "local" as const,
      model: "fake",
      calls: 0,
      async complete() {
        return { text: texts[p.calls++], usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    return p;
  };

  it("asks again for a broken reply found in the cache, and caches the good one instead", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "civ-cache-"));
    try {
      const first = await consult(req, CATALOG, scripted(['{"L1": ["BQ0004"]}']), dir);
      const [file] = await readdir(dir);
      await writeFile(path.join(dir, file), JSON.stringify({ text: '{"L1": ["MI', usage: { inputTokens: 1, outputTokens: 1 } }));
      const provider = scripted(['{"L1": ["BQ0004"]}']);
      const again = await consult(req, CATALOG, provider, dir);
      expect(provider.calls).toBe(1);
      expect(again).toMatchObject({ cached: false, choices: first.choices });
      expect(await consult(req, CATALOG, scripted([]), dir)).toMatchObject({ cached: true, choices: first.choices });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("retries a reply that is not the JSON object asked for", async () => {
    vi.useFakeTimers();
    try {
      const provider = scripted(["", '{"L1": ["BQ0004"]}']);
      const out = consult(req, CATALOG, provider, null);
      await vi.advanceTimersByTimeAsync(2000);
      expect((await out).choices.get("L1")).toEqual(["BQ0004"]);
      expect(provider.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
