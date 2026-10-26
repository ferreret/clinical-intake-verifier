import { describe, expect, it } from "vitest";
import { buildSystemInstruction, PROMPT_VERSION } from "@/lib/extractor/prompt";
import { QWEN_BOXES } from "@/lib/extractor/response-schema";
import { FIELD_NAMES } from "@/lib/schema/fields";

describe("system instruction", () => {
  it("is versioned", () => {
    expect(PROMPT_VERSION).toMatch(/^\d+$/);
  });

  it("names every configured field", () => {
    const text = buildSystemInstruction();
    for (const name of FIELD_NAMES) expect(text).toContain(`- ${name}:`);
  });

  it("states the box convention, the null rule and the normalisations", () => {
    const text = buildSystemInstruction();
    expect(text).toContain("[ymin, xmin, ymax, xmax]");
    expect(text).toContain("0-1000");
    expect(text).toContain("return null");
    expect(text).toContain("dd/mm/yyyy");
    expect(text).toContain("H (male), M (female) or U");
    expect(text).toContain("on a photocopied identity card");
    expect(text).toContain("return only the name and surnames");
  });

  it("asks a model with another box convention in its own", () => {
    const text = buildSystemInstruction(QWEN_BOXES);
    expect(text).toContain("bbox_2d is [xmin, ymin, xmax, ymax] on a 0-1000 scale");
    expect(text).not.toMatch(/\bbox_2d|ymin, xmin/);
    expect(text.replaceAll("bbox_2d", "box_2d").replace("[xmin, ymin, xmax, ymax]", "[ymin, xmin, ymax, xmax]")).toBe(
      buildSystemInstruction(),
    );
  });
});
