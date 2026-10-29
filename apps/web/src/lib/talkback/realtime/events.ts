import type { ConversationMessage } from "../conversation";
import type { SparkKind } from "../signals";

/**
 * The conversation, from a realtime session's server events.
 *
 * What the container's `TurnFeed`, `AgentFeed` and `TurnRecorder` did between
 * them, from the provider's own events instead of Pipecat's frames: their
 * turns and the agent's as the screen shows them, who is talking, and one
 * record per agent turn for `agent_turn`.
 *
 * ONE TURN PER RESPONSE. The model often says a short lead-in before its
 * answer ("Nice plan, let me think…"), and the provider sends it as an item of
 * its own (`phase: "commentary"`). Both were one reply to the person who heard
 * them, so they are one agent turn here, keyed by the response.
 *
 * THEIR WORDS FIRST, even when they arrive second. The transcript of what they
 * said is made beside the conversation and often lands after the agent has
 * begun answering; the store numbers turns in the order it first sees them, so
 * an answer shown before its question would be filed before it for good. The
 * agent's lines are held until their transcript is in, or for at most
 * `HOLD_MS`.
 *
 * THE AGENT'S WORDS AS ITS VOICE REACHES THEM. The provider sends the
 * transcript of a reply as fast as the model writes it, which is seconds ahead
 * of the audio playing it, so a line shown as it arrives was finished on
 * screen while the voice was still on its first sentence. Over WebRTC there
 * are no word timings, so a reply is shown from the moment its audio starts
 * with how far the voice has got (`voiced`, at speaking pace: `CHARS_PER_SEC`,
 * the same estimate a cut-off reply is shortened by), and in full once its
 * audio stops. The text it is sent with runs ahead, which is what lets the
 * views keep every word in place (lib/talkback/spoken.ts).
 *
 * THEIR WORDS WHILE THEY SAY THEM come from a second session beside this one
 * (`caption`): the conversation's own transcript of a turn exists only once
 * the turn is over. The caption's segments are joined into one live turn,
 * which the turn's own transcript then replaces in place — the same turn on
 * screen, its words corrected once — and which counts as their words being
 * on screen, so a reply is not held back for the transcript.
 */

export type RealtimeTrigger = "user_turn" | "opening" | "poke";

export interface FinishedTurn {
  trigger: RealtimeTrigger;
  spark: { kind: SparkKind; ordinal: number } | null;
  /** Wall clock ms: when the moment arose — the end of their turn, or the opening or poke sent. */
  cueAtMs: number;
  /** When the agent's audio started and stopped (or was cut off), wall clock ms. Null when it never played. */
  audioStartMs: number | null;
  audioEndMs: number | null;
  /** Whether that end was the provider's own stop or cut, rather than a timeout or the connection going. */
  endMeasured: boolean;
  /** When the response was created, and its first words arrived. */
  createdAtMs: number;
  firstTextMs: number | null;
  /** All it generated, and what of it was heard: less only after a barge-in. */
  generatedText: string;
  text: string;
  bargedIn: boolean;
  /** Their words this answers, for a reply to their turn. */
  respondingToText: string | null;
  /** From the end of their turn to their transcript, for a reply to their turn. */
  asrMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ConversationSink {
  now(): number;
  emit(message: ConversationMessage): void;
  /** A turn has appeared, in the order the store sees them (the titler's mark). */
  began(turnId: string): void;
  /** A turn is final (the titler's window). */
  heard(who: "user" | "agent", text: string): void;
  userSpeaking(on: boolean): void;
  agentSpeaking(on: boolean): void;
  /** One agent turn is over: spoken out, cut off, or never started. */
  finished(turn: FinishedTurn): void;
  /** Their turn is committed — the end of it, as the provider heard it. */
  turnEnded?(): void;
  /** A response is over, whether or not its audio has finished playing. */
  responseDone?(): void;
}

/** The longest the agent's lines wait for the transcript of the turn before them. */
export const HOLD_MS = 4000;
/** How long after a response is done its audio may still be playing before the turn is closed anyway. */
const PLAYBACK_GRACE_MS = 30_000;
/** Speech, in characters a second: how far a reply's voice has got, shown or cut off. */
const CHARS_PER_SEC = 15;
/** How often the line of a reply that is playing catches up with its voice. */
const PACE_TICK_MS = 150;
/** After their turn is committed, a caption arriving this soon is still its tail, not a new turn. */
const LIVE_TAIL_MS = 2500;

interface Response {
  id: string;
  trigger: RealtimeTrigger;
  spark: { kind: SparkKind; ordinal: number } | null;
  cueAtMs: number;
  createdAtMs: number;
  firstTextMs: number | null;
  /** The transcript of each output item, by output index. */
  parts: string[];
  audioStartMs: number | null;
  audioEndMs: number | null;
  endMeasured: boolean;
  bargedIn: boolean;
  done: boolean;
  shown: boolean;
  /** The line as last sent to the screen, so a tick that changes nothing sends nothing. */
  emitted: string | null;
  respondingToText: string | null;
  asrMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

type Event = { type: string; [key: string]: unknown };

/** Their turn as the live transcription has it: its segments, in order, joined. */
interface LiveTurn {
  id: string;
  segments: string[];
  text: Map<string, string>;
  shown: boolean;
  /** The turn's own transcript is in and has replaced it: captions stop. */
  final: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** What was heard of `text` when it was cut off after `heardMs` of playback: whole words. */
export function heardOf(text: string, heardMs: number): string {
  const chars = Math.max(0, Math.round((heardMs / 1000) * CHARS_PER_SEC));
  if (chars >= text.length) return text;
  const cut = text.slice(0, chars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

export class RealtimeConversation {
  private readonly responses = new Map<string, Response>();
  /** Their turns: transcript so far, and whether it has been shown. */
  private readonly users = new Map<string, { text: string; shown: boolean; final: boolean }>();
  /** The latest of their turns whose transcript is not in yet. Agent lines wait on it. */
  private pendingUser: string | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private stoppedAtMs: number | null = null;
  private committedAtMs: number | null = null;
  private lastUserText: string | null = null;
  private expected: { trigger: RealtimeTrigger; spark: Response["spark"]; atMs: number } | null = null;
  private inProgress: string | null = null;
  private playing: string | null = null;
  private pacer: ReturnType<typeof setInterval> | null = null;
  /** The live turns, by their id; which live turn each caption segment is in. */
  private readonly liveTurns = new Map<string, LiveTurn>();
  private readonly segmentTurn = new Map<string, string>();
  /** The live turn their speech is in now, and the one their last committed turn is shown as. */
  private openLive: string | null = null;
  private lastLive: { id: string; at: number } | null = null;
  private liveCount = 0;
  /** They began speaking again since their last turn was committed. */
  private speakingAgain = false;
  /** Their turn (the conversation's item) → the live turn it is shown as. */
  private readonly shownAs = new Map<string, string>();
  private closed = false;

  constructor(private readonly sink: ConversationSink) {}

  /** A response is in progress: generating, whether or not its audio has started. */
  get responding(): boolean {
    return this.inProgress !== null;
  }

  /** The agent's audio is playing. */
  get speaking(): boolean {
    return this.playing !== null;
  }

  /** The next response is one asked for: the opening, or a poke. */
  expect(trigger: Exclude<RealtimeTrigger, "user_turn">, spark: Response["spark"] = null): void {
    this.expected = { trigger, spark, atMs: this.sink.now() };
  }

  handle(event: Event): void {
    if (this.closed) return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.speakingAgain = true;
        this.sink.userSpeaking(true);
        return;
      case "input_audio_buffer.speech_stopped":
        this.stoppedAtMs = this.sink.now();
        this.sink.userSpeaking(false);
        return;
      case "input_audio_buffer.committed": {
        const id = str(event.item_id);
        if (!id) return;
        this.committedAtMs = this.stoppedAtMs ?? this.sink.now();
        if (!this.users.has(id)) this.users.set(id, { text: "", shown: false, final: false });
        // The live words of this turn are this turn: its transcript will replace them where they are.
        if (this.openLive !== null) {
          this.shownAs.set(id, this.openLive);
          this.lastLive = { id: this.openLive, at: this.sink.now() };
          this.openLive = null;
        }
        this.speakingAgain = false;
        this.pendingUser = id;
        this.sink.turnEnded?.();
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const id = str(event.item_id);
        const user = id ? this.users.get(id) : undefined;
        if (!id || !user || user.final) return;
        user.text += str(event.delta) ?? "";
        this.showUser(id);
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = str(event.item_id);
        if (!id) return;
        const user = this.users.get(id) ?? { text: "", shown: false, final: false };
        this.users.set(id, user);
        user.text = (str(event.transcript) ?? user.text).trim();
        user.final = true;
        this.showUser(id);
        if (user.text) {
          this.lastUserText = user.text;
          this.sink.heard("user", user.text);
          // Their words are what the reply to them answers, and how long the
          // transcript took after their turn ended is the nearest thing here
          // to the container's ASR time.
          for (const r of this.responses.values()) {
            if (r.trigger === "user_turn" && r.respondingToText === null && !r.done) {
              r.respondingToText = user.text;
              if (this.committedAtMs !== null) r.asrMs = Math.max(0, this.sink.now() - this.committedAtMs);
            }
          }
        }
        if (this.pendingUser === id) {
          this.pendingUser = null;
          this.release();
        }
        return;
      }
      case "conversation.item.input_audio_transcription.failed": {
        if (this.pendingUser === str(event.item_id)) {
          this.pendingUser = null;
          this.release();
        }
        return;
      }
      case "response.created": {
        const id = str((event.response as { id?: unknown } | undefined)?.id);
        if (!id) return;
        const expected = this.expected;
        this.expected = null;
        const now = this.sink.now();
        const trigger = expected?.trigger ?? "user_turn";
        this.responses.set(id, {
          id,
          trigger,
          spark: expected?.spark ?? null,
          cueAtMs: expected?.atMs ?? this.committedAtMs ?? now,
          createdAtMs: now,
          firstTextMs: null,
          parts: [],
          audioStartMs: null,
          audioEndMs: null,
          endMeasured: false,
          bargedIn: false,
          done: false,
          shown: false,
          emitted: null,
          respondingToText: trigger === "user_turn" ? this.respondingTo() : null,
          asrMs: null,
          inputTokens: null,
          outputTokens: null,
          graceTimer: null,
        });
        this.inProgress = id;
        // Their turn is not on screen yet: hold this reply's lines until it is.
        if (this.pendingUser !== null && trigger === "user_turn" && !this.onScreen(this.pendingUser)) this.arm();
        return;
      }
      case "response.output_audio_transcript.delta":
      case "response.output_audio_transcript.done": {
        const r = this.responses.get(str(event.response_id) ?? "");
        if (!r) return;
        const index = num(event.output_index) ?? 0;
        if (event.type.endsWith(".delta")) {
          r.parts[index] = (r.parts[index] ?? "") + (str(event.delta) ?? "");
          r.firstTextMs ??= this.sink.now();
        } else {
          r.parts[index] = str(event.transcript) ?? r.parts[index] ?? "";
        }
        this.showAgent(r);
        return;
      }
      case "output_audio_buffer.started": {
        const r = this.responses.get(str(event.response_id) ?? "");
        if (!r) return;
        r.audioStartMs ??= this.sink.now();
        this.playing = r.id;
        this.sink.agentSpeaking(true);
        this.pace();
        return;
      }
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        const r = this.responses.get(str(event.response_id) ?? "");
        if (!r) return;
        r.audioEndMs = this.sink.now();
        r.endMeasured = true;
        // Cleared is a barge-in: they spoke over it and the rest was dropped.
        if (event.type === "output_audio_buffer.cleared" && r.audioStartMs !== null) r.bargedIn = true;
        if (this.playing === r.id) {
          this.playing = null;
          this.stopPacing();
          this.sink.agentSpeaking(false);
        }
        // All of it once the voice has said it all; what was heard once cut off.
        this.showAgent(r);
        this.maybeFinish(r);
        return;
      }
      case "response.done": {
        const response = (event.response ?? {}) as {
          id?: unknown;
          status?: unknown;
          usage?: { input_tokens?: unknown; output_tokens?: unknown } | null;
          output?: { content?: { transcript?: unknown }[] }[];
        };
        const r = this.responses.get(str(response.id) ?? "");
        if (!r) return;
        r.done = true;
        r.inputTokens = num(response.usage?.input_tokens);
        r.outputTokens = num(response.usage?.output_tokens);
        // The final words of every part, in case a delta was missed.
        (response.output ?? []).forEach((item, i) => {
          const transcript = (item.content ?? []).map((c) => str(c.transcript) ?? "").join(" ").trim();
          if (transcript) r.parts[i] = transcript;
        });
        if (this.inProgress === r.id) this.inProgress = null;
        this.showAgent(r);
        this.sink.responseDone?.();
        if (r.audioStartMs !== null && r.audioEndMs === null) {
          // Still playing: closed when the audio stops, or after a grace period
          // if the stop is never heard of.
          r.graceTimer = setTimeout(() => {
            r.audioEndMs = this.sink.now();
            this.finish(r);
          }, PLAYBACK_GRACE_MS);
        }
        this.maybeFinish(r);
        return;
      }
      default:
        return;
    }
  }

  /** The connection is going: close whatever is open, as it stands. */
  close(): void {
    if (this.closed) return;
    this.pendingUser = null;
    this.release();
    this.stopPacing();
    for (const r of this.responses.values()) {
      if (r.audioStartMs !== null && r.audioEndMs === null) r.audioEndMs = this.sink.now();
      r.done = true;
      this.finish(r);
    }
    if (this.playing !== null) this.sink.agentSpeaking(false);
    this.closed = true;
  }

  /** Their words a reply to their turn answers: null until the transcript of the turn just ended is in. */
  private respondingTo(): string | null {
    return this.pendingUser === null ? this.lastUserText : null;
  }

  private text(r: Response): string {
    return r.parts.map((p) => p?.trim()).filter(Boolean).join(" ");
  }

  private showUser(id: string): void {
    const user = this.users.get(id)!;
    if (!user.text) return;
    const as = this.shownAs.get(id);
    const live = as === undefined ? undefined : this.liveTurns.get(as);
    // Its live words stay until its transcript is whole: a partial one would shrink them.
    if (live?.shown && !user.final) return;
    const first = !user.shown && !live?.shown;
    user.shown = true;
    if (live) {
      live.shown = true;
      live.final = user.final;
    }
    if (first) this.sink.began(as ?? id);
    this.sink.emit({ type: "user", id: as ?? id, text: user.text });
    // Once their turn is on screen, a reply to it can follow it there.
    if (first && this.pendingUser === id) this.release();
  }

  /** Whether their turn is on screen: its own transcript, or its live words. */
  private onScreen(id: string): boolean {
    if (this.users.get(id)?.shown) return true;
    const as = this.shownAs.get(id);
    return as !== undefined && this.liveTurns.get(as)?.shown === true;
  }

  /**
   * An event of the live transcription beside the call: their words while they
   * are saying them. Each segment its voice detection cut joins the live turn
   * their speech is in — opened by the first words of a turn, and kept for a
   * tail that arrives just after the turn was committed — and the joined words
   * are shown as that turn, marked live, until its own transcript is in.
   */
  caption(event: Event): void {
    if (this.closed) return;
    const delta = event.type === "conversation.item.input_audio_transcription.delta";
    if (!delta && event.type !== "conversation.item.input_audio_transcription.completed") return;
    const segment = str(event.item_id);
    if (!segment) return;
    let id = this.segmentTurn.get(segment);
    if (id === undefined) {
      id = this.liveTurnFor();
      this.segmentTurn.set(segment, id);
      this.liveTurns.get(id)!.segments.push(segment);
    }
    const turn = this.liveTurns.get(id)!;
    if (turn.final) return;
    const before = turn.text.get(segment) ?? "";
    turn.text.set(segment, delta ? before + (str(event.delta) ?? "") : (str(event.transcript) ?? before));
    const text = turn.segments
      .map((s) => turn.text.get(s)?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (!text) return;
    if (!turn.shown) {
      turn.shown = true;
      this.sink.began(id);
      // A reply held for their words can follow them now.
      const held = [...this.shownAs].some(([user, as]) => as === id && user === this.pendingUser);
      if (held) this.release();
    }
    this.sink.emit({ type: "user", id, text, live: true });
  }

  /** The live turn new words go to: the open one, the tail of the one just committed, or a new one. */
  private liveTurnFor(): string {
    if (this.openLive !== null) return this.openLive;
    const last = this.lastLive;
    if (last && !this.speakingAgain && this.sink.now() - last.at < LIVE_TAIL_MS && !this.liveTurns.get(last.id)?.final) {
      return last.id;
    }
    const id = `live-${++this.liveCount}`;
    this.liveTurns.set(id, { id, segments: [], text: new Map(), shown: false, final: false });
    this.openLive = id;
    return id;
  }

  /**
   * Puts the reply on screen from the moment its voice starts: all of its
   * text so far, with how much of it the voice has said (`voiced`), so the
   * view can lay the words out where they will stay and fade each in as it is
   * said. Once over — `final`, or its audio stopped — as it ends: all of it, or
   * what was heard of it if cut off. A reply whose audio never started is
   * shown only then, whole.
   */
  private showAgent(r: Response, final = false): void {
    const over = final || r.audioEndMs !== null;
    const text = over ? this.heard(r) : this.text(r);
    const voiced = over ? text.length : this.voiced(r);
    if (!text || voiced === 0 || (this.holdTimer !== null && r.trigger === "user_turn" && !r.shown)) return;
    const line = `${r.bargedIn ? "cut" : "said"}:${voiced}:${text}`;
    if (line === r.emitted) return;
    r.emitted = line;
    if (!r.shown) {
      r.shown = true;
      this.sink.began(r.id);
    }
    this.sink.emit({
      type: "agent",
      id: r.id,
      text,
      ...(voiced < text.length ? { voiced } : {}),
      ...(r.bargedIn ? { interrupted: true } : {}),
    });
  }

  /** How many characters of the reply its voice has said by now: whole words, none before it starts. */
  private voiced(r: Response): number {
    if (r.audioStartMs === null) return 0;
    return heardOf(this.text(r), this.sink.now() - r.audioStartMs).length;
  }

  /** Keeps the playing reply's line up with its voice, until the audio stops. */
  private pace(): void {
    if (this.pacer !== null) return;
    this.pacer = setInterval(() => {
      const r = this.playing === null ? undefined : this.responses.get(this.playing);
      if (r) this.showAgent(r);
      else this.stopPacing();
    }, PACE_TICK_MS);
  }

  private stopPacing(): void {
    if (this.pacer === null) return;
    clearInterval(this.pacer);
    this.pacer = null;
  }

  private heard(r: Response): string {
    const text = this.text(r);
    if (!r.bargedIn || r.audioStartMs === null || r.audioEndMs === null) return text;
    return heardOf(text, r.audioEndMs - r.audioStartMs);
  }

  private arm(): void {
    if (this.holdTimer !== null) return;
    this.holdTimer = setTimeout(() => this.release(), HOLD_MS);
  }

  /** Their turn is on screen, its transcript failed, or it is too late: show what was held. */
  private release(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    for (const r of this.responses.values()) if (!r.shown) this.showAgent(r);
  }

  private maybeFinish(r: Response): void {
    if (!r.done) return;
    if (r.audioStartMs !== null && r.audioEndMs === null) return;
    this.finish(r);
  }

  private finish(r: Response): void {
    if (!this.responses.has(r.id)) return;
    this.responses.delete(r.id);
    if (r.graceTimer !== null) clearTimeout(r.graceTimer);
    if (this.playing === r.id) this.stopPacing();
    // As it ended: all of it, or a reply cut off as what was heard, marked.
    this.showAgent(r, true);
    const generatedText = this.text(r);
    const text = this.heard(r);
    if (text) this.sink.heard("agent", text);
    this.sink.finished({
      trigger: r.trigger,
      spark: r.spark,
      cueAtMs: r.cueAtMs,
      audioStartMs: r.audioStartMs,
      audioEndMs: r.audioEndMs,
      endMeasured: r.endMeasured,
      createdAtMs: r.createdAtMs,
      firstTextMs: r.firstTextMs,
      generatedText,
      text,
      bargedIn: r.bargedIn,
      respondingToText: r.respondingToText,
      asrMs: r.asrMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    });
  }
}
