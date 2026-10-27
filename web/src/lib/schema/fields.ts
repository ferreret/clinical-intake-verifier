/**
 * Typed access to the repository-wide field configuration.
 *
 * `schema/fields.json` is the single source of truth shared with the Python package. Nothing
 * else in the web app may hard-code a field name: the prompt, the model-facing schema, the
 * boundary and the UI all go through this module.
 */
import fieldsJson from "../../../../schema/fields.json";

export type CompareMode = "exact" | "casefold" | "digits" | "alnum_upper" | "phone" | "person_name";
export type FieldType = "string" | "date" | "enum";

/** Where the LIS holds a field: `record.column`, the name columns joined as one name. */
export type LisSource =
  | "patient.name"
  | "patient.birth_date"
  | "patient.sex"
  | "patient.doc_id"
  | "patient.phone"
  | "physician.name"
  | "physician.colegiado"
  | "insurer.name";

export interface LisSpec {
  source: LisSource;
  /** How the document's value is compared with the LIS's, which may differ from `compare`. */
  compare: CompareMode;
}

/** How a normalised field may be printed, so that its value can be found on the page. */
export interface PrintedForms {
  /** A date's month names, January first, each with its spellings and abbreviations. */
  month_names?: string[][];
  /** The words an enum value may be printed as. */
  values?: Record<string, string[]>;
}

export interface FieldSpec {
  name: string;
  label: string;
  /** The label in Spanish, for the app in that language. */
  label_es: string;
  group: string;
  type: FieldType;
  required: boolean;
  /** Normalisation rule the model must apply, or null for text exactly as printed. */
  normalize: string | null;
  enum?: string[];
  compare: CompareMode;
  /** Regex the (normalised) value is expected to match, or null. */
  pattern: string | null;
  unique?: boolean;
  /** The LIS value the fusion engine compares this field with, or null when there is none. */
  lis: LisSpec | null;
  /**
   * The form the system of record keeps a value read from the document in, which the fusion
   * engine proposes: `digits`, the number alone ("22 años" → "22"). The reading stays exact.
   */
  stored_as?: "digits";
  /** System default, the lowest-priority source; null for none. */
  default: string | null;
  description: string;
  printed?: PrintedForms;
}

export interface TestsSpec {
  name: string;
  label: string;
  label_es: string;
  group: string;
  type: "array";
  item_type: "string";
  required: boolean;
  compare: CompareMode;
  match: "set";
  description: string;
}

interface FieldsConfig {
  version: number;
  compare_modes: Record<string, string>;
  fields: FieldSpec[];
  tests: TestsSpec;
}

const config = fieldsJson as unknown as FieldsConfig;

export const FIELDS_VERSION: number = config.version;
export const FIELDS: readonly FieldSpec[] = Object.freeze(
  config.fields.map((f) => Object.freeze({ ...f })),
);
export const FIELD_NAMES: readonly string[] = Object.freeze(FIELDS.map((f) => f.name));
export const TESTS: Readonly<TestsSpec> = Object.freeze({ ...config.tests });

const byName = new Map(FIELDS.map((f) => [f.name, f]));

export function isFieldName(name: string): boolean {
  return byName.has(name);
}

export function fieldSpec(name: string): FieldSpec {
  const spec = byName.get(name);
  if (!spec) throw new Error(`unknown field ${name}`);
  return spec;
}
