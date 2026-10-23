/**
 * Loads a generated dataset's lab records into a SQLite file: the LIS (`lis.json`) and the
 * test catalog (`catalog.json`).
 *
 *   npm run seed-lis -- [dataset dir] [database]
 *
 * Defaults: ../data/synth/seed-42 into ../data/lis/<dataset dir name>.sqlite. The database is
 * created if missing and its LIS and catalog replaced; approved mappings are kept. Both live
 * under data/, outside version control.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { count } from "drizzle-orm";

import { loadLis, openLis, type LisFile } from "@/lib/lis/db";
import { insurers, patients, physicians } from "@/lib/lis/schema";
import { loadCatalog, type CatalogFile } from "@/lib/mapping/catalog";
import { catalogProfiles, catalogTests } from "@/lib/mapping/schema";

async function main(): Promise<void> {
  const [source = "../data/synth/seed-42", given] = process.argv.slice(2);
  const target = given ?? path.join("..", "data", "lis", `${path.basename(path.resolve(source))}.sqlite`);
  const read = async <T>(name: string) => JSON.parse(await readFile(path.join(source, name), "utf-8")) as T;
  const lis = await read<LisFile>("lis.json");
  const catalog = await read<CatalogFile>("catalog.json");
  await mkdir(path.dirname(path.resolve(target)), { recursive: true });
  const db = await openLis(`file:${path.resolve(target)}`);
  await loadLis(db, lis);
  await loadCatalog(db, catalog);
  const [[p], [m], [i], [t], [pr]] = await Promise.all([
    db.select({ n: count() }).from(patients),
    db.select({ n: count() }).from(physicians),
    db.select({ n: count() }).from(insurers),
    db.select({ n: count() }).from(catalogTests),
    db.select({ n: count() }).from(catalogProfiles),
  ]);
  console.log(
    `${target}: ${p.n} patients, ${m.n} physicians, ${i.n} insurers, ` +
      `${t.n} catalog tests, ${pr.n} profiles (seed ${lis.seed})`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
