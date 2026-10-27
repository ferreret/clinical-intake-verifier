/**
 * The demo's starting memory of approved mappings: what technicians approved before the
 * visitor arrived (docs/roadmap.md, F6). A sandbox that started empty would show almost every
 * line orange or red, and its colours would depend on the order of the visitor's approvals.
 *
 * The history is synthetic requests the demo never shows: documents 200 to 999 of the
 * 1,000-document set, whose first 200 are the demo's own. Each of their lines is taken as
 * approved by a technician with its right codes (from the golden), under its insurer, as
 * printed. The LIS template is copied with that memory into a new database, which the demo
 * then uses as LIS_TEMPLATE.
 *
 *   npm run seed-memory -- [--history <dir>] [--from 200] [--count 800]
 *                          [--template <db>] [--out <db>] [--measure <run dir>]
 *
 * --measure leaves the databases alone and prints, for the demo set as a run read it, how the
 * lines come out (memory and catalog search, no model) with 0, 100, 200, 400 and 800
 * documents of history, so the amount can be chosen from what it does. With --replay <file>
 * it also sends the red lines to the recorded model replies, as the demo does, and says how
 * many it answered and how many of those were right.
 */
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { memoryScope } from "@/lib/batches/pipeline";
import { fuse } from "@/lib/fusion/fuse";
import { openLis } from "@/lib/lis/db";
import { readSnapshot } from "@/lib/lis/snapshot";
import { readCatalog } from "@/lib/mapping/catalog";
import { alignLines } from "@/lib/mapping/align";
import { DbMemory, InMemoryMemory, type MappingMemory } from "@/lib/mapping/memory";
import { proposeDocument } from "@/lib/mapping/document";
import type { Provider } from "@/lib/mapping/model";
import { propose, textKey } from "@/lib/mapping/propose";
import { loadRecordedMapping, replayConsultation } from "@/lib/mapping/recorded";
import { CatalogIndex } from "@/lib/mapping/search";
import { compareKey } from "@/lib/schema/compare";
import type { Prediction } from "@/lib/schema/prediction";

interface Golden {
  id: string;
  fields: Record<string, { value: string } | null>;
  tests: { value: string; printed?: string; codes: string[] }[];
  lis: { insurer_id: string | null };
}

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function history(dir: string, from: number, count: number): Promise<Golden[]> {
  const names = (await readdir(dir)).filter((n) => /^synth-\d+\.json$/.test(n)).sort();
  const picked = names.filter((n) => {
    const i = Number(n.slice(6, 12));
    return i >= from && i < from + count;
  });
  return Promise.all(picked.map(async (n) => JSON.parse(await readFile(path.join(dir, n), "utf8")) as Golden));
}

/** Whose approvals a golden's lines count for, as memoryScope finds it for a read document. */
function scopeOf(g: Golden): string {
  if (g.lis.insurer_id) return g.lis.insurer_id;
  const printed = g.fields.NombreMutua?.value;
  return printed ? `name:${compareKey(printed, "casefold")}` : "none";
}

async function learn(memory: MappingMemory, goldens: Golden[]): Promise<number> {
  let lines = 0;
  for (const g of goldens) {
    for (const t of g.tests) {
      await memory.approve(scopeOf(g), textKey(t.printed ?? t.value), t.codes, "active");
      lines += 1;
    }
  }
  return lines;
}

async function measure(template: string, run: string, goldens: Golden[], replay: string | null): Promise<void> {
  const db = await openLis(`file:${path.resolve(template)}`);
  const lis = await readSnapshot(db);
  const catalog = await readCatalog(db);
  const index = new CatalogIndex(catalog);
  const recording = replay ? await loadRecordedMapping(replay) : null;
  if (replay && !recording) throw new Error(`no recording at ${replay}`);
  const predictions = await Promise.all(
    (await readdir(run))
      .filter((n) => n.endsWith(".pred.json"))
      .sort()
      .map(async (n) => JSON.parse(await readFile(path.join(run, n), "utf8")) as Prediction),
  );
  console.log(`demo set: ${predictions.length} documents read in ${path.basename(run)}`);
  // The demo set's own goldens, to tell a green line right or wrong.
  const truth = new Map<string, Golden>();
  for (const p of predictions) truth.set(p.id, JSON.parse(await readFile(path.join(path.dirname(run), "..", "synth", "seed-42", `${p.id}.json`), "utf8")) as Golden);
  console.log("history  green  orange  red    wrong green  (lines, memory and catalog only)");
  const sizes = recording ? [Number(option("count", "400"))] : [0, 100, 200, 400, 800];
  if (recording) console.log(`with the model's recorded replies (${path.basename(replay!)}), ${sizes[0]} documents of history:`);
  for (const size of sizes) {
    const memory = new InMemoryMemory();
    await learn(memory, goldens.slice(0, size));
    const tally = { green: 0, orange: 0, red: 0 };
    let wrongGreen = 0;
    const model = { asked: 0, answered: 0, right: 0, missing: 0 };
    const unused: Provider = { name: "gemini", model: "recorded", complete: () => Promise.reject(new Error("recorded only")) };
    for (const p of predictions) {
      if (p.extractor.error) continue;
      const scope = memoryScope(fuse(p, lis), p);
      const golden = truth.get(p.id)!;
      const { lines } = alignLines(
        p.tests.map((t) => t.value),
        golden.tests.map((t) => ({ value: t.printed ?? t.value, codes: t.codes })),
      );
      const lineTexts = p.tests.map((t) => t.value);
      let proposals = await Promise.all(lineTexts.map((text) => propose(text, scope, memory, index)));
      if (recording) {
        try {
          const out = await proposeDocument(lineTexts, { scope, insurer: null, language: "es" }, memory, index, undefined, {
            provider: unused,
            policy: "red",
            catalog,
            cacheDir: null,
            replay: (asked) => replayConsultation(recording, p.sha256, asked),
          });
          proposals = out.proposals;
          for (const [i, codes] of out.model) {
            model.asked += 1;
            if (!codes) continue;
            model.answered += 1;
            const right = lines[i]?.golden ? lines[i].truth : null;
            if (right && [...right].sort().join() === [...codes].sort().join()) model.right += 1;
          }
        } catch {
          model.missing += 1;
        }
      }
      for (const [i] of p.tests.entries()) {
        const proposal = proposals[i];
        tally[proposal.state] += 1;
        const right = lines[i]?.golden ? lines[i].truth : null;
        if (proposal.state === "green" && (!right || [...right].sort().join() !== [...proposal.codes!].sort().join())) wrongGreen += 1;
      }
    }
    const total = tally.green + tally.orange + tally.red;
    const pct = (n: number) => `${((100 * n) / total).toFixed(1)}%`.padStart(6);
    console.log(`${String(size).padStart(7)}  ${pct(tally.green)}  ${pct(tally.orange)}  ${pct(tally.red)}   ${String(wrongGreen).padStart(5)}        of ${total}`);
    if (recording) {
      console.log(
        `model: ${model.asked} red lines asked, ${model.answered} answered, ${model.right} of them right; ` +
          `${model.missing} documents with a line not recorded`,
      );
    }
  }
  db.$client.close();
}

async function main(): Promise<void> {
  const dir = option("history", "../data/synth/seed-42-n1000");
  const from = Number(option("from", "200"));
  const count = Number(option("count", "800"));
  const template = option("template", "../data/lis/seed-42.sqlite");
  const out = option("out", "../data/lis/seed-42-demo.sqlite");
  const goldens = await history(dir, from, count);

  const run = process.argv.includes("--measure") ? option("measure", "") : null;
  if (run) return measure(template, run, goldens, process.argv.includes("--replay") ? option("replay", "") : null);

  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await rm(path.resolve(out), { force: true });
  await copyFile(path.resolve(template), path.resolve(out));
  const db = await openLis(`file:${path.resolve(out)}`);
  const lines = await learn(new DbMemory(db), goldens);
  db.$client.close();
  console.log(`${out}: the template with ${lines} approved lines of ${goldens.length} earlier requests (${path.basename(dir)}, from ${from})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
