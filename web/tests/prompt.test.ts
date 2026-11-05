import { describe, expect, it } from "vitest";
import { buildSystemInstruction, PROMPT_VERSION } from "@/lib/extractor/prompt";
import { buildTextInstruction, PROMPT_VERSION_TEXT } from "@/lib/extractor/prompt-text";
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

describe("text instruction", () => {
  it("is versioned apart, with a t", () => {
    expect(PROMPT_VERSION_TEXT).toMatch(/^t\d+$/);
  });

  it("asks for the same fields with the same rules as the image prompt, without what they say of the box", () => {
    const text = buildTextInstruction();
    const image = buildSystemInstruction();
    for (const name of FIELD_NAMES) {
      const line = image.split("\n").find((l) => l.startsWith(`- ${name}:`))!;
      expect(text).toContain(line.replace(" The box still covers the whole printed name, title included.", ""));
    }
    expect(text).toContain("return only the name and surnames, otherwise exactly as printed.\n");
    expect(text).toContain("on a photocopied identity card");
  });

  it("describes the numbered lines and the checkbox tokens, and asks for a line instead of a box", () => {
    const text = buildTextInstruction();
    expect(text).toContain("[pN] Lk: text");
    expect(text).toContain("starts with [X] if it is ticked and [ ] if it is empty");
    expect(text).toContain("return null for its value, page and line");
    expect(text).toContain("Pre-printed tests whose checkbox is not ticked are not requested.");
    // "box" is left only where the form has one: "share a box, a border".
    expect(text).not.toMatch(/box_2d|0-1000|The box|tight around/);
  });
});
