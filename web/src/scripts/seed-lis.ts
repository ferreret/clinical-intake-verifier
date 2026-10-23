/**
 * Loads the generator's `lis.json` into a SQLite file:
 *
 *   npm run seed-lis -- [lis.json] [database]
 *
 * Defaults: ../data/synth/seed-42/lis.json into ../data/lis/seed-42.sqlite. The database is
 * created if missing and its records replaced. Both live under data/, outside version control.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { count } from "drizzle-orm";

import { loadLis, openLis, type LisFile } from "@/lib/lis/db";
import { insurers, patients, physicians } from "@/lib/lis/schema";

async function main(): Promise<void> {
  const [source = "../data/synth/seed-42/lis.json", target = "../data/lis/seed-42.sqlite"] =
    process.argv.slice(2);
  const data = JSON.parse(await readFile(source, "utf-8")) as LisFile;
  await mkdir(path.dirname(path.resolve(target)), { recursive: true });
  const db = await openLis(`file:${path.resolve(target)}`);
  await loadLis(db, data);
  const [[p], [m], [i]] = await Promise.all([
    db.select({ n: count() }).from(patients),
    db.select({ n: count() }).from(physicians),
    db.select({ n: count() }).from(insurers),
  ]);
  console.log(`${target}: ${p.n} patients, ${m.n} physicians, ${i.n} insurers (seed ${data.seed})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
