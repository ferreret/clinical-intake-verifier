import { describe, expect, it } from "vitest";

import type { ModelLine } from "@/lib/mapping/model";
import { replayConsultation, type RecordedMapping } from "@/lib/mapping/recorded";

const RECORDING: RecordedMapping = {
  recording_version: 1,
  provider: "gemini",
  model: "recorded-model",
  prompt_version: "1",
  recorded_at: "2026-10-28T00:00:00Z",
  documents: { abc: { latency_ms: 1200, lines: { glucosa: ["BQ0001"], hemograma: null } } },
};

const line = (id: string, text: string): ModelLine => ({ id, text, candidates: [] });

describe("recorded mapping replies", () => {
  it("answers each line asked from its own recorded answer, whichever lines are asked", () => {
    const c = replayConsultation(RECORDING, "abc", [line("L2", "GLUCOSA"), line("L5", "Hemograma")]);
    expect([...c.choices]).toEqual([
      ["L2", ["BQ0001"]],
      ["L5", null],
    ]);
    expect(c).toMatchObject({ cached: true, latencyMs: 1200 });
  });

  it("fails like an unreachable model when a line or the document was not recorded", () => {
    expect(() => replayConsultation(RECORDING, "abc", [line("L1", "Urea")])).toThrow("no recorded reply for this request");
    expect(() => replayConsultation(RECORDING, "zzz", [line("L1", "Glucosa")])).toThrow(/no recorded reply/);
  });
});
