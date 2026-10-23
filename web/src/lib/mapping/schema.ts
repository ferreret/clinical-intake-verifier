/**
 * The lab's test catalog and the memory of approved mappings, next to the LIS tables.
 *
 * The catalog comes from the generator's `catalog.json` and is read-only here. The memory is
 * the product's own state: what technicians approved a line of a given insurer to mean. Only
 * approved requests write to it, never a proposal on its own.
 */
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const catalogTests = sqliteTable("catalog_tests", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  analyte: text("analyte").notNull(),
  specimen: text("specimen"),
  /** The analyte's usual specimen, which forms often leave unwritten. */
  defaultSpecimen: integer("default_specimen", { mode: "boolean" }).notNull(),
  variant: text("variant"),
});

export const catalogSynonyms = sqliteTable(
  "catalog_synonyms",
  {
    code: text("code")
      .notNull()
      .references(() => catalogTests.code),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.name] })],
);

export const catalogProfiles = sqliteTable("catalog_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const catalogProfileCodes = sqliteTable(
  "catalog_profile_codes",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => catalogProfiles.id),
    code: text("code")
      .notNull()
      .references(() => catalogTests.code),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.code] })],
);

/**
 * What approved requests say a line means, per insurer. `active` counts approvals where the
 * technician acted (confirmed a suggestion or chose the codes); `passive` those of a line
 * already shown green, which may be trust in the colour rather than a check; `corrections`
 * the times this meaning was proposed and replaced by another.
 */
export const mappingMemory = sqliteTable(
  "mapping_memory",
  {
    /** The LIS insurer id, `name:<insurer as printed>` for an unregistered one, or `none`. */
    scope: text("scope").notNull(),
    /** The line as compared: casefold of the printed text. */
    textKey: text("text_key").notNull(),
    /** The codes it means, sorted and comma-separated. */
    codes: text("codes").notNull(),
    active: integer("active").notNull().default(0),
    passive: integer("passive").notNull().default(0),
    corrections: integer("corrections").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.textKey, t.codes] })],
);
