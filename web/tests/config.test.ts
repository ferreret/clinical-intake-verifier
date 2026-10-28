import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDir } from "@/lib/batches/config";

describe("data paths from the environment", () => {
  const before = process.env.APP_DATA_DIR;
  afterEach(() => {
    if (before === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = before;
  });

  it("reads a leading ~ as the home folder, not a folder inside the repository", () => {
    process.env.APP_DATA_DIR = "~/.clinical-intake-verifier";
    expect(dataDir()).toBe(path.join(os.homedir(), ".clinical-intake-verifier"));
  });

  it("resolves a relative path from the working directory", () => {
    process.env.APP_DATA_DIR = "../somewhere";
    expect(dataDir()).toBe(path.resolve(process.cwd(), "../somewhere"));
  });
});
