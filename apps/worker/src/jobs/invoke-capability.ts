/**
 * Fire a capability, or park it for confirmation.
 *
 * `invocation` is what Notes.md names as the dependent variable — "added when,
 * used how often, which survived" — and until now nothing wrote it. Every fire
 * is recorded, including the ones that are refused or reverted, because a
 * capability the user keeps declining is a finding rather than a gap.
 *
 * The split comes straight from the direction-versus-content asymmetry: the
 * captured stream is verbatim and append-only, artefacts are derived, so an
 * additive and reversible action may fire on weak evidence at no cost, while
 * anything irreversible or outbound confirms first — and that confirmation may
 * wait for a pause rather than interrupting a thought.
 */
import {
  directivesAwaitingInvocation,
  loadRepertoire,
  recordInvocation,
} from "@voicemural/db/repertoire";
import { capture, log } from "@voicemural/telemetry";
import { getDb, artifact, eq, utterance } from "@voicemural/db";

export interface InvokeOutcome {
  fired: number;
  awaitingConfirmation: number;
  failed: number;
}

/** Params default to the safe reading when a capability does not state them. */
function policyOf(params: Record<string, unknown>): {
  reversible: boolean;
  confirm: boolean;
} {
  const reversible = params.reversible !== false;
  // Confirm unless explicitly told not to. An action whose author forgot to say
  // asks first, which is the failure that costs a question rather than a
  // message the user never meant to send.
  const confirm = params.confirm !== false;
  return { reversible, confirm };
}

export async function invokePendingDirectives(limit = 50): Promise<InvokeOutcome> {
  const pending = await directivesAwaitingInvocation(limit);
  const outcome: InvokeOutcome = { fired: 0, awaitingConfirmation: 0, failed: 0 };
  if (pending.length === 0) return outcome;

  // One repertoire load per user, not per directive.
  const repertoireByUser = new Map<string, Awaited<ReturnType<typeof loadRepertoire>>>();

  for (const item of pending) {
    const startedAt = Date.now();
    try {
      const userId = await userForSession(item.captureSessionId);
      if (!userId) continue;

      let repertoire = repertoireByUser.get(userId);
      if (!repertoire) {
        repertoire = await loadRepertoire(userId);
        repertoireByUser.set(userId, repertoire);
      }

      const cap = repertoire.find((c) => c.id === item.capabilityId);
      if (!cap) {
        // Retired between classification and here. Record the fire anyway —
        // "they asked for something they had removed" is data — and mark it
        // errored rather than dropping it.
        await recordInvocation({
          capabilityId: item.capabilityId,
          capabilityVersionId: item.capabilityId,
          captureSessionId: item.captureSessionId,
          triggeringUtteranceId: item.utteranceId,
          confirmed: false,
          error: "capability retired",
        });
        outcome.failed += 1;
        continue;
      }

      const { confirm } = policyOf(cap.params);

      if (confirm) {
        // Parked, not fired. `/api/realtime/context` surfaces the oldest of
        // these on the next turn so the agent can ask, briefly, and let it wait
        // if the user is mid-thought.
        await recordInvocation({
          capabilityId: cap.id,
          capabilityVersionId: cap.versionId,
          captureSessionId: item.captureSessionId,
          triggeringUtteranceId: item.utteranceId,
          confirmed: null,
        });
        outcome.awaitingConfirmation += 1;
        continue;
      }

      // Additive and reversible: act now. Acting means writing an artefact
      // carrying provenance back to the utterance that asked for it — the
      // whole point of `artifact.spans`.
      await applyAction(cap.name, item, cap.restatement);

      await recordInvocation({
        capabilityId: cap.id,
        capabilityVersionId: cap.versionId,
        captureSessionId: item.captureSessionId,
        triggeringUtteranceId: item.utteranceId,
        confirmed: true,
        latencyMs: Date.now() - startedAt,
      });
      outcome.fired += 1;

      capture(userId, "capability_invoked", {
        capability: cap.name,
        capability_type: cap.type,
        capture_session_id: item.captureSessionId,
        confirmed: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("invocation failed", { utteranceId: item.utteranceId, err: message });
      await recordInvocation({
        capabilityId: item.capabilityId,
        capabilityVersionId: item.capabilityId,
        captureSessionId: item.captureSessionId,
        triggeringUtteranceId: item.utteranceId,
        confirmed: false,
        error: message,
      }).catch(() => undefined);
      outcome.failed += 1;
    }
  }

  return outcome;
}

/**
 * What firing actually does.
 *
 * Deliberately thin. `mark` — the highest-frequency, safest-to-over-trigger
 * action — is a flag on a range of speech, and a flag is an `artifact` row with
 * a span. Anything outbound is not reached from here at all: those confirm
 * first, and delivery through an `outlet` is separate work.
 */
async function applyAction(
  name: string,
  item: { utteranceId: string; captureSessionId: string; restatement: string },
  restatement: string | null,
): Promise<void> {
  const db = getDb();
  const [source] = await db
    .select({ text: utterance.text })
    .from(utterance)
    .where(eq(utterance.id, item.utteranceId))
    .limit(1);

  await db.insert(artifact).values({
    captureSessionId: item.captureSessionId,
    kind: name,
    title: restatement ?? item.restatement,
    body: source?.text ?? item.restatement,
    spans: [
      {
        utteranceId: item.utteranceId,
        startChar: 0,
        endChar: (source?.text ?? "").length,
      },
    ],
  });
}

async function userForSession(captureSessionId: string): Promise<string | null> {
  const { captureSession } = await import("@voicemural/db/schema");
  const [row] = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  return row?.userId ?? null;
}
