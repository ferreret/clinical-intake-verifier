import { describe, expect, it } from "vitest";

import { hideModels, providerOf } from "@/app/_ui/api";
import { pickLang } from "@/app/_ui/lang";
import { es } from "@/app/_ui/messages/es";
import { FIELDS, TESTS } from "@/lib/schema/fields";

describe("the app's language", () => {
  it("follows the visitor's choice, else the browser's, else English", () => {
    expect(pickLang("es", "en-GB,en")).toBe("es");
    expect(pickLang(undefined, "ca-ES,ca;q=0.9,en;q=0.5")).toBe("es");
    expect(pickLang(undefined, "de-DE,en;q=0.8")).toBe("en");
    expect(pickLang("fr", null)).toBe("en");
  });

  it("has a Spanish label for every field", () => {
    for (const f of FIELDS) expect(f.label_es, f.name).toBeTruthy();
    expect(TESTS.label_es).toBe("Pruebas solicitadas");
  });

  it("translates the server's explanations, clause by clause, and leaves unknown ones as they are", () => {
    expect(es.server("name and birth date match one record; there is no identity document on the form")).toBe(
      "el nombre y la fecha de nacimiento coinciden con un registro; el volante no trae documento de identidad",
    );
    expect(es.server("approved 1 time(s) for this insurer, corrected 2 times")).toBe("aprobada 1 vez para esta mutua, corregida 2 veces");
    expect(es.server("44498315P · born 04/01/1989")).toBe("44498315P · nacido/a el 04/01/1989");
    expect(es.verify.closed("the document is approved, not awaiting verification")).toBe(
      "el documento está aprobado, no pendiente de verificación",
    );
    expect(es.server("something new")).toBe("something new");
  });
});

describe("errors as the screens show them", () => {
  it("never name a model's make", () => {
    const shown = [
      "GEMINI_API_KEY is not set (put it in web/.env.local)",
      "empty Gemini reply (MAX_TOKENS)",
      "[GoogleGenerativeAI Error]: models/gemini-3.8-flash is not found",
      'local model: HTTP 400 {"error":"model qwen/qwen3.6-35b-a3b not loaded"}',
      "LM Studio is not running",
    ].map(hideModels);
    for (const text of shown) expect(text).not.toMatch(/gemini|qwen|google|lm studio/i);
    expect(shown[0]).toBe("the cloud model's key is not set (put it in web/.env.local)");
  });
  it("name a recorded model by where it runs", () => {
    expect(providerOf("models/gemini-3.8-flash")).toBe("gemini");
    expect(providerOf("qwen/qwen3.6-35b-a3b")).toBe("local");
  });
});

describe("the server's refusals in Spanish", () => {
  it("translates why a document cannot be approved, and the other refusals the screens show", () => {
    expect(es.server("line 2 (Hemograma) has no codes")).toBe("la línea 2 (Hemograma) no tiene códigos");
    expect(es.server("line 1 (Glucosa) is orange: change or confirm it")).toBe("la línea 1 (Glucosa) está en naranja: cámbiala o confírmala");
    expect(es.server("FechaNacimiento is not in its form: 31/02/1990")).toBe("Fecha de nacimiento: «31/02/1990» no tiene la forma del campo");
    expect(es.server("the document is not in verification by you")).toBe("el documento no está en verificación a tu nombre");
    expect(es.server("no proposal yet; the document is extracting")).toMatch(/^aún no hay propuesta: el documento está /);
  });
});
