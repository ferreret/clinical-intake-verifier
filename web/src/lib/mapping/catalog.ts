/**
 * The lab's test catalog: loading it from the generator's `catalog.json` and reading it back.
 */
import type { LisDb } from "@/lib/lis/db";

import { catalogProfileCodes, catalogProfiles, catalogSynonyms, catalogTests } from "./schema";

export const CATALOG_VERSION = 2;

/** The shape of `catalog.json`, as `synth/src/intake_synth/generate/labcatalog.py` writes it. */
export interface CatalogFile {
  catalog_version: number;
  tests: {
    code: string;
    name: string;
    section: string;
    analyte: string;
    synonyms: string[];
    specimen: string | null;
    default_specimen: boolean;
    variant: string | null;
  }[];
  profiles: { id: string; name: string; codes: string[] }[];
  specimens: Record<string, string>;
}

export interface CatalogTest {
  code: string;
  name: string;
  analyte: string;
  synonyms: string[];
  /** Specimen as the lab writes it ("suero"), or null when it is part of the test. */
  specimen: string | null;
  defaultSpecimen: boolean;
  variant: string | null;
}

export interface CatalogProfile {
  id: string;
  name: string;
  codes: string[];
}

export interface Catalog {
  tests: CatalogTest[];
  profiles: CatalogProfile[];
}

/** Replaces the catalog with `data`, in one transaction. */
export async function loadCatalog(db: LisDb, data: CatalogFile): Promise<void> {
  if (data.catalog_version !== CATALOG_VERSION) {
    throw new Error(`unsupported catalog_version ${data.catalog_version}; expected ${CATALOG_VERSION}`);
  }
  await db.transaction(async (tx) => {
    await tx.delete(catalogProfileCodes);
    await tx.delete(catalogProfiles);
    await tx.delete(catalogSynonyms);
    await tx.delete(catalogTests);
    for (const t of data.tests) {
      await tx.insert(catalogTests).values({
        code: t.code,
        name: t.name,
        section: t.section,
        analyte: t.analyte,
        specimen: t.specimen === null ? null : data.specimens[t.specimen],
        defaultSpecimen: t.default_specimen,
        variant: t.variant,
      });
      for (const name of new Set(t.synonyms)) await tx.insert(catalogSynonyms).values({ code: t.code, name });
    }
    for (const p of data.profiles) {
      await tx.insert(catalogProfiles).values({ id: p.id, name: p.name });
      for (const [position, code] of p.codes.entries()) {
        await tx.insert(catalogProfileCodes).values({ profileId: p.id, code, position });
      }
    }
  });
}

export async function readCatalog(db: LisDb): Promise<Catalog> {
  const [tests, synonyms, profiles, profileCodes] = await Promise.all([
    db.select().from(catalogTests),
    db.select().from(catalogSynonyms),
    db.select().from(catalogProfiles),
    db.select().from(catalogProfileCodes),
  ]);
  const syn = new Map<string, string[]>();
  for (const s of synonyms) syn.set(s.code, [...(syn.get(s.code) ?? []), s.name]);
  return {
    tests: tests.map((t) => ({
      code: t.code,
      name: t.name,
      analyte: t.analyte,
      synonyms: syn.get(t.code) ?? [],
      specimen: t.specimen,
      defaultSpecimen: t.defaultSpecimen,
      variant: t.variant,
    })),
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      codes: profileCodes
        .filter((c) => c.profileId === p.id)
        .sort((a, b) => a.position - b.position)
        .map((c) => c.code),
    })),
  };
}
