import { NextResponse } from "next/server";
import {
  beginPart2,
  part2StateFor,
  saveClosing,
  saveFreeRecall,
} from "@voicemural/db/prolific";
import { answerRecallProbe, loadProbeSpeech, rateRecallConfidence } from "@voicemural/db/recall";
import { ProlificPart2 } from "@voicemural/shared";
import { keptIndices } from "@voicemural/talkback";
import { completionCodeFor, completionUrlFor } from "@/lib/study/prolific-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Part 2, a step at a time, for a participant named by PID.
 *
 * WHY NO SESSION. Part 2 may open in a browser that has never seen part 1, so
 * the guest cookie is gone; the PID is the one identity that survives, and it
 * is what Prolific puts in the URL. Every step re-checks that part 2 is open
 * for it (`part2StateFor`).
 *
 * THE ORDER IS THE MEASURE, enforced here and not only by the page: the free
 * recall comes before anything that would cue it, so no probe step is answered
 * until it is in; and within a probe, confidence before the reveal (the
 * database enforces that, as on `/api/recall/[id]`).
 */
export async function POST(req: Request) {
  const parsed = ProlificPart2.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const headers = { "Cache-Control": "no-store" };

  const state = await part2StateFor(body.pid);
  if (state.state !== "open") {
    return NextResponse.json({ error: state.state }, { status: 409, headers });
  }
  const participant = state.participant;

  switch (body.step) {
    case "begin":
      await beginPart2(participant.id, { studyId: body.studyId, sessionId: body.sessionId });
      return NextResponse.json({ ok: true }, { headers });

    case "free_recall":
      // The first one stands; a second send (a double tap) changes nothing.
      await saveFreeRecall(participant.id, body.text, body.confidence);
      return NextResponse.json({ ok: true }, { headers });

    case "closing": {
      const answers = {
        ...body.answers,
        // The control arm never saw a card, so it has nothing to rate.
        cardsHelped: participant.arm === "sparks" ? body.answers.cardsHelped : null,
      };
      const saved = await saveClosing(participant.id, answers);
      if (!saved) return NextResponse.json({ error: "free_recall_first" }, { status: 409, headers });
      return NextResponse.json(
        { ok: true, completionUrl: completionUrlFor(2), completionCode: completionCodeFor(2) },
        { headers },
      );
    }

    default: {
      if (!participant.freeRecallAt) {
        return NextResponse.json({ error: "free_recall_first" }, { status: 409, headers });
      }
      // Only the probes of their study conversation, whatever else the account holds.
      const speech = await loadProbeSpeech(body.probeId, participant.userId);
      if (!speech || speech.probe.captureSessionId !== participant.captureSessionId) {
        return NextResponse.json({ error: "not_found" }, { status: 404, headers });
      }

      if (body.step === "probe_answer") {
        const answered = await answerRecallProbe(body.probeId, participant.userId, {
          selfAccuracy: body.selfAccuracy,
          provenance: body.provenance,
        });
        if (!answered) return NextResponse.json({ error: "not_ready" }, { status: 409, headers });
        return NextResponse.json({ ok: true }, { headers });
      }

      if (body.step === "probe_confidence") {
        await rateRecallConfidence(body.probeId, participant.userId, body.confidence);
      }
      const revealed = await loadProbeSpeech(body.probeId, participant.userId);
      if (!revealed || revealed.probe.confidence === null) {
        return NextResponse.json({ error: "not_ready" }, { status: 409, headers });
      }
      // Their own words without the agent's voice the microphone heard, as on
      // `/api/recall/[id]`, or the reveal would quote the agent as them.
      const lines = revealed.lines;
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
  }
}
