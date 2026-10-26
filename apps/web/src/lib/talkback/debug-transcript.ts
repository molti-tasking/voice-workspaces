import { formatOffset } from "@voicemural/shared";

/**
 * One conversation as plain text, for pasting into a bug report or a chat
 * with a coding assistant: everything that explains why it went the way it
 * did, in the order it happened.
 *
 * Two transcripts of their words, side by side where they matter: the
 * ledger's (Whisper, from the recorded audio, minutes later) as the line, and
 * the live one the screen and the topic titles were built from, under each
 * reply as what it answered. When the two disagree — another language, a
 * mishearing — that is usually the bug.
 */

export interface DebugDrive {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  title: string | null;
  sttLanguage: string | null;
  voiceId: string | null;
  condition: Record<string, unknown> | null;
  block: { display: string; task: string } | null;
  /** The ledger: their words from the recorded audio. */
  utterances: { startMs: number; text: string }[];
  turns: {
    seq: number;
    startMs: number;
    endMs: number;
    kind: string;
    text: string;
    generatedText: string;
    respondingToText: string | null;
    bargedIn: boolean;
    totalLatencyMs: number | null;
    configVersion: string | null;
    resolvedModel: string | null;
    trigger: string | null;
  }[];
  /** Moments the agent began to answer and was cut off before a word: no turn of their own. */
  silentAttempts: { offsetMs: number; trigger: string }[];
  floor: { offsetMs: number; kind: string; atConnect: boolean }[];
  subjects: { ordinal: number; title: string; visits: { startMs: number; endMs: number | null }[]; settled: boolean | null; kept: boolean }[];
  moments: { item: string; shownMs: number; answeredMs: number | null }[];
}

const at = (ms: number) => `[${formatOffset(ms)}]`;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function engineOf(drive: DebugDrive): string {
  const versions = [...new Set(drive.turns.map((t) => t.configVersion).filter(Boolean))];
  const models = [...new Set(drive.turns.map((t) => t.resolvedModel).filter(Boolean))];
  return [versions.join(", ") || "no agent turns", models.join(", ")].filter(Boolean).join(" · ");
}

function renderDrive(drive: DebugDrive, index: number, count: number): string {
  const out: string[] = [];
  const heading = count > 1 ? `## Drive ${index + 1} of ${count}` : "## Drive";
  out.push(`${heading}: ${drive.title ?? "(untitled)"}`);
  out.push(
    `id ${drive.id} · started ${drive.startedAt.toISOString()}` +
      (drive.endedAt ? ` · ${formatOffset(drive.endedAt.getTime() - drive.startedAt.getTime())} long` : " · still open"),
  );
  out.push(
    `engine ${engineOf(drive)} · transcription language ${drive.sttLanguage ?? "auto-detect"} · voice ${drive.voiceId ?? "default"}`,
  );
  if (drive.block) out.push(`display study block · view ${drive.block.display} · task ${drive.block.task}`);
  if (drive.condition) out.push(`condition ${JSON.stringify(drive.condition)}`);

  if (drive.subjects.length > 0) {
    out.push("", "### Topics");
    for (const s of drive.subjects) {
      const visits = s.visits.map((v) => `${formatOffset(v.startMs)}–${v.endMs === null ? "…" : formatOffset(v.endMs)}`);
      const state = [s.settled === null ? null : s.settled ? "settled" : "open", s.kept ? "kept" : null].filter(Boolean);
      out.push(`s${s.ordinal}. ${s.title} (${visits.join(", ")})${state.length ? ` — ${state.join(", ")}` : ""}`);
    }
  }

  type Entry = { ms: number; order: number; lines: string[] };
  const entries: Entry[] = [];
  for (const u of drive.utterances) entries.push({ ms: u.startMs, order: 1, lines: [`${at(u.startMs)} You: ${oneLine(u.text)}`] });
  for (const t of drive.turns) {
    const what = t.trigger && t.trigger !== "user_turn" ? ` (${t.trigger})` : t.kind !== "reply" ? ` (${t.kind})` : "";
    const lines = [`${at(t.startMs)} Assistant${what}: ${oneLine(t.text)}`];
    if (t.bargedIn) lines.push(`        cut off after ${formatOffset(t.endMs - t.startMs)}; it had generated: ${oneLine(t.generatedText)}`);
    if (t.respondingToText) lines.push(`        answering the live transcript: «${oneLine(t.respondingToText)}»`);
    if (t.totalLatencyMs !== null) {
      const since = t.trigger === "poke" ? "the poke" : t.trigger === "opening" ? "it was asked to open" : "their turn ended";
      lines.push(`        first sound ${t.totalLatencyMs} ms after ${since}`);
    }
    entries.push({ ms: t.startMs, order: 2, lines });
  }
  for (const a of drive.silentAttempts) {
    entries.push({ ms: a.offsetMs, order: 3, lines: [`${at(a.offsetMs)} (began to answer${a.trigger !== "user_turn" ? ` a ${a.trigger}` : ""}, cut off before a word)`] });
  }
  for (const f of drive.floor) {
    const what = f.kind === "poke" ? "they poked" : f.atConnect ? `connected, floor ${f.kind}` : f.kind === "locked" ? "they locked it" : "they unlocked it";
    entries.push({ ms: f.offsetMs, order: 0, lines: [`${at(f.offsetMs)} (${what})`] });
  }
  for (const s of drive.subjects) {
    for (const v of s.visits) entries.push({ ms: v.startMs, order: -1, lines: [`${at(v.startMs)} — topic s${s.ordinal}: ${s.title} —`] });
  }
  for (const m of drive.moments) {
    const answered = m.answeredMs === null ? "not answered" : `until ${formatOffset(m.answeredMs)}`;
    entries.push({ ms: m.shownMs, order: 0, lines: [`${at(m.shownMs)} (study: ${m.item}, ${answered})`] });
  }
  entries.sort((a, b) => a.ms - b.ms || a.order - b.order);

  out.push("", "### Timeline", "You = the ledger (Whisper, from the recorded audio). Assistant = what it said.");
  for (const e of entries) out.push(...e.lines);
  if (drive.utterances.length === 0) out.push("(no ledger lines: the worker has not transcribed this drive's audio)");
  return out.join("\n");
}

export function renderDebugTranscript(drives: readonly DebugDrive[]): string {
  const first = drives[0];
  if (!first) return "";
  const title = drives.at(-1)?.title ?? first.title ?? "(untitled)";
  return [
    `# Conversation: ${title}`,
    `Exported ${new Date().toISOString()} for debugging. Times are from the start of each drive.`,
    "",
    drives.map((d, i) => renderDrive(d, i, drives.length)).join("\n\n"),
    "",
  ].join("\n");
}
