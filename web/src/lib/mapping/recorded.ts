/**
 * The mapping model's recorded replies, which replay mode serves (docs/roadmap.md, F6).
 *
 * Which lines reach the model depends on the memory, and a sandbox's memory depends on the
 * order of the visitor's approvals; a reply recorded for one set of red lines would not
 * answer another. So the model was asked about every line of each demo document, with the
 * whole form as context, and its answer is kept per line: whichever lines are red when the
 * visitor's document is mapped, each finds its own. A line the recording does not have
 * makes the consultation fail, as a live model that cannot be reached does: the line stays
 * red and the decision log says why.
 */
import fs from "node:fs/promises";

import type { Consultation, ModelLine } from "./model";
import { textKey } from "./propose";

export const RECORDING_VERSION = 1 as const;

export interface RecordedMapping {
  recording_version: typeof RECORDING_VERSION;
  provider: "gemini" | "local";
  model: string;
  prompt_version: string;
  recorded_at: string;
  /** Per document, by the PDF's sha256: the model's latency, and each line's answer by its text key. */
  documents: Record<string, { latency_ms: number; lines: Record<string, string[] | null> }>;
}

const loaded = new Map<string, Promise<RecordedMapping | null>>();

/** The recording in `file`, read once; null when there is none (looked for again next time). */
export function loadRecordedMapping(file: string): Promise<RecordedMapping | null> {
  let r = loaded.get(file);
  if (!r) {
    r = fs.readFile(file, "utf8").then(
      (text) => JSON.parse(text) as RecordedMapping,
      () => {
        loaded.delete(file);
        return null;
      },
    );
    loaded.set(file, r);
  }
  return r;
}

/** The recorded answers for the lines asked about one document, as a consultation. */
export function replayConsultation(recording: RecordedMapping, sha256: string, lines: ModelLine[]): Consultation {
  const doc = recording.documents[sha256];
  const choices = new Map<string, string[] | null>();
  for (const line of lines) {
    const key = textKey(line.text);
    if (!doc || !(key in doc.lines)) {
      throw Object.assign(new Error("no recorded reply for this request"), { retryable: false });
    }
    choices.set(line.id, doc.lines[key]);
  }
  return { choices, usage: { inputTokens: null, outputTokens: null }, latencyMs: doc!.latency_ms, cached: true };
}
