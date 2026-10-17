import { NextResponse } from "next/server";
import { z } from "zod";
import { recallProvenanceEnum } from "@voicemural/db";
import {
  answerRecallProbe,
  loadProbeSpeech,
  rateRecallConfidence,
} from "@voicemural/db/recall";
import { keptIndices } from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One recall question, in its two steps.
 *
 * `confidence` first — how well they remember where they landed, before they
 * see anything — and only then their own words on that subject come back in
 * the response. Then `answer`: how close they were, and whose idea it was.
 * The order is the measure, so it is enforced here and in the database, not
 * only by the page.
 *
 * What they say or type to themselves in between is never sent; nothing on
 * this route accepts text.
 */
const Scale = z.number().int().min(1).max(7);
const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("confidence"), confidence: Scale }),
  // Back after leaving mid-way: their words again, for a rating already in.
  z.object({ step: z.literal("reveal") }),
  z.object({
    step: z.literal("answer"),
    selfAccuracy: Scale,
    provenance: z.enum(recallProvenanceEnum.enumValues),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const headers = { "Cache-Control": "no-store" };

  if (parsed.data.step === "confidence" || parsed.data.step === "reveal") {
    // The first rating stands: a second one (a double tap, a reload) changes
    // nothing and gets the reveal like the first.
    if (parsed.data.step === "confidence") {
      await rateRecallConfidence(id, userId, parsed.data.confidence);
    }
    const speech = await loadProbeSpeech(id, userId);
    if (!speech) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Never before they have said how well they remember it.
    if (speech.probe.confidence === null) {
      return NextResponse.json({ error: "not_ready" }, { status: 409 });
    }
    // Their own words, without the agent's voice the microphone heard: the
    // same filter recall uses, or the reveal would quote the agent as them.
    const lines = speech.lines;
    const theirs = lines.filter((l) => l.who === "user");
    const kept = new Set(
      keptIndices(
        theirs.map((l) => l.text),
        lines.filter((l) => l.who === "agent").map((l) => l.text),
      ).map((i) => theirs[i]),
    );
    return NextResponse.json(
      { ok: true, lines: lines.filter((l) => l.who === "agent" || kept.has(l)) },
      { headers },
    );
  }

  const answered = await answerRecallProbe(id, userId, {
    selfAccuracy: parsed.data.selfAccuracy,
    provenance: parsed.data.provenance,
  });
  if (!answered) return NextResponse.json({ error: "not_ready" }, { status: 409 });
  return NextResponse.json({ ok: true }, { headers });
}
