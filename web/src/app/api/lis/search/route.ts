/**
 * GET /api/lis/search?kind=patient|physician|insurer&q=: the workspace's LIS records of one
 * kind that a typed name or number finds, for the technician to link a document by hand.
 */
import { NextResponse } from "next/server";

import { getSession, noSession } from "@/lib/batches/session";
import type { RecordKind } from "@/lib/fusion/types";
import { searchRecords } from "@/lib/lis/records";
import { readSnapshot } from "@/lib/lis/snapshot";

export const runtime = "nodejs";

const KINDS: RecordKind[] = ["patient", "physician", "insurer"];

export async function GET(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return noSession();
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind") as RecordKind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  const results = searchRecords(await readSnapshot(session.db), kind, (params.get("q") ?? "").slice(0, 120));
  return NextResponse.json({ results });
}
