import { describe, expect, it } from "vitest";

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
