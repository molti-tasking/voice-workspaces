import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findSessionByCode, progressOf } from "@voicemural/db/study-session";
import {
  SessionCode,
  blocksFor,
  isSessionDisplay,
  resumeAt,
  scaledTimings,
  type ConversationDisplay,
} from "@voicemural/shared";
import { sessionTaskFor } from "@voicemural/talkback/study-task";
import { currentUser } from "@/lib/session";
import { StudyFrame } from "../../p/ui";
import { SessionFlow, type SessionBlockView } from "./session-flow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Study",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pilotIds(): string[] {
  return (process.env.STUDY_PILOT_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function viewsOf(blocks: readonly { position: number; display: ConversationDisplay; task: string }[]): SessionBlockView[] {
  return [...blocks]
    .sort((a, b) => a.position - b.position)
    .map((b) => {
      const task = sessionTaskFor(b.task);
      if (!task) throw new Error(`study block ${b.position} has a task not in the catalogue: ${b.task}`);
      if (!isSessionDisplay(b.display)) throw new Error(`study block ${b.position} has a view the session does not compare: ${b.display}`);
      return {
        position: b.position,
        display: b.display,
        task: { title: task.title, brief: task.brief, prompts: [...task.prompts] },
      };
    });
}

/**
 * The display study's session (`session-flow.tsx`), opened from an invite
 * link: `/study/session?code=…`. Standalone, like the Prolific pages: no dock,
 * no drive bar, nothing that leads out of it (lib/study/routes.ts).
 *
 * For the researchers, and never for a participant — outside production, or
 * signed in as a pilot account (`STUDY_PILOT_USER_IDS`):
 * - `?demo=1[&order=0-5]` walks through a whole session with the simulated
 *   conversation: no microphone, no AI, nothing saved.
 * - `?fast=10` runs the conversations' timings ten times faster.
 */
export default async function StudySessionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const user = await currentUser();
  const researcher = process.env.NODE_ENV !== "production" || (user !== null && pilotIds().includes(user.id));
  const timings = scaledTimings(researcher ? Number(first(params.fast) ?? 1) : 1);

  if (first(params.demo) === "1") {
    if (!researcher) notFound();
    const order = Number(first(params.order) ?? 0);
    return (
      <SessionFlow
        mode="demo"
        hasAccount={user !== null}
        resume={{ at: "consent" }}
        blocks={viewsOf(blocksFor(Number.isFinite(order) ? order : 0))}
        timings={timings}
        talkbackEnabled
      />
    );
  }

  const code = SessionCode.safeParse(first(params.code));
  const state = code.success ? await findSessionByCode(code.data) : null;
  if (!code.success || !state) {
    return (
      <StudyFrame title="This link does not work">
        <p>Please check that you opened the whole link you were sent, or ask the researchers for a new one.</p>
      </StudyFrame>
    );
  }

  const mine = user !== null && state.session.userId === user.id;
  if (!mine && state.session.completedAt) {
    return (
      <StudyFrame title="This session is complete">
        <p>Thank you for taking part. There is nothing more to do here.</p>
      </StudyFrame>
    );
  }

  return (
    <SessionFlow
      mode="live"
      code={code.data}
      hasAccount={user !== null}
      resume={mine ? resumeAt(progressOf(state)) : { at: "consent" }}
      blocks={viewsOf(state.blocks)}
      timings={timings}
      talkbackEnabled={process.env.NEXT_PUBLIC_TALKBACK_ENABLED === "true"}
    />
  );
}
