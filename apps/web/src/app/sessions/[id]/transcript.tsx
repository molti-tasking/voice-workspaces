import { formatOffset, isLikelyHallucination } from "@voicemural/shared";
import { KindToggle } from "./kind-toggle";

export interface TranscriptRow {
  id: string;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
  kind: "content" | "directive" | "unclassified";
  kindOverride: "content" | "directive" | "unclassified" | null;
}

/**
 * One turn the system took, as recorded in `agent_turn`.
 *
 * Kept separate from `TranscriptRow` all the way to the screen because they are
 * separate in the database, and for the reason they are separate there: an
 * utterance is what a microphone heard, a turn is something the system
 * generated. Merging them into one shape here would make it possible to lose
 * track of which is which, which is exactly the confusion this view exists to
 * remove.
 */
export interface AgentTurnRow {
  id: string;
  seq: number;
  startOffsetMs: number;
  endOffsetMs: number;
  /** What the driver actually heard. Empty when a turn was cut off before playback. */
  text: string;
  /** What the model produced. Differs from `text` only when interrupted. */
  generatedText: string;
  bargedIn: boolean;
  truncatedAtMs: number | null;
  respondingToText: string | null;
  resolvedModel: string | null;
  asrMs: number | null;
  ttftMs: number | null;
  speakTtfbMs: number | null;
  totalLatencyMs: number | null;
  error: string | null;
}

type Entry =
  | { kind: "user"; at: number; row: TranscriptRow }
  | { kind: "agent"; at: number; turn: AgentTurnRow };

/**
 * The drive as a conversation.
 *
 * Both halves of the dialogue on one timeline, visually distinct, because
 * telling them apart is the first thing anybody needs to do when something
 * sounds wrong — and until now it was impossible. The agent's own voice also
 * echoes into the ledger through the microphone, so a line of transcript may
 * BE the agent; seeing its turns explicitly is what makes that legible.
 *
 * Every agent generation is its own row, never merged, so a drive with several
 * replies can be read turn by turn.
 *
 * A server component apart from the one correction control on each user line —
 * see `KindToggle`, which is the only place `kindOverride` is ever written.
 */
export function Transcript({
  rows,
  turns = [],
}: {
  rows: TranscriptRow[];
  turns?: AgentTurnRow[];
}) {
  if (rows.length === 0 && turns.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-white/40">
        No transcript yet. Chunks are transcribed by the worker — check that it is
        running.
      </p>
    );
  }

  // Interleaved by offset: agent turns are recorded on the same session clock
  // as utterances, which is what lets the two tables be read as one dialogue.
  const entries: Entry[] = [
    ...rows.map((row): Entry => ({ kind: "user", at: row.startOffsetMs, row })),
    ...turns.map((turn): Entry => ({ kind: "agent", at: turn.startOffsetMs, turn })),
  ].sort((a, b) => a.at - b.at);

  const looped = loopedRows(rows);

  return (
    <ol className="space-y-2">
      {entries.map((entry) =>
        entry.kind === "user" ? (
          <UserLine
            key={`u-${entry.row.id}`}
            row={entry.row}
            echoOf={echoOfTurn(entry.row, turns)}
            looped={looped.has(entry.row.id)}
          />
        ) : (
          <AgentLine key={`a-${entry.turn.id}`} turn={entry.turn} />
        ),
      )}
    </ol>
  );
}

/**
 * Rows that are one line of a Whisper repetition loop.
 *
 * The ASR locks onto a phrase on quiet audio and emits it as a run of separate,
 * individually-clean segments — fifteen consecutive rows all reading "I made a
 * hole in the bottom of the box." Each one is plausible alone, which is why no
 * per-line check catches them; only the run gives it away.
 *
 * Collapsed at the ASR boundary now, so new drives do not produce these. Older
 * ones still hold them, and the ledger is append-only — so they are MARKED, the
 * same read-side treatment given to echoes and invented sign-offs. The first of
 * a run is left alone: the driver did say something there.
 *
 * Three, matching MIN_REPEATS in transcript-repair.ts. People repeat themselves
 * twice; nothing legitimate says the same sentence three times in a row.
 */
function loopedRows(rows: TranscriptRow[]): Set<string> {
  const key = (text: string) =>
    text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");

  const marked = new Set<string>();
  for (let i = 0; i < rows.length; ) {
    let run = 1;
    while (i + run < rows.length && key(rows[i + run]!.text) === key(rows[i]!.text)) run += 1;
    // Everything after the first occurrence of a long-enough run.
    if (run >= 3) for (let k = 1; k < run; k++) marked.add(rows[i + k]!.id);
    i += run;
  }
  return marked;
}

/**
 * Which agent turn this line is an echo of, if any.
 *
 * The agent's voice reaches the microphone through the speaker, so the ledger
 * contains lines that were spoken by the system rather than the driver. Matched
 * by containment against the turn's SPOKEN text and by overlapping the interval
 * it was speaking — both, because a genuine interruption also overlaps that
 * interval and must not be hidden.
 */
function echoOfTurn(row: TranscriptRow, turns: AgentTurnRow[]): number | undefined {
  const words = (text: string) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);

  const line = words(row.text);
  if (line.length < 3) return undefined;

  for (const turn of turns) {
    if (!turn.text) continue;
    const overlaps =
      row.startOffsetMs < turn.endOffsetMs + 2000 && row.endOffsetMs > turn.startOffsetMs - 2000;
    if (!overlaps) continue;

    const spoken = new Set(words(turn.text));
    const shared = line.filter((word) => spoken.has(word)).length;
    if (shared / line.length >= 0.75) return turn.seq;
  }
  return undefined;
}

function UserLine({
  row,
  echoOf,
  looped,
}: {
  row: TranscriptRow;
  echoOf?: number;
  looped?: boolean;
}) {
  const kind = row.kindOverride ?? row.kind;
  // Three ways a line can be something the driver did not say. Treated alike
  // on screen — dimmed and annotated, never removed.
  const suspect = isLikelyHallucination(row.text) || looped === true;
  const hallucinated = isLikelyHallucination(row.text);

  return (
    <li className="group flex gap-3">
      <span
        className="w-12 shrink-0 pt-1 text-right font-mono text-xs text-white/25 tabular-nums"
        title={`${formatOffset(row.startOffsetMs)}–${formatOffset(row.endOffsetMs)}`}
      >
        {formatOffset(row.startOffsetMs)}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={[
            "inline-block rounded-lg rounded-tl-sm px-3 py-1.5",
            suspect || echoOf !== undefined
              ? "border border-dashed border-white/15 bg-transparent text-white/35"
              : "bg-white/[0.04]",
            kind === "directive" && !suspect ? "text-amber-300" : "",
            !suspect && echoOf === undefined ? "text-white" : "",
          ].join(" ")}
        >
          {row.text}
        </p>
        {/* Nothing to correct on a line nobody said. */}
        {!suspect && echoOf === undefined && (
          <KindToggle utteranceId={row.id} kind={kind} />
        )}
        {/* Said by nobody. The ledger keeps it — it is the verbatim record and
            nothing is deleted — but presenting it as speech would be a lie. */}
        {hallucinated && (
          <p className="mt-0.5 text-[11px] text-white/30">
            likely a transcription artefact — Whisper invents sign-offs like this on
            silence
          </p>
        )}
        {looped && (
          <p className="mt-0.5 text-[11px] text-white/30">
            repeat of the line above — Whisper looping on quiet audio, not something
            said again
          </p>
        )}
        {echoOf !== undefined && (
          <p className="mt-0.5 text-[11px] text-white/30">
            likely the agent&rsquo;s turn {echoOf + 1} heard through the microphone
          </p>
        )}
      </div>
      {/* Right margin left clear, so the agent's side is unmistakable at a glance. */}
      <span className="w-16 shrink-0" />
    </li>
  );
}

function AgentLine({ turn }: { turn: AgentTurnRow }) {
  const spoke = turn.endOffsetMs - turn.startOffsetMs;
  // What was generated but never heard, because the driver interrupted.
  const unheard =
    turn.bargedIn && turn.generatedText.length > turn.text.length
      ? turn.generatedText.slice(turn.text.length).trim()
      : null;

  return (
    <li className="flex gap-3">
      <span
        className="w-12 shrink-0 pt-1 text-right font-mono text-xs text-white/25 tabular-nums"
        title={`${formatOffset(turn.startOffsetMs)}–${formatOffset(turn.endOffsetMs)}`}
      >
        {formatOffset(turn.startOffsetMs)}
      </span>

      <div className="min-w-0 flex-1 text-right">
        <div className="inline-block max-w-full rounded-lg rounded-tr-sm border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-left">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-sky-300/70">
            <span>agent · turn {turn.seq + 1}</span>
            {turn.bargedIn && <span className="text-amber-300/80">interrupted</span>}
            {turn.error && <span className="text-red-300/80">failed</span>}
          </div>

          {turn.text ? (
            <p className="text-sky-50">{turn.text}</p>
          ) : (
            <p className="italic text-white/40">
              {turn.bargedIn ? "cut off before anything was heard" : "nothing was spoken"}
            </p>
          )}

          {/* Generated but never reached the driver. Shown struck through rather
              than hidden: the difference between the two is the turn-taking
              data, and hiding it would make an interrupted turn look complete. */}
          {unheard && (
            <p className="mt-1 text-sm text-white/30 line-through decoration-white/20">
              {unheard}
            </p>
          )}

          <Meta turn={turn} spokeMs={spoke} />
        </div>
      </div>
    </li>
  );
}

/**
 * The numbers behind a turn.
 *
 * A live conversation is not replayable, so these columns are the only record
 * that it happened at all — and the only way to tell a slow reply from a slow
 * transcription after the fact.
 */
function Meta({ turn, spokeMs }: { turn: AgentTurnRow; spokeMs: number }) {
  const parts = [
    turn.asrMs !== null && `heard in ${turn.asrMs}ms`,
    turn.ttftMs !== null && `first word ${turn.ttftMs}ms`,
    turn.speakTtfbMs !== null && `audio ${turn.speakTtfbMs}ms`,
    spokeMs > 0 && `spoke ${(spokeMs / 1000).toFixed(1)}s`,
    turn.truncatedAtMs !== null && `heard ${(turn.truncatedAtMs / 1000).toFixed(1)}s`,
  ].filter(Boolean);

  if (parts.length === 0 && !turn.resolvedModel) return null;

  return (
    <p className="mt-1.5 font-mono text-[10px] text-white/25">
      {parts.join(" · ")}
      {turn.resolvedModel && <span className="ml-2 text-white/20">{turn.resolvedModel}</span>}
    </p>
  );
}
