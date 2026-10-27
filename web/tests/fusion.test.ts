import { describe, expect, it } from "vitest";

import { fuse } from "@/lib/fusion/fuse";
import type { FusedDocument, LisSnapshot } from "@/lib/fusion/types";
import { FIELD_NAMES } from "@/lib/schema/fields";
import type { Prediction, PredictionWarning } from "@/lib/schema/prediction";

const LIS: LisSnapshot = {
  patients: [
    {
      id: "P1",
      firstName: "María",
      lastName1: "García",
      lastName2: "López",
      sex: "M",
      birthDate: "03/02/1961",
      docId: "12345678Z",
      phone: "612345678",
    },
    {
      id: "P2",
      firstName: "Rosa",
      lastName1: "Vidal",
      lastName2: "Soler",
      sex: "M",
      birthDate: "14/09/1988",
      docId: "87654321X",
      phone: "600333444",
    },
    {
      id: "P3",
      firstName: "Rosa",
      lastName1: "Vidal",
      lastName2: "Soler",
      sex: "M",
      birthDate: "22/11/1950",
      docId: "11223344B",
      phone: "600555666",
    },
  ],
  physicians: [
    { id: "M1", firstName: "Pau", lastName1: "Roig", lastName2: "Mas", sex: "H", colegiado: "080812345" },
  ],
  insurers: [{ id: "A1", name: "Garbí Salut Mútua", aliases: ["GARBÍ SALUT MÚTUA", "Garbí Salut"] }],
};

const MARIA = {
  Paciente: "GARCÍA LÓPEZ, MARÍA",
  FechaNacimiento: "03/02/1961",
  Sexo: "M",
  DocumentoIdentidad: "12.345.678-Z",
  Telefono: "+34 612 345 678",
  NombreMedico: "Pau Roig Mas",
  NumeroColegiado: "08/08/12345",
  NumeroPeticion: "2601010001",
  NombreMutua: "Garbí Salut",
};

function prediction(values: Record<string, string>, warnings: PredictionWarning[] = []): Prediction {
  return {
    prediction_version: 1,
    id: "synth-000000",
    file: "synth-000000.pdf",
    sha256: "0".repeat(64),
    extractor: {
      model: "test",
      model_version: null,
      prompt_version: "4",
      input_mode: "pdf-inline",
      temperature: 0,
      thinking_level: null,
      attempts: 1,
      latency_ms: 0,
      usage: { input_tokens: null, output_tokens: null, thinking_tokens: null },
      created_at: "2026-10-23T00:00:00Z",
      error: null,
    },
    pages: [{ number: 1, width_pt: 595, height_pt: 842 }],
    fields: Object.fromEntries(
      FIELD_NAMES.map((n) => [n, n in values ? { value: values[n], page: 1, bbox: null } : null]),
    ),
    tests: [],
    warnings,
  };
}

function states(doc: FusedDocument): Record<string, string> {
  return Object.fromEntries(doc.fields.map((f) => [f.name, `${f.state}:${f.reason}`]));
}

const field = (doc: FusedDocument, name: string) => doc.fields.find((f) => f.name === name)!;

function without(values: Record<string, string>, ...names: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !names.includes(k)));
}

describe("fusion", () => {
  it("links a known patient and agrees across formats", () => {
    const doc = fuse(prediction(MARIA), LIS);
    expect(doc.links.patient).toMatchObject({ status: "linked", state: "green", recordId: "P1" });
    expect(doc.links.physician).toMatchObject({ status: "linked", recordId: "M1" });
    expect(doc.links.insurer).toMatchObject({ status: "linked", recordId: "A1" });
    const s = states(doc);
    for (const name of ["Paciente", "FechaNacimiento", "Sexo", "DocumentoIdentidad", "Telefono"]) {
      expect(s[name], name).toBe("green:agree");
    }
    expect(field(doc, "Telefono")).toMatchObject({ value: "612345678", source: "lis" });
    expect(s.NombreMutua).toBe("green:agree");
    expect(s.NumeroPeticion).toBe("orange:ai_only");
    expect(s.Edad).toBe("grey:absent_optional");
  });

  it("lets the LIS fill what the form leaves out", () => {
    expect(states(fuse(prediction(without(MARIA, "Telefono")), LIS)).Telefono).toBe("green:lis_only");
  });

  it("proposes no value where the document and the LIS disagree", () => {
    const doc = fuse(prediction({ ...MARIA, Telefono: "699 000 111" }), LIS);
    expect(field(doc, "Telefono")).toMatchObject({ state: "red", reason: "conflict", value: null });
    expect(field(doc, "Telefono").ai?.value).toBe("699 000 111");
    expect(field(doc, "Telefono").lis).toEqual({ value: "612345678", recordId: "P1", confirmed: true });
  });

  it("only offers a candidate when the identity document has a typo", () => {
    const doc = fuse(prediction({ ...MARIA, DocumentoIdentidad: "12345679Z" }), LIS);
    expect(doc.links.patient).toMatchObject({ status: "candidate", state: "red", recordId: "P1" });
    const s = states(doc);
    expect(s.DocumentoIdentidad).toBe("red:conflict");
    expect(s.FechaNacimiento).toBe("orange:candidate_agrees");
  });

  it("links on the identity document when the birth date has a typo", () => {
    const doc = fuse(prediction({ ...MARIA, FechaNacimiento: "04/02/1961" }), LIS);
    expect(doc.links.patient).toMatchObject({ status: "linked", recordId: "P1" });
    expect(states(doc).FechaNacimiento).toBe("red:conflict");
  });

  it("treats a patient the LIS does not know as AI only", () => {
    const doc = fuse(prediction({ ...MARIA, Paciente: "Joan Puig Serra", DocumentoIdentidad: "99887766K" }), LIS);
    expect(doc.links.patient).toMatchObject({ status: "none", state: "orange", recordId: null });
    expect(states(doc).Telefono).toBe("orange:ai_only");
  });

  it("tells namesakes apart by identity document, or offers the one with the birth date", () => {
    const rosa = { ...MARIA, Paciente: "Rosa Vidal Soler", FechaNacimiento: "22/11/1950", Telefono: "600555666" };
    const withDoc = fuse(prediction({ ...rosa, DocumentoIdentidad: "11223344B" }), LIS);
    expect(withDoc.links.patient).toMatchObject({ status: "linked", recordId: "P3" });
    const noDoc = fuse(prediction(without(rosa, "DocumentoIdentidad")), LIS);
    expect(noDoc.links.patient).toMatchObject({ status: "candidate", recordId: "P3" });
    const ambiguous = fuse(prediction(without(rosa, "DocumentoIdentidad", "FechaNacimiento")), LIS);
    expect(ambiguous.links.patient).toMatchObject({ status: "ambiguous", candidates: ["P2", "P3"] });
    expect(states(ambiguous).Telefono).toBe("orange:ai_only");
  });

  it("never links on the identity document alone", () => {
    const doc = fuse(prediction({ ...MARIA, Paciente: "Otra Persona Distinta", FechaNacimiento: "01/01/2000" }), LIS);
    expect(doc.links.patient).toMatchObject({ status: "candidate", state: "red" });
  });

  it("proposes an age read with its unit as the number alone, keeping the reading exact", () => {
    const age = (read: string) => fuse(prediction({ ...MARIA, Edad: read }), LIS).fields.find((f) => f.name === "Edad")!;
    expect(age("22 anys")).toMatchObject({ value: "22", source: "ai", ai: { value: "22 anys" } });
    expect(age("64 años").value).toBe("64");
    expect(age("sesenta").value).toBe("sesenta");
  });

  it("marks a doubtful AI-only value red", () => {
    const w: PredictionWarning = { code: "garbled_text", field: "NumeroPeticion", detail: "x" };
    expect(states(fuse(prediction(MARIA, [w]), LIS)).NumeroPeticion).toBe("red:ai_only_doubtful");
  });

  it("reports missing required fields red and absent optional ones grey", () => {
    const s = states(fuse(prediction({}), LIS));
    expect(s.Paciente).toBe("red:missing_required");
    expect(s.NumeroTarjeta).toBe("grey:absent_optional");
  });

  it("knows unknown physicians and unregistered insurers", () => {
    const doc = fuse(prediction({ ...MARIA, NombreMedico: "Anna Ferrer Bosch", NumeroColegiado: "999", NombreMutua: "Otra Mútua" }), LIS);
    expect(doc.links.physician.status).toBe("none");
    expect(doc.links.insurer).toMatchObject({ status: "none", reason: expect.stringContaining("not registered") });
    expect(states(doc).NombreMutua).toBe("orange:ai_only");
  });

  it("ignores the fields of a failed extraction", () => {
    const p = prediction(MARIA);
    p.extractor.error = { code: "api_error", message: "quota" };
    const doc = fuse(p, LIS);
    expect(doc.extractor_error).toBe("api_error");
    expect(doc.links.patient.status).toBe("none");
    expect(states(doc).Paciente).toBe("red:missing_required");
  });
});
