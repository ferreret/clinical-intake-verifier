/**
 * Opening the mock LIS and loading it from the generator's `lis.json`.
 */
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";

import { createClient, type Client, type Transaction } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import * as schema from "./schema";

export const LIS_VERSION = 1;

/** Resolved from the working directory, web/, like render.ts's fonts: also right once bundled. */
const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** The shape of `lis.json`, as `synth/src/intake_synth/generate/lis.py` writes it. */
export interface LisFile {
  lis_version: number;
  seed: number;
  patients: {
    id: string;
    first_name: string;
    last_name1: string;
    last_name2: string;
    sex: "H" | "M";
    birth_date: string;
    doc_id: string;
    phone: string;
  }[];
  physicians: {
    id: string;
    first_name: string;
    last_name1: string;
    last_name2: string;
    sex: "H" | "M";
    colegiado: string;
  }[];
  insurers: { id: string; name: string; aliases: string[] }[];
}

export type LisDb = Awaited<ReturnType<typeof openLis>>;

/**
 * How long a write waits for another process's lock, in ms: a script run while the server is
 * up. Within one process the client takes turns instead (`takingTurns`).
 */
const BUSY_TIMEOUT_MS = 5000;

/** Another connection's lock stopped the statement. */
function busy(err: unknown): boolean {
  const code = String((err as { code?: unknown } | null)?.code ?? "");
  const stopped = code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
  // An error holds on to the objects of its stack frames, the failed statement among them, until
  // its stack is read: only then can the garbage collector finalize the statement.
  if (stopped) for (let e: unknown = err; e instanceof Error; e = e.cause) void e.stack;
  return stopped;
}

/** A full garbage collection: Node offers it only with --expose-gc, set here at run time. */
const collectGarbage = (() => {
  v8.setFlagsFromString("--expose-gc");
  return vm.runInNewContext("gc") as () => void;
})();

/**
 * Finishes the statements that SQLITE_BUSY left in progress.
 *
 * The driver (libsql 0.5) does not reset a statement that failed with SQLITE_BUSY: it stays in
 * progress, holding its connection's lock, until the garbage collector finalizes it. Meanwhile
 * the connection reports no transaction and goes back to the pool, and what was written on it
 * was never saved, without an error (a document marked failed stayed "extracting" for good),
 * while the other connections found the lock. Closing the connection does not end it either.
 */
async function finishLeftOver(): Promise<void> {
  // Two rounds: a native object's finalizer runs after the collection that found it, and only
  // the next one frees what it held.
  for (let round = 0; round < 2; round += 1) {
    collectGarbage();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * The client, doing one thing at a time: a transaction holds the database until it commits,
 * rolls back or closes, and every other call waits for it.
 *
 * The client keeps a pool of connections and a transaction takes one of its own, between whose
 * statements the server goes on with other work. A write on another connection then found the
 * transaction's lock and waited for it synchronously, with the whole process stopped, so the
 * transaction could never finish: after the busy timeout the server came back and the write
 * failed with SQLITE_BUSY (a document of a batch failed, a page got an HTTP 500).
 *
 * After SQLITE_BUSY, the statements left over are finished (`finishLeftOver`) before anything
 * else runs.
 */
function takingTurns(client: Client): Client {
  let last = Promise.resolve();
  /** Waits for the database to be free and holds it; resolves to the release. */
  const hold = (): Promise<() => void> => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const turn = last.then(() => release);
    last = last.then(() => held);
    return turn;
  };
  const inTurn =
    <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const release = await hold();
      try {
        return await run(...args);
      } catch (err) {
        if (busy(err)) await finishLeftOver();
        throw err;
      } finally {
        release();
      }
    };
  const transaction = async (...args: Parameters<Client["transaction"]>): Promise<Transaction> => {
    const release = await hold();
    let tx: Transaction;
    try {
      tx = await client.transaction(...args);
    } catch (err) {
      if (busy(err)) await finishLeftOver();
      release();
      throw err;
    }
    /** A statement of the transaction, or its end, met SQLITE_BUSY. */
    let failed = false;
    const watched =
      <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await run(...args);
        } catch (err) {
          failed ||= busy(err);
          throw err;
        }
      };
    // Each of these gives the connection back to the pool, whether or not it succeeds.
    const end = async (finish: () => Promise<void>) => {
      try {
        await finish();
      } catch (err) {
        failed ||= busy(err);
        throw err;
      } finally {
        if (failed) await finishLeftOver();
        release();
      }
    };
    const own: Partial<Transaction> = {
      execute: watched(tx.execute.bind(tx)) as Transaction["execute"],
      batch: watched(tx.batch.bind(tx)),
      executeMultiple: watched(tx.executeMultiple.bind(tx)),
      commit: () => end(() => tx.commit()),
      rollback: () => end(() => tx.rollback()),
      close: () => void end(async () => tx.close()).catch(() => undefined),
    };
    return new Proxy(tx, {
      get: (target, prop) => {
        if (prop in own) return own[prop as keyof Transaction];
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  const methods: Partial<Client> = {
    execute: inTurn(client.execute.bind(client)) as Client["execute"],
    batch: inTurn(client.batch.bind(client)),
    migrate: inTurn(client.migrate.bind(client)),
    executeMultiple: inTurn(client.executeMultiple.bind(client)),
    transaction: transaction as Client["transaction"],
  };
  return new Proxy(client, {
    get: (target, prop) => {
      if (prop in methods) return methods[prop as keyof Client];
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Opens the LIS at a libSQL URL (`file:…` or `:memory:`) and brings its schema up to date.
 * `busyTimeoutMs` only for tests, which make another process's lock run out at once.
 */
export async function openLis(url: string, { busyTimeoutMs = BUSY_TIMEOUT_MS } = {}) {
  const db = drizzle(takingTurns(createClient({ url, timeout: busyTimeoutMs })), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

/** Replaces every record with those of `data`, in one transaction. */
export async function loadLis(db: LisDb, data: LisFile): Promise<void> {
  if (data.lis_version !== LIS_VERSION) {
    throw new Error(`unsupported lis_version ${data.lis_version}; expected ${LIS_VERSION}`);
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.insurerAliases);
    await tx.delete(schema.insurers);
    await tx.delete(schema.physicians);
    await tx.delete(schema.patients);
    for (const p of data.patients) {
      await tx.insert(schema.patients).values({
        id: p.id,
        firstName: p.first_name,
        lastName1: p.last_name1,
        lastName2: p.last_name2,
        sex: p.sex,
        birthDate: p.birth_date,
        docId: p.doc_id,
        phone: p.phone,
      });
    }
    for (const m of data.physicians) {
      await tx.insert(schema.physicians).values({
        id: m.id,
        firstName: m.first_name,
        lastName1: m.last_name1,
        lastName2: m.last_name2,
        sex: m.sex,
        colegiado: m.colegiado,
      });
    }
    for (const i of data.insurers) {
      await tx.insert(schema.insurers).values({ id: i.id, name: i.name });
      for (const alias of i.aliases) {
        await tx.insert(schema.insurerAliases).values({ insurerId: i.id, alias });
      }
    }
  });
}
