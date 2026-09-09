import { getDb, sql } from "@voicemural/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe for Coolify. Checks the database round-trip, not just the process. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    // No err.message in the body: liveness only needs ok/503, and a driver
    // error string can carry connection details to any unauthenticated caller.
    return Response.json({ ok: false }, { status: 503 });
  }
}
