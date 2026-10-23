import fs from "node:fs/promises";

/** Minimal .env loader: KEY=VALUE lines, comments ignored, existing variables win. */
export async function loadDotEnv(file: string): Promise<void> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
