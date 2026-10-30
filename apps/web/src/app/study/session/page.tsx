import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  activeDesign,
  designPlan,
  findDesign,
  findSessionByCode,
  findSessionByPid,
  progressOf,
} from "@voicemural/db/study-session";
import {
  LEGACY_DESIGN,
  ProlificPid,
  ProlificRef,
  SESSION_BLOCKS,
  SessionCode,
  blocksFor,
  cellCount,
  resumeAt,
  scaledTimings,
  type SessionProlific,
  type SessionTimings,
} from "@voicemural/shared";
import { currentUser } from "@/lib/session";
import { isResearcher } from "@/lib/study/researchers";
import { blockView, completionCodeOf, completionCodeRequired, completionFor } from "@/lib/study/session-view";
import { StudyFrame } from "../../p/ui";
import { SessionFlow } from "./session-flow";

export const dynamic = "force-dynamic";

/**
 * Nothing of the app's own name or pitch: no "— Souffleur" in the tab, and
 * an invite link pasted into a chat must not unfurl as "think out loud while
 * you drive". A page's `openGraph` and `twitter` replace the root's whole
 * (images included), so both are set, with no image.
 */
const STUDY_TITLE = "A research study";
const STUDY_DESCRIPTION = "A short conversation with a voice assistant, and a few questions about it.";

export const metadata: Metadata = {
  title: { absolute: STUDY_TITLE },
  description: STUDY_DESCRIPTION,
  applicationName: null,
  appleWebApp: null,
  manifest: null,
  openGraph: { type: "website", title: STUDY_TITLE, description: STUDY_DESCRIPTION },
  twitter: { card: "summary", title: STUDY_TITLE, description: STUDY_DESCRIPTION },
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

type Viewer = Awaited<ReturnType<typeof currentUser>>;

const talkbackEnabled = () => process.env.NEXT_PUBLIC_TALKBACK_ENABLED === "true";
/** Whether the agent's turns go to Langfuse (`langfuse-live.ts`), for the consent to say so. */
const conversationLogged = () => Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

/**
 * The display study's session (`session-flow.tsx`). Standalone, like the
 * Prolific pages: no dock, no drive bar, nothing that leads out of it
 * (lib/study/routes.ts). Two ways in:
 *
 * - `?code=…`: an invite made on /researcher or by `pnpm study:session invite`.
 * - `?PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=…`: Prolific's link, the one study
 *   URL every participant gets. Their session is made when they consent, in
 *   the setup that is running; the end hands them its completion code.
 *
 * For the researchers, and never for a participant — outside production, or
 * signed in as a researcher (`RESEARCHER_USER_IDS`) or a pilot account
 * (`STUDY_PILOT_USER_IDS`); /researcher links each cell's walkthrough:
 * - `?demo=1[&design=name][&order=cell]` walks through a session in that
 *   cell of that setup (a draft's too; the active one by default), with the
 *   simulated conversation: no microphone, no AI, nothing saved.
 * - `?fast=10` runs the conversation's timings ten times faster.
 */
export default async function StudySessionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const user = await currentUser();
  const researcher =
    process.env.NODE_ENV !== "production" || (user !== null && (pilotIds().includes(user.id) || isResearcher(user.id)));
  const timings = scaledTimings(researcher ? Number(first(params.fast) ?? 1) : 1);

  if (first(params.demo) === "1") {
    if (!researcher) notFound();
    const name = first(params.design);
    const design = name ? await findDesign(name) : await activeDesign();
    if (!design || cellCount(designPlan(design)) === 0) {
      return (
        <StudyFrame title="No such setup">
          <p>Name a setup that has views and tasks, or make one active on the researchers&apos; page.</p>
        </StudyFrame>
      );
    }
    const cell = Number(first(params.order) ?? 0);
    return (
      <SessionFlow
        mode="demo"
        hasAccount={user !== null}
        resume={{ at: "consent" }}
        block={blockView(blocksFor(designPlan(design), Number.isFinite(cell) ? cell : 0)[0]!)}
        timings={timings}
        talkbackEnabled
      />
    );
  }

  if (first(params.code) !== undefined) return invitePage(first(params.code), user, timings);
  if (first(params.PROLIFIC_PID) !== undefined) return prolificPage(params, user, timings);
  return (
    <StudyFrame title="This link does not work">
      <p>Please check that you opened the whole link you were sent, or ask the researchers for a new one.</p>
    </StudyFrame>
  );
}

async function invitePage(raw: string | undefined, user: Viewer, timings: SessionTimings) {
  const code = SessionCode.safeParse(raw);
  const state = code.success ? await findSessionByCode(code.data) : null;
  if (!code.success || !state) {
    return (
      <StudyFrame title="This link does not work">
        <p>Please check that you opened the whole link you were sent, or ask the researchers for a new one.</p>
      </StudyFrame>
    );
  }

  // A session-1 invite: four conversations, which this page no longer walks.
  if (state.session.design === LEGACY_DESIGN || state.blocks.length !== SESSION_BLOCKS) {
    return (
      <StudyFrame title="This link does not work any more">
        <p>Please ask the researchers for a new one.</p>
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
      entry={{ code: code.data }}
      hasAccount={user !== null}
      resume={mine ? resumeAt(progressOf(state)) : { at: "consent" }}
      block={blockView(state.blocks[0]!)}
      timings={timings}
      talkbackEnabled={talkbackEnabled()}
      conversationLogged={conversationLogged()}
    />
  );
}

async function prolificPage(params: Search, user: Viewer, timings: SessionTimings) {
  const pid = ProlificPid.safeParse(first(params.PROLIFIC_PID));
  if (!pid.success) {
    return (
      <StudyFrame title="Please open this study from Prolific">
        <p>The link is missing your Prolific ID. Please start the study again from Prolific.</p>
      </StudyFrame>
    );
  }
  // Kept when they come as Prolific sends them, dropped otherwise: they only help match the submission.
  const ref = (value: string | string[] | undefined) => {
    const parsed = ProlificRef.safeParse(first(value));
    return parsed.success ? parsed.data : undefined;
  };
  const prolific: SessionProlific = { pid: pid.data, studyId: ref(params.STUDY_ID), sessionId: ref(params.SESSION_ID) };

  const state = await findSessionByPid(pid.data);
  if (state && user !== null && state.session.userId === user.id) {
    return (
      <SessionFlow
        mode="live"
        entry={{ prolific }}
        hasAccount
        resume={resumeAt(progressOf(state))}
        block={blockView(state.blocks[0]!)}
        completion={completionFor(state.session, await findDesign(state.session.design))}
        timings={timings}
        talkbackEnabled={talkbackEnabled()}
        conversationLogged={conversationLogged()}
      />
    );
  }
  if (state?.session.completedAt) {
    return (
      <StudyFrame title="This session is complete">
        <p>Thank you for taking part. If you did not get your completion code, please message the researchers on Prolific.</p>
      </StudyFrame>
    );
  }
  if (!state) {
    // Nobody starts a session that cannot be handed in: no setup running, or none to pay with.
    const design = await activeDesign();
    if (!design || (completionCodeRequired() && !completionCodeOf(design))) {
      return (
        <StudyFrame title="This study is not open right now">
          <p>Please return it on Prolific. Sorry for the trouble.</p>
        </StudyFrame>
      );
    }
  }

  return (
    <SessionFlow
      mode="live"
      entry={{ prolific }}
      hasAccount={user !== null}
      resume={{ at: "consent" }}
      // Made when they consent, unless another browser of theirs already did.
      block={state ? blockView(state.blocks[0]!) : null}
      timings={timings}
      talkbackEnabled={talkbackEnabled()}
      conversationLogged={conversationLogged()}
    />
  );
}
