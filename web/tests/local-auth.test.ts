import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { callLocal, LocalModelError } from "@/lib/extractor/local";
import { LocalProvider } from "@/lib/mapping/model";

/** A stand-in for LM Studio's server: records each request's Authorization header. */
let server: http.Server;
let baseUrl: string;
let required: string | null = null;
const seen: (string | undefined)[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push(req.headers.authorization);
      res.setHeader("Content-Type", "application/json");
      if (required !== null && req.headers.authorization !== `Bearer ${required}`) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: { message: "An LM Studio API token is required", code: "invalid_api_key" } }));
        return;
      }
      res.end(JSON.stringify({ model: "qwen/test", choices: [{ message: { content: '{"ok": true}' } }], usage: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  vi.unstubAllEnvs();
  required = null;
  seen.length = 0;
});

const request = () => ({ baseUrl, model: "qwen/test", pages: [], systemInstruction: "", userMessage: "hi", temperature: 0 });

describe("the token for a local model server that requires one", () => {
  it("is not sent when LOCAL_LLM_TOKEN is not set", async () => {
    vi.stubEnv("LOCAL_LLM_TOKEN", "");
    await callLocal(request());
    await new LocalProvider("qwen/test", baseUrl).complete("system", "user", {});
    expect(seen).toEqual([undefined, undefined]);
  });

  it("is sent as a bearer token by the extractor and by test mapping", async () => {
    vi.stubEnv("LOCAL_LLM_TOKEN", " sk-lm-test:secret ");
    required = "sk-lm-test:secret";
    const reply = await callLocal(request());
    const mapped = await new LocalProvider("qwen/test", baseUrl).complete("system", "user", {});
    expect(reply.text).toBe('{"ok": true}');
    expect(mapped.text).toBe('{"ok": true}');
    expect(seen).toEqual(["Bearer sk-lm-test:secret", "Bearer sk-lm-test:secret"]);
  });

  it("is named in the error when the server refuses the request, which is not retried", async () => {
    vi.stubEnv("LOCAL_LLM_TOKEN", "");
    required = "sk-lm-test:secret";
    const err = await callLocal(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalModelError);
    expect((err as LocalModelError).status).toBe(401);
    expect((err as LocalModelError).retryable).toBe(false);
    expect((err as Error).message).toContain("set LOCAL_LLM_TOKEN");
    await expect(new LocalProvider("qwen/test", baseUrl).complete("s", "u", {})).rejects.toThrow("set LOCAL_LLM_TOKEN");
  });
});
