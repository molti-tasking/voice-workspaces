import { NextResponse } from "next/server";
import { z } from "zod";
import { loadOps } from "@voicemural/db/workspace";
import { foldWorkspace, topicCards } from "@voicemural/workspace";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The workspace cards behind one conversation topic (`topic-cards.ts`), for
 * the topic sheet on the conversation screen: the tasks, claims, questions
 * and facts the workspace holds on it, from every drive.
 *
 * Session-authorised, and only ever the person's own op log; the drive id
 * only narrows which of their topics a loose name is matched against, so it
 * needs no ownership check of its own. Read-only.
 */
const Query = z.object({
  title: z.string().trim().min(1).max(160),
  captureSessionId: z.uuid().optional(),
});

export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const ops = await loadOps(userId);
  const result = topicCards(foldWorkspace(ops), ops, parsed.data.title, parsed.data.captureSessionId ?? null);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
