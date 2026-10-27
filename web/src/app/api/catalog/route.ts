/**
 * GET /api/catalog?q=: the workspace's catalog searched by a typed name or code, for the
 * technician to add a test that was not proposed. With the name of every code returned.
 */
import { NextResponse } from "next/server";

import { catalogOf } from "@/lib/batches/pipeline";
import { getSession, noSession } from "@/lib/batches/session";
import { browse, codeNames } from "@/lib/mapping/browse";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const { catalog, index } = await catalogOf(session.db);
  const results = browse(index, q.slice(0, 120));
  return NextResponse.json({ results, names: codeNames(catalog, results.flatMap((r) => r.codes)) });
}
