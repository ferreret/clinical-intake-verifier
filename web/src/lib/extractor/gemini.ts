/**
 * The single place that talks to the Gemini API.
 *
 * Sends the PDF inline with the system instruction and the layer-1 schema, returns the raw text
 * and usage. Parsing, validation and normalisation happen elsewhere: this module knows nothing
 * about fields.
 */
import { GoogleGenAI, type GenerateContentConfig, type ThinkingLevel } from "@google/genai";
import type { Usage } from "@/lib/schema/prediction";

export interface GeminiRequest {
  apiKey: string;
  model: string;
  pdf: Uint8Array;
  systemInstruction: string;
  userMessage: string;
  responseSchema: Record<string, unknown>;
  temperature: number;
  /** minimal, low, medium, high; null to leave the model default. */
  thinkingLevel: string | null;
}

export interface GeminiReply {
  text: string;
  modelVersion: string | null;
  usage: Usage;
}

export class GeminiApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
  }

  /** Quota, overload and transport failures are worth one more try; client errors are not. */
  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const s = (err as { status?: unknown; code?: unknown }).status ?? (err as { code?: unknown }).code;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function callGemini(req: GeminiRequest): Promise<GeminiReply> {
  const ai = new GoogleGenAI({ apiKey: req.apiKey });
  const config: GenerateContentConfig = {
    systemInstruction: req.systemInstruction,
    temperature: req.temperature,
    responseMimeType: "application/json",
    responseJsonSchema: req.responseSchema,
  };
  if (req.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: req.thinkingLevel.toUpperCase() as ThinkingLevel };
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: req.model,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: Buffer.from(req.pdf).toString("base64"),
              },
            },
            { text: req.userMessage },
          ],
        },
      ],
      config,
    });
  } catch (err) {
    throw new GeminiApiError(messageOf(err), statusOf(err));
  }

  const text = response.text;
  if (typeof text !== "string" || text.length === 0) {
    const finish = response.candidates?.[0]?.finishReason ?? "unknown";
    const blocked = response.promptFeedback?.blockReason;
    throw new GeminiApiError(
      `empty response (finishReason=${finish}${blocked ? `, blockReason=${blocked}` : ""})`,
    );
  }
  const u = response.usageMetadata;
  return {
    text,
    modelVersion: response.modelVersion ?? null,
    usage: {
      input_tokens: u?.promptTokenCount ?? null,
      output_tokens: u?.candidatesTokenCount ?? null,
      thinking_tokens: u?.thoughtsTokenCount ?? null,
    },
  };
}
