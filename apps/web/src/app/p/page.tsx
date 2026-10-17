import type { Metadata } from "next";
import { findParticipantByUser } from "@voicemural/db/prolific";
import { PROLIFIC_ARMS, ProlificPid, ProlificRef, type ProlificArm } from "@voicemural/shared";
import { PROLIFIC_TASKS } from "@voicemural/talkback/study-task";
import { currentUser } from "@/lib/session";
import { completionCodeFor, completionUrlFor, prolificConfig } from "@/lib/study/prolific-config";
import { Part1Flow } from "./part1-flow";
import { Completion, StudyFrame } from "./ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Study",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Part 1 of the Prolific study: consent, a microphone check, the task, one
 * conversation, and a single question at the end (PROLIFIC.md).
 *
 * Prolific opens this with `PROLIFIC_PID`, `STUDY_ID` and `SESSION_ID` in the
 * URL. Outside production `?arm=control|sparks` pins the arm, so a researcher
 * can walk through either one.
 */
export default async function ProlificPart1Page({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const config = prolificConfig();

  if (!config.configured) {
    return (
      <StudyFrame title="This study is not open right now">
        <p>Please come back later, or message the researchers on Prolific.</p>
      </StudyFrame>
    );
  }

  const pid = ProlificPid.safeParse(first(params.PROLIFIC_PID));
  if (!pid.success) {
    return (
      <StudyFrame title="Please open this study from Prolific">
        <p>This page needs the link from the Prolific study page, which carries your Prolific ID.</p>
        {process.env.NODE_ENV !== "production" && (
          <p className="text-sm text-fg/60">
            Testing locally? Add <code>?PROLIFIC_PID=test-yourname</code> to the address.
          </p>
        )}
      </StudyFrame>
    );
  }

  const ref = (value: string | undefined) => {
    const parsed = ProlificRef.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };
  const armParam = first(params.arm);
  const pinnedArm =
    config.allowArmParam && (PROLIFIC_ARMS as readonly string[]).includes(armParam ?? "")
      ? (armParam as ProlificArm)
      : undefined;

  // Back on this page in the same browser: pick up where they were.
  const user = await currentUser();
  const participant = user ? await findParticipantByUser(user.id) : null;
  const mine = participant?.prolificPid === pid.data ? participant : null;
  if (mine?.part1CompletedAt) {
    return (
      <Completion
        part={1}
        url={completionUrlFor(1)}
        code={completionCodeFor(1)}
        next="You have already finished part 1. We will invite you to part 2 on Prolific."
      />
    );
  }

  const task = PROLIFIC_TASKS[config.task];
  return (
    <Part1Flow
      pid={pid.data}
      studyId={ref(first(params.STUDY_ID))}
      sessionId={ref(first(params.SESSION_ID))}
      pinnedArm={pinnedArm}
      hasAccount={user !== null}
      enrolledArm={mine?.arm ?? null}
      task={{ title: task.title, brief: task.brief, prompts: [...task.prompts], planTitle: task.planTitle }}
      minMinutes={config.minMinutes}
      targetMinutes={config.targetMinutes}
      talkbackEnabled={process.env.NEXT_PUBLIC_TALKBACK_ENABLED === "true"}
    />
  );
}
