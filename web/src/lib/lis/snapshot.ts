/**
 * The whole LIS read into memory, the form the fusion engine works on.
 */
import type { LisSnapshot } from "@/lib/fusion/types";

import type { LisDb } from "./db";
import { insurerAliases, insurers, patients, physicians } from "./schema";

export async function readSnapshot(db: LisDb): Promise<LisSnapshot> {
  const [p, m, i, a] = await Promise.all([
    db.select().from(patients),
    db.select().from(physicians),
    db.select().from(insurers),
    db.select().from(insurerAliases),
  ]);
  return {
    patients: p,
    physicians: m,
    insurers: i.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: a.filter((x) => x.insurerId === r.id).map((x) => x.alias),
    })),
  };
}
