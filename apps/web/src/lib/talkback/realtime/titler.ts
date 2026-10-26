import type { ConversationMessage } from "../conversation";

/**
 * The live topic title, in the browser: `TopicTitle` from bot.py, for an
 * engine that has no container to run it.
 *
 * The same rules, so the views get the same sections from either engine:
 * named off a short window of recent speech (both sides, the agent's marked
 * "(you said)"), at most one call in flight and no queue, once per finished
 * turn of theirs and otherwise not more often than the thresholds below;
 * a subject the talk comes back to returns under its old title and ordinal;
 * each title says from which turn the new subject began (`rehomeFrom`); each
 * visit is kept, and a subject left is judged settled or open.
 *
 * The calls go to `/api/realtime/topic` and the records to `/title` and
 * `/subject`, through `io`, so this stays a plain object a test can drive.
 */

export interface Visit {
  ordinal: number;
  title: string;
  startOffsetMs: number;
  endOffsetMs?: number;
}

export interface TitlerIO {
  /** Wall clock, ms. */
  now(): number;
  /** The cleaned title for this window, or null for no change. */
  name(current: string | null, earlier: readonly string[], recent: string): Promise<string | null>;
  /** Whether the subject was settled, or null when it could not be told. */
  judge(title: string, said: string): Promise<boolean | null>;
  emit(message: ConversationMessage): void;
  saveTitle(title: string): void;
  saveVisit(visit: Visit): void;
}

/** How many earlier titles the model is shown. */
const EARLIER_SHOWN = 16;
/** How much recent speech it is shown: the last minute or two, not the drive. */
const WINDOW_CHARS = 900;
/** Enough new speech in a finished turn to be worth naming; below it a turn is a "yes". */
const CALL_AFTER_TURN_CHARS = 20;
/** A slow talker still gets a title: any new speech at all, after this long. */
const CALL_AFTER_MS = 30_000;
/** The part of a visit the settled check is shown: its most recent, where a decision lands. */
const SETTLED_WINDOW_CHARS = 1500;

const fold = (title: string) => title.toLocaleLowerCase();

export class Titler {
  private title: string | null = null;
  private earlier: string[] = [];
  private readonly ordinals = new Map<string, number>();
  /** The names they renamed subjects FROM, by ordinal: the model may still use them. */
  private readonly renamedFrom = new Map<string, number>();
  private window = "";
  private visitText = "";
  private newChars = 0;
  private lastCall: number;
  private visitStart: number | null = null;
  private firstSpeechMs: number | null = null;
  /** The first turn begun since the last naming call, and when. */
  private sinceMark: string | null = null;
  private sinceMarkMs: number | null = null;
  private inFlight = false;
  private again = false;
  private closed = false;

  constructor(
    private readonly io: TitlerIO,
    private readonly startedAtMs: number,
    seeded: readonly { title: string; ordinal?: number }[] = [],
  ) {
    this.lastCall = io.now();
    for (const { title, ordinal } of seeded.slice(-40)) {
      const name = title.trim().slice(0, 64);
      if (!name) continue;
      this.ordinals.set(fold(name), ordinal && ordinal > 0 ? ordinal : this.nextOrdinal());
      if (this.title !== null) this.remember(this.title);
      this.title = name;
    }
    // A reconnect starts a new visit to the subject it was on.
    if (this.title !== null) this.visitStart = this.offset(io.now());
  }

  /** A turn has appeared in the conversation (either side): the mark's candidate. */
  began(turnId: string): void {
    if (this.sinceMark === null) {
      this.sinceMark = turnId;
      this.sinceMarkMs = this.io.now();
    }
  }

  /** A turn has finished. Theirs may name the subject; the agent's only joins the window. */
  heard(who: "user" | "agent", text: string): void {
    const said = text.trim();
    if (!said || this.closed) return;
    if (who === "user" && this.firstSpeechMs === null) this.firstSpeechMs = this.io.now();
    this.append(who === "agent" ? `(you said) ${said}` : said);
    if (who === "user") this.maybeName();
  }

  titleFor(ordinal: number): string | null {
    if (this.title !== null && this.ordinals.get(fold(this.title)) === ordinal) return this.title;
    return this.earlier.find((t) => this.ordinals.get(fold(t)) === ordinal) ?? null;
  }

  /**
   * They renamed subject `ordinal` on their screen: that name from now on, for
   * the model and for a return. Refused for a subject not named here, or a name
   * another subject has.
   */
  rename(ordinal: number, title: string): boolean {
    const name = title.split(/\s+/).filter(Boolean).join(" ").slice(0, 64);
    const old = this.titleFor(ordinal);
    if (!name || old === null) return false;
    const holder = this.ordinals.get(fold(name));
    if (holder !== undefined && holder !== ordinal) return false;
    this.ordinals.delete(fold(old));
    this.ordinals.set(fold(name), ordinal);
    if (fold(old) !== fold(name)) this.renamedFrom.set(fold(old), ordinal);
    this.renamedFrom.delete(fold(name));
    if (this.title === old) this.title = name;
    this.earlier = this.earlier.map((t) => (t === old ? name : t));
    return true;
  }

  /** The drive is over: close the visit, and make no more calls or records. */
  close(): void {
    if (this.closed) return;
    this.closeVisit(this.offset(this.io.now()));
    this.closed = true;
  }

  private offset(wallMs: number): number {
    return Math.max(0, Math.round(wallMs - this.startedAtMs));
  }

  private nextOrdinal(): number {
    return Math.max(0, ...this.ordinals.values()) + 1;
  }

  private remember(title: string): void {
    this.earlier = [...this.earlier.filter((t) => fold(t) !== fold(title)), title];
  }

  private append(text: string): void {
    this.window = `${this.window} ${text}`.trim().slice(-WINDOW_CHARS);
    this.newChars += text.length;
    this.visitText = `${this.visitText}\n${text}`.trim().slice(-SETTLED_WINDOW_CHARS);
  }

  private maybeName(): void {
    const due =
      this.newChars >= CALL_AFTER_TURN_CHARS || (this.newChars > 0 && this.io.now() - this.lastCall >= CALL_AFTER_MS);
    if (!due) return;
    if (this.inFlight) {
      // Named again when the call lands, so this turn is not filed by
      // whichever call happens next.
      this.again = true;
      return;
    }
    void this.nameOnce();
  }

  private async nameOnce(): Promise<void> {
    this.inFlight = true;
    const window = this.window;
    this.newChars = 0;
    this.lastCall = this.io.now();
    // Taken with the window: these are the turns this call is about.
    const rehomeFrom = this.sinceMark;
    const markMs = this.sinceMarkMs;
    this.sinceMark = null;
    this.sinceMarkMs = null;
    try {
      const named = await this.io.name(this.title, this.earlier.slice(-EARLIER_SHOWN), window).catch(() => null);
      if (named !== null && !this.closed) this.adopt(named, rehomeFrom, markMs);
    } finally {
      this.inFlight = false;
    }
    if (this.again && !this.closed) {
      this.again = false;
      this.maybeName();
    }
  }

  private adopt(named: string, rehomeFrom: string | null, markMs: number | null): void {
    let title = named;
    // A subject they renamed, named by the title it had before: theirs.
    const renamed = this.renamedFrom.get(fold(title));
    if (renamed !== undefined) {
      title = this.titleFor(renamed) ?? title;
      if (this.title !== null && fold(title) === fold(this.title)) return;
    }
    if (this.title !== null && fold(title) === fold(this.title)) return;
    // A subject come back: the earlier title exactly, which is how the screen
    // finds its section.
    const returned = this.earlier.find((t) => fold(t) === fold(title));
    if (returned !== undefined) title = returned;
    else this.ordinals.set(fold(title), this.nextOrdinal());
    const ordinal = this.ordinals.get(fold(title))!;

    // The visit: from the turn that changed the subject, or, for the first
    // title, which names everything said before it, from their first words.
    const now = this.io.now();
    let startMs = markMs ?? now;
    if (this.title === null && this.firstSpeechMs !== null) startMs = Math.min(startMs, this.firstSpeechMs);
    const start = this.offset(startMs);
    const left = this.title;
    this.closeVisit(start);
    if (left !== null) {
      const leftOrdinal = this.ordinals.get(fold(left));
      const said = this.visitText;
      if (leftOrdinal !== undefined && said) {
        void this.io
          .judge(left, said)
          .then((settled) => {
            if (settled !== null) this.io.emit({ type: "state", ordinal: leftOrdinal, settled });
          })
          .catch(() => undefined);
      }
      // A first title names everything said before it, so that speech stays.
      this.visitText = "";
      this.remember(left);
    }
    this.earlier = this.earlier.filter((t) => fold(t) !== fold(title));
    this.title = title;
    this.visitStart = start;

    this.io.emit({ type: "title", title, ordinal, ...(rehomeFrom ? { rehomeFrom } : {}) });
    this.io.saveTitle(title);
    this.io.saveVisit({ ordinal, title, startOffsetMs: start });
  }

  private closeVisit(end: number): void {
    if (this.title === null || this.visitStart === null || this.closed) return;
    const ordinal = this.ordinals.get(fold(this.title));
    if (ordinal === undefined) return;
    this.io.saveVisit({
      ordinal,
      title: this.title,
      startOffsetMs: this.visitStart,
      endOffsetMs: Math.max(end, this.visitStart),
    });
    this.visitStart = null;
  }
}
