/**
 * Opening the mock LIS and loading it from the generator's `lis.json`.
 */
import path from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "./schema";

export const LIS_VERSION = 1;

/** Resolved from the working directory, web/, like render.ts's fonts: also right once bundled. */
const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** The shape of `lis.json`, as `synth/src/intake_synth/generate/lis.py` writes it. */
export interface LisFile {
  lis_version: number;
  seed: number;
  patients: {
    id: string;
    first_name: string;
    last_name1: string;
    last_name2: string;
    sex: "H" | "M";
    birth_date: string;
    doc_id: string;
    phone: string;
  }[];
  physicians: {
    id: string;
    first_name: string;
    last_name1: string;
    last_name2: string;
    sex: "H" | "M";
    colegiado: string;
  }[];
  insurers: { id: string; name: string; aliases: string[] }[];
}

export type LisDb = Awaited<ReturnType<typeof openLis>>;

/** Opens the LIS at a libSQL URL (`file:…` or `:memory:`) and brings its schema up to date. */
export async function openLis(url: string) {
  const db = drizzle(createClient({ url }), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

/** Replaces every record with those of `data`, in one transaction. */
export async function loadLis(db: LisDb, data: LisFile): Promise<void> {
  if (data.lis_version !== LIS_VERSION) {
    throw new Error(`unsupported lis_version ${data.lis_version}; expected ${LIS_VERSION}`);
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.insurerAliases);
    await tx.delete(schema.insurers);
    await tx.delete(schema.physicians);
    await tx.delete(schema.patients);
    for (const p of data.patients) {
      await tx.insert(schema.patients).values({
        id: p.id,
        firstName: p.first_name,
        lastName1: p.last_name1,
        lastName2: p.last_name2,
        sex: p.sex,
        birthDate: p.birth_date,
        docId: p.doc_id,
        phone: p.phone,
      });
    }
    for (const m of data.physicians) {
      await tx.insert(schema.physicians).values({
        id: m.id,
        firstName: m.first_name,
        lastName1: m.last_name1,
        lastName2: m.last_name2,
        sex: m.sex,
        colegiado: m.colegiado,
      });
    }
    for (const i of data.insurers) {
      await tx.insert(schema.insurers).values({ id: i.id, name: i.name });
      for (const alias of i.aliases) {
        await tx.insert(schema.insurerAliases).values({ insurerId: i.id, alias });
      }
    }
  });
}
