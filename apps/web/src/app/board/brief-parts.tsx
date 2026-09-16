import type { TimelineUtterance } from "@voicemural/db/workspace";
import type { Block, CardBrief } from "@voicemural/workspace";
import { Link } from "@/components/nav-link";
import { formatWhen, stepLabel, transcriptHref } from "./brief-view";

/**
 * The three sections a brief is made of, shared by both brief pages.
 *
 * Server components, all of them. What they render is the participant's own
 * transcribed speech and the tasks read out of it, and none of it belongs in a
 * client payload — so nothing here is a client component and nothing here
 * takes a handler.
 *
 * Every link whose label is task text or speech carries `ph-no-capture`:
 * PostHog autocapture is on (see `instrumentation-client.ts`), and an
 * autocaptured click sends the element's text. See the note on `Quotes`.
 */

/**
 * What the person actually said.
 *
 * Verbatim, with the date it was said and a link into the drive's transcript.
 * Nothing is summarised, because nothing on this page is generated: the whole
 * claim of a brief is that it is the record, rearranged.
 *
 * `utterances` may be shorter than `brief.utteranceIds` — a cited id can be
 * malformed, invented by the model, or name a line on another user's drive,
 * and all three simply do not come back from the query. So the fallback is
 * decided by what was actually returned, never by whether ids were cited.
 */
export function Quotes({
  brief,
  utterances,
}: {
  brief: CardBrief;
  utterances: TimelineUtterance[];
}) {
  const rows = brief.utteranceIds
    .map((id) => utterances.find((u) => u.id === id))
    .filter((u): u is TimelineUtterance => u !== undefined);

  if (rows.length === 0) return <NoQuotes brief={brief} />;

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.id}>
          <blockquote className="border-l-2 border-line pl-3 text-sm leading-snug text-white/80">
            {/* The label is the person's own speech, so it must not be
                autocaptured — hence the class on the link below, not here. */}
            {row.text}
          </blockquote>
          <p className="mt-1 pl-3 text-[11px] text-white/30">
            <Link
              href={transcriptHref(row.captureSessionId, row.id)}
              title="Open this line in the drive's transcript"
              className="underline decoration-white/20 underline-offset-2 hover:text-white/60"
            >
              {formatWhen(row.occurredAt)}
            </Link>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Why there is nothing to quote.
 *
 * Three cases, one sentence: the agent added the card and cited nothing, the
 * extractor cited nothing, or what it cited no longer resolves. All the page
 * can honestly say is which drive the card came from — so it says that, and
 * links there, rather than leaving a blank where speech should be.
 */
function NoQuotes({ brief }: { brief: CardBrief }) {
  const first = brief.card.history[0];
  const added = first?.via === "agent" ? "added by the agent" : "from speech";
  const sessionId = first?.captureSessionId;

  if (!sessionId || !first) {
    return <p className="text-sm text-white/35">No line is cited.</p>;
  }

  return (
    <p className="text-sm text-white/35">
      {added} during the{" "}
      <Link
        href={transcriptHref(sessionId)}
        title="Open the drive this task came from"
        className="underline decoration-white/20 underline-offset-2 hover:text-white/60"
      >
        drive on {formatWhen(first.at)}
      </Link>
      .
    </p>
  );
}

/**
 * How the card moved, oldest first.
 *
 * Every revision, not only the ones that changed a column: a rewording is
 * something that happened to the task, and skipping it would make the text on
 * the card look as though it had always read that way.
 */
export function Steps({ brief }: { brief: CardBrief }) {
  return (
    <ol className="space-y-2">
      {brief.steps.map((step) => (
        <li key={step.block.id} className="flex gap-3 text-sm">
          <span className="w-32 shrink-0 pt-px font-mono text-[11px] text-white/30 tabular-nums">
            {formatWhen(step.block.occurredAt)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-mono text-[11px] text-amber-300/70">{stepLabel(step)}</span>
            {step.previousText && (
              <span className="mt-0.5 block text-[13px] leading-snug text-white/25 line-through">
                {step.previousText}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The topic's open questions and what is thought about it.
 *
 * Ordered by `topicContext`, and drawn the way the workspace card draws the
 * same blocks — questions loudest and first, then the substance — so the two
 * pages do not present one fold in two different shapes.
 */
export function TopicNotes({
  questions,
  notes,
}: {
  questions: Block[];
  notes: Block[];
}) {
  if (questions.length === 0 && notes.length === 0) return null;

  return (
    <div className="space-y-2">
      {questions.length > 0 && (
        <ul className="space-y-1.5">
          {questions.map((b) => (
            <li key={b.id} className="flex gap-2 text-sm leading-snug text-amber-300">
              <span aria-hidden className="shrink-0 font-mono text-xs opacity-60">
                ?
              </span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((b) => (
            <li key={b.id} className="text-[13px] leading-snug text-white/50">
              {b.label && <span className="text-white/30">{b.label}: </span>}
              {b.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
