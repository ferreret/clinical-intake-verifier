/**
 * Before every call to the API: one that changes something (creating a batch, approving,
 * deleting) is refused unless it comes from the app's own pages. The session cookie was the
 * only thing a page of another site needed to make a visitor's browser approve or delete in
 * their name, SameSite=Lax aside, and the JSON routes read a body of any content type, which a
 * form on another site can send.
 *
 * The browser says where a call comes from: Sec-Fetch-Site, or the Origin of older browsers.
 * A call with neither (curl, a script) is no visitor's browser, and goes on.
 */
import { NextResponse, type NextRequest } from "next/server";

const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function fromElsewhere(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    // "null": a sandboxed frame or a file.
    return true;
  }
}

export function proxy(req: NextRequest): NextResponse {
  if (CHANGES.has(req.method) && fromElsewhere(req)) {
    return NextResponse.json({ error: "refused: the request did not come from this site's own pages" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
