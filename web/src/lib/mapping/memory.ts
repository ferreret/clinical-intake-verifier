/**
 * The memory of approved mappings: what technicians approved a line of an insurer to mean.
 *
 * Two implementations of one interface: in the database for the product, in memory for the
 * learning-curve simulation, which replays a thousand requests in a few seconds.
 */
import { and, eq, ne } from "drizzle-orm";

import type { LisDb } from "@/lib/lis/db";

import { mappingMemory } from "./schema";

export interface MemoryEntry {
  codes: string[];
  active: number;
  passive: number;
  corrections: number;
}

export type ApprovalKind = "active" | "passive";

export interface MappingMemory {
  /** What this insurer's approved requests say the line means. */
  lookup(scope: string, textKey: string): Promise<MemoryEntry[]>;
  /** The same line as other insurers' approved requests mean it, merged. */
  elsewhere(scope: string, textKey: string): Promise<MemoryEntry[]>;
  /** An approved request said the line means `codes`. */
  approve(scope: string, textKey: string, codes: string[], kind: ApprovalKind): Promise<void>;
  /** `codes` were proposed for the line and the technician replaced them. */
  correct(scope: string, textKey: string, codes: string[]): Promise<void>;
}

const key = (codes: string[]) => [...codes].sort().join(",");

export class InMemoryMemory implements MappingMemory {
  private readonly rows = new Map<string, Map<string, Map<string, MemoryEntry>>>();

  private entry(scope: string, textKey: string, codes: string[]): MemoryEntry {
    const byText = this.rows.get(scope) ?? new Map<string, Map<string, MemoryEntry>>();
    this.rows.set(scope, byText);
    const byCodes = byText.get(textKey) ?? new Map<string, MemoryEntry>();
    byText.set(textKey, byCodes);
    const k = key(codes);
    const e = byCodes.get(k) ?? { codes: k.split(","), active: 0, passive: 0, corrections: 0 };
    byCodes.set(k, e);
    return e;
  }

  async lookup(scope: string, textKey: string): Promise<MemoryEntry[]> {
    return [...(this.rows.get(scope)?.get(textKey)?.values() ?? [])].map((e) => ({ ...e }));
  }

  async elsewhere(scope: string, textKey: string): Promise<MemoryEntry[]> {
    const merged = new Map<string, MemoryEntry>();
    for (const [s, byText] of this.rows) {
      if (s === scope) continue;
      for (const e of byText.get(textKey)?.values() ?? []) {
        const m = merged.get(key(e.codes)) ?? { codes: e.codes, active: 0, passive: 0, corrections: 0 };
        merged.set(key(e.codes), {
          codes: m.codes,
          active: m.active + e.active,
          passive: m.passive + e.passive,
          corrections: m.corrections + e.corrections,
        });
      }
    }
    return [...merged.values()];
  }

  async approve(scope: string, textKey: string, codes: string[], kind: ApprovalKind): Promise<void> {
    this.entry(scope, textKey, codes)[kind] += 1;
  }

  async correct(scope: string, textKey: string, codes: string[]): Promise<void> {
    this.entry(scope, textKey, codes).corrections += 1;
  }
}

export class DbMemory implements MappingMemory {
  constructor(private readonly db: LisDb) {}

  private static entry(r: typeof mappingMemory.$inferSelect): MemoryEntry {
    return { codes: r.codes.split(","), active: r.active, passive: r.passive, corrections: r.corrections };
  }

  async lookup(scope: string, textKey: string): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(mappingMemory)
      .where(and(eq(mappingMemory.scope, scope), eq(mappingMemory.textKey, textKey)));
    return rows.map(DbMemory.entry);
  }

  async elsewhere(scope: string, textKey: string): Promise<MemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(mappingMemory)
      .where(and(ne(mappingMemory.scope, scope), eq(mappingMemory.textKey, textKey)));
    const merged = new Map<string, MemoryEntry>();
    for (const e of rows.map(DbMemory.entry)) {
      const m = merged.get(key(e.codes));
      merged.set(
        key(e.codes),
        m
          ? { ...m, active: m.active + e.active, passive: m.passive + e.passive, corrections: m.corrections + e.corrections }
          : e,
      );
    }
    return [...merged.values()];
  }

  private async bump(scope: string, textKey: string, codes: string[], column: "active" | "passive" | "corrections") {
    const row = { scope, textKey, codes: key(codes), updatedAt: new Date().toISOString() };
    const [existing] = await this.db
      .select()
      .from(mappingMemory)
      .where(and(eq(mappingMemory.scope, scope), eq(mappingMemory.textKey, textKey), eq(mappingMemory.codes, row.codes)));
    if (!existing) {
      await this.db.insert(mappingMemory).values({ ...row, [column]: 1 });
      return;
    }
    await this.db
      .update(mappingMemory)
      .set({ [column]: existing[column] + 1, updatedAt: row.updatedAt })
      .where(and(eq(mappingMemory.scope, scope), eq(mappingMemory.textKey, textKey), eq(mappingMemory.codes, row.codes)));
  }

  async approve(scope: string, textKey: string, codes: string[], kind: ApprovalKind): Promise<void> {
    await this.bump(scope, textKey, codes, kind);
  }

  async correct(scope: string, textKey: string, codes: string[]): Promise<void> {
    await this.bump(scope, textKey, codes, "corrections");
  }
}
