/**
 * What the system said, drawn the same way everywhere it appears.
 *
 * EXTRACTED BECAUSE THE TWO VIEWS DISAGREED. `/sessions/[id]` interleaved agent
 * turns with the transcript and drew them as sky-coloured bubbles;
 * `/timeline` did not load `agent_turn` at all, so a drive read there as a
 * monologue — the person's words with the replies silently removed. Reading the
 * same conversation in two places and seeing two different conversations is
 * worse than either view alone, because it makes the one that is wrong
 * invisible.
 *
 * Only the BUBBLE is shared, not the row. The two views run on different
 * clocks and that difference is meaningful: the session transcript is offsets
 * into one drive, the timeline is wall-clock across every drive there has ever
 * been. Each supplies its own gutter and puts this inside it.
 */

/** The fields the bubble draws. A subset of `agent_turn`, and of nothing else. */
export interface AgentTurnBubbleProps {
  /** 0-based in the drive; displayed 1-based. */
  seq: number;
  /** What was actually heard. Empty when a turn was cut off before playback. */
  text: string;
  /** What the model produced. Differs from `text` only on a barge-in. */
  generatedText: string;
  bargedIn: boolean;
  error: string | null;
}

export function AgentTurnBubble({
  seq,
  text,
  generatedText,
  bargedIn,
  error,
}: AgentTurnBubbleProps) {
  // What was generated but never heard, because the person interrupted.
  const unheard =
    bargedIn && generatedText.length > text.length
      ? generatedText.slice(text.length).trim()
      : null;

  return (
    <div className="inline-block max-w-full rounded-lg rounded-tr-sm border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-left">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-medium tracking-wide text-sky-300/70 uppercase">
        <span>agent · turn {seq + 1}</span>
        {bargedIn && <span className="text-amber-300/80">interrupted</span>}
        {error && <span className="text-red-300/80">failed</span>}
      </div>

      {text ? (
        <p className="text-sky-50">{text}</p>
      ) : (
        <p className="text-white/40 italic">
          {bargedIn ? "cut off before anything was heard" : "nothing was spoken"}
        </p>
      )}

      {/* Generated but never reached the person. Struck through rather than
          hidden: the difference between the two IS the turn-taking data, and
          hiding it would make an interrupted turn look like a complete one. */}
      {unheard && (
        <p className="mt-1 text-sm text-white/30 line-through decoration-white/20">{unheard}</p>
      )}
    </div>
  );
}
