/**
 * Semantic search in the catalog with a local multilingual sentence-embedding model.
 *
 * The model runs in Node through transformers.js (ONNX weights, downloaded once into
 * `data/models`); nothing leaves the machine and the same text always gets the same vector.
 * Vectors are cached on disk by text, so the catalog is embedded once per model.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

import type { Catalog } from "./catalog";
import { CatalogIndex, catalogEntries, rank, type Candidate, type CatalogEntry, type Searcher } from "./search";

/** Multilingual (Spanish and Catalan among its languages), 384 dimensions, about 120 MB. */
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
const DTYPE = "q8";
const BATCH = 64;

/** E5 models are trained with these prefixes: a short query against longer passages. */
type Role = "query" | "passage";

export class Embedder {
  private readonly cache = new Map<string, Float32Array>();
  private dirty = false;

  private constructor(
    private readonly extract: FeatureExtractionPipeline,
    private readonly cacheFile: string,
  ) {}

  /** Loads the model (downloading it into `modelDir` the first time) and the vector cache. */
  static async open(modelDir: string, cacheDir: string): Promise<Embedder> {
    env.cacheDir = modelDir;
    const extract = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: DTYPE });
    const cacheFile = path.join(cacheDir, `${EMBEDDING_MODEL.replace(/\W+/g, "_")}-${DTYPE}.json`);
    const embedder = new Embedder(extract, cacheFile);
    try {
      const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Record<string, string>;
      for (const [k, b64] of Object.entries(stored)) {
        const buf = Buffer.from(b64, "base64");
        embedder.cache.set(k, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
      }
    } catch {
      // No cache yet.
    }
    return embedder;
  }

  private static key(role: Role, text: string): string {
    return createHash("sha256").update(`${role}: ${text}`).digest("hex").slice(0, 32);
  }

  /** Unit vectors for `texts`, from the cache where possible. */
  async embed(texts: string[], role: Role): Promise<Float32Array[]> {
    const missing = [...new Set(texts.filter((t) => !this.cache.has(Embedder.key(role, t))))];
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const out = await this.extract(
        batch.map((t) => `${role}: ${t}`),
        { pooling: "mean", normalize: true },
      );
      const [n, dims] = out.dims as [number, number];
      const data = out.data as Float32Array;
      for (let j = 0; j < n; j++) {
        this.cache.set(Embedder.key(role, batch[j]), data.slice(j * dims, (j + 1) * dims));
      }
      this.dirty = true;
    }
    return texts.map((t) => this.cache.get(Embedder.key(role, t))!);
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    const out: Record<string, string> = {};
    for (const [k, v] of this.cache) out[k] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
    await fs.writeFile(this.cacheFile, JSON.stringify(out));
    this.dirty = false;
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Ranks the catalog by cosine similarity: each entry scores its closest form. */
export class EmbeddingSearch implements Searcher {
  private constructor(
    readonly entries: CatalogEntry[],
    private readonly vectors: Float32Array[][],
    private readonly embedder: Embedder,
  ) {}

  static async build(catalog: Catalog, embedder: Embedder): Promise<EmbeddingSearch> {
    const entries = catalogEntries(catalog);
    const flat = await embedder.embed(entries.flatMap((e) => e.forms), "passage");
    let i = 0;
    const vectors = entries.map((e) => e.forms.map(() => flat[i++]));
    return new EmbeddingSearch(entries, vectors, embedder);
  }

  async scores(text: string): Promise<number[]> {
    const [q] = await this.embedder.embed([text], "query");
    return this.vectors.map((forms) => Math.max(...forms.map((v) => dot(q, v))));
  }

  async search(text: string, k = 20): Promise<Candidate[]> {
    return rank(this.entries, await this.scores(text), k);
  }
}

/** The mean of the trigram and the embedding score: spelling and meaning together. */
export class HybridSearch implements Searcher {
  constructor(
    private readonly lexical: CatalogIndex,
    private readonly semantic: EmbeddingSearch,
  ) {
    if (lexical.entries.length !== semantic.entries.length) throw new Error("searches over different catalogs");
  }

  async scores(text: string): Promise<number[]> {
    const lex = this.lexical.scores(text);
    const sem = await this.semantic.scores(text);
    return lex.map((s, i) => (s + sem[i]) / 2);
  }

  async search(text: string, k = 20): Promise<Candidate[]> {
    return rank(this.lexical.entries, await this.scores(text), k);
  }
}
