import type { Floor } from "@/lib/recorder/floor-store";
import type { FinishedTurn } from "./events";
import type { Visit } from "./titler";

/**
 * What the container used to write about a drive, written from the browser:
 * the agent's turns and its decisions, the floor, the drive's title and its
 * subjects' visits. Through the same routes (`/api/realtime/agent-turn`,
 * `/decision`, `/floor`, `/title`, `/subject`) with the drive's ticket, so the
 * same checks apply — ownership, and nothing written into a drive that has
 * ended — and every reader of those rows (the views' replay, the study's
 * export and judge, the metrics, the echo filter) reads this engine's drives
 * as it read the container's.
 *
 * Fire and forget, and never in the way of the conversation. A 409 means the
 * drive is over; nothing more is written after one.
 */

export interface CallRecords {
  ticket: string | null;
  startedAtEpochMs: number;
  seq: { turn: number; decision: number; floor: number };
  configVersion: string;
  requestedModel: string;
  resolvedModel: string | null;
}

export class DriveRecords {
  private turnSeq: number;
  private decisionSeq: number;
  private floorSeq: number;
  private opportunity = 0;
  private ended = false;

  constructor(private readonly call: CallRecords) {
    this.turnSeq = call.seq.turn;
    this.decisionSeq = call.seq.decision;
    this.floorSeq = call.seq.floor;
  }

  private offset(wallMs: number): number {
    return Math.max(0, Math.round(wallMs - this.call.startedAtEpochMs));
  }

  private async post(route: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!this.call.ticket || this.ended) return null;
    try {
      const res = await fetch(`/api/realtime/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: this.call.ticket, ...body }),
        // A turn finished as the page goes away still lands.
        keepalive: true,
      });
      if (res.status === 409) {
        this.ended = true;
        return null;
      }
      if (!res.ok) {
        console.warn(`[talkback:realtime] ${route} not recorded — ${res.status}`);
        return null;
      }
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (err) {
      console.warn(`[talkback:realtime] ${route} not recorded — ${String(err)}`);
      return null;
    }
  }

  /** One agent turn, and the decision it was: spoke, or was spoken over. */
  async turn(t: FinishedTurn): Promise<void> {
    const startWall = t.audioStartMs ?? t.createdAtMs;
    const start = this.offset(startWall);
    const end = this.offset(t.audioEndMs ?? startWall);
    // From the moment it answers to its first sound: the end of their turn as
    // the provider heard it, or the poke or opening sent. The provider's own
    // wait for the end of their turn is not in it.
    const latency = t.audioStartMs !== null ? Math.max(0, Math.round(t.audioStartMs - t.cueAtMs)) : undefined;
    let agentTurnId: string | undefined;
    // Only what was heard is a turn; a reply cut off before a word is a decision alone.
    if (t.text) {
      const seq = this.turnSeq++;
      const recorded = await this.post("agent-turn", {
        seq,
        startOffsetMs: start,
        endOffsetMs: Math.max(start, end),
        endOffsetMeasured: t.endMeasured,
        text: t.text,
        generatedText: t.generatedText || t.text,
        kind: t.trigger === "opening" ? "proactive_prompt" : "reply",
        ...(t.respondingToText ? { respondingToText: t.respondingToText } : {}),
        ...(t.bargedIn ? { bargedIn: true, truncatedAtMs: Math.max(0, end - start) } : {}),
        configVersion: this.call.configVersion,
        requestedModel: this.call.requestedModel,
        ...(this.call.resolvedModel ? { resolvedModel: this.call.resolvedModel } : {}),
        ...(t.asrMs !== null ? { asrMs: Math.round(t.asrMs) } : {}),
        ...(t.firstTextMs !== null ? { ttftMs: Math.max(0, Math.round(t.firstTextMs - t.createdAtMs)) } : {}),
        ...(latency !== undefined ? { totalLatencyMs: latency } : {}),
        ...(t.inputTokens !== null ? { promptTokens: t.inputTokens } : {}),
        ...(t.outputTokens !== null ? { completionTokens: t.outputTokens } : {}),
      });
      if (typeof recorded?.id === "string") agentTurnId = recorded.id;
    }
    await this.post("decision", {
      seq: this.decisionSeq++,
      offsetMs: this.offset(t.cueAtMs),
      opportunitySeq: this.opportunity++,
      attempt: 0,
      trigger: t.trigger,
      outcome: t.bargedIn || !t.text ? "interrupted" : "spoke",
      configVersion: this.call.configVersion,
      ...(latency !== undefined ? { latencyMs: latency } : {}),
      ...(t.spark ? { sparkKind: t.spark.kind, subjectKey: `s${t.spark.ordinal}` } : {}),
      ...(agentTurnId ? { agentTurnId } : {}),
    });
  }

  /** Who may talk changed, a poke, or the floor a connection started with. */
  floor(kind: Floor | "poke", atConnect = false): void {
    void this.post("floor", {
      seq: this.floorSeq++,
      offsetMs: this.offset(Date.now()),
      kind,
      ...(atConnect ? { atConnect: true } : {}),
      configVersion: this.call.configVersion,
    });
  }

  title(title: string): void {
    void this.post("title", { title });
  }

  visit(visit: Visit): void {
    void this.post("subject", { ...visit });
  }

  /** A new connection to the same drive: its own counters, resumed by the server, and the same records. */
  resume(call: CallRecords): DriveRecords {
    // The server's counters, unless a write of this connection's is still on
    // its way and they have not seen it yet.
    const next = new DriveRecords({
      ...call,
      seq: {
        turn: Math.max(call.seq.turn, this.turnSeq),
        decision: Math.max(call.seq.decision, this.decisionSeq),
        floor: Math.max(call.seq.floor, this.floorSeq),
      },
    });
    next.opportunity = this.opportunity;
    next.ended = this.ended;
    return next;
  }
}
