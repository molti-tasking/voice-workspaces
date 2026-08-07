import { getDb, sql } from "@voicemural/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe for Coolify. Checks the database round-trip, not just the process. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
