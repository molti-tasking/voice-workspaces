import { describeWhen, loadDriveSoFar, searchTranscripts } from "./retrieval";

/**
 * The transcript put in front of the model for one turn.
 *
 * Carried over unchanged from the previous implementation, because retrieval was
 * never the broken part. It reads the current drive from the ledger and searches
 * every past recording, with the agent's own echoed voice filtered out on read —
 * without that the system quotes its own previous replies back as things the
 * driver said, and starts having a conversation with itself.
 *
 * Returns null when there is nothing worth adding, so a turn with no context
 * carries no extra prompt at all: prompt size is paid on every turn as latency.
 */
export async function buildContextMessage(
  userId: string,
  captureSessionId: string,
  said: string,
): Promise<string | null> {
  const [driveSoFar, fromThePast] = await Promise.all([
    loadDriveSoFar(captureSessionId),
    searchTranscripts(userId, said, { excludeSessionId: captureSessionId }),
  ]);

  const sections: string[] = [];

  if (fromThePast.length) {
    sections.push(
      "From their past recordings:\n" +
        fromThePast
          .map((passage) => `[${describeWhen(passage.occurredAt)}] ${passage.text}`)
          .join("\n\n"),
    );
  }

  if (driveSoFar.length) {
    sections.push(`Earlier in this drive:\n${driveSoFar.map((p) => p.text).join(" ")}`);
  }

  if (sections.length === 0) return null;

  return `${sections.join("\n\n")}\n\nThat transcript is background. Answer only what was just said to you.`;
}
