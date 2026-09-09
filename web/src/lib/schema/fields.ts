/**
 * Typed access to the repository-wide field configuration.
 *
 * `schema/fields.json` is the single source of truth shared with the Python package. Nothing
 * else in the web app may hard-code a field name: the prompt, the model-facing schema, the
 * boundary and the UI all go through this module.
 */
import fieldsJson from "../../../../schema/fields.json";

export type CompareMode = "exact" | "casefold" | "digits" | "alnum_upper";
export type FieldType = "string" | "date" | "enum";

export interface FieldSpec {
  name: string;
  label: string;
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
  description: string;
}

export interface TestsSpec {
  name: string;
  label: string;
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
