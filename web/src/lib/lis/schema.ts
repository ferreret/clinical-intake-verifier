/**
 * The mock LIS: the lab's own records of patients, physicians and insurers.
 *
 * This file is the only definition of its tables; `drizzle/` holds the migrations generated
 * from it (`npx drizzle-kit generate`). The records come from the synthetic generator's
 * `lis.json` (see `src/scripts/seed-lis.ts`). Every person and insurer in it is invented.
 */
import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const patients = sqliteTable(
  "patients",
  {
    id: text("id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName1: text("last_name1").notNull(),
    lastName2: text("last_name2").notNull(),
    sex: text("sex", { enum: ["H", "M"] }).notNull(),
    /** dd/mm/yyyy, the form `fields.json` normalises FechaNacimiento to. */
    birthDate: text("birth_date").notNull(),
    /** DNI or NIE, unformatted ("12345678Z"). */
    docId: text("doc_id").notNull().unique(),
    /** Nine digits, no prefix. */
    phone: text("phone"),
  },
  (t) => [index("patients_name").on(t.lastName1, t.lastName2, t.firstName)],
);

export const physicians = sqliteTable("physicians", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName1: text("last_name1").notNull(),
  lastName2: text("last_name2").notNull(),
  sex: text("sex", { enum: ["H", "M"] }).notNull(),
  /** Medical college registration number, nine digits. */
  colegiado: text("colegiado").notNull().unique(),
});

export const insurers = sqliteTable("insurers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

/** Other names the lab keeps an insurer under. */
export const insurerAliases = sqliteTable(
  "insurer_aliases",
  {
    insurerId: text("insurer_id")
      .notNull()
      .references(() => insurers.id),
    alias: text("alias").notNull(),
  },
  (t) => [primaryKey({ columns: [t.insurerId, t.alias] })],
);
