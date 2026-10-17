import type { Metadata } from "next";
import { part2StateFor } from "@voicemural/db/prolific";
import { loadDueProbes, scheduleRecallProbes } from "@voicemural/db/recall";
import { ProlificPid, ProlificRef } from "@voicemural/shared";
import { studyTaskFor } from "@voicemural/talkback/study-task";
import { completionCodeFor, completionUrlFor, prolificConfig } from "@/lib/study/prolific-config";
import { Completion, StudyFrame } from "../ui";
import { Part2Flow } from "./part2-flow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Study, part 2",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Part 2 of the Prolific study: what they remember of yesterday's
 * conversation. A free recall first, before any cue; then the drive's recall
 * probes; then the closing questions (PROLIFIC.md).
 *
 * Found by PID, not by cookie: part 2 may open in another browser.
 */
export default async function ProlificPart2Page({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  if (!prolificConfig().configured) {
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
      </StudyFrame>
    );
  }

  const state = await part2StateFor(pid.data);
  if (state.state === "unknown" || state.state === "part1_unfinished") {
    return (
      <StudyFrame eyebrow="Part 2 of 2" title="We could not find your first session">
        <p>
          Part 2 is only for people who finished part 1 with this Prolific ID. If you did, please message the
          researchers on Prolific.
        </p>
      </StudyFrame>
    );
  }
  if (state.state === "too_early") {
    return (
      <StudyFrame eyebrow="Part 2 of 2" title="Part 2 is not open yet">
        <p>
          It opens on{" "}
          {state.opensAt.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" })} (UTC).
          Please come back then.
        </p>
      </StudyFrame>
    );
  }

  const participant = state.participant;
  if (participant.part2CompletedAt) {
    return <Completion part={2} url={completionUrlFor(2)} code={completionCodeFor(2)} />;
  }

  // Subjects can reach the database after part 1's own scheduling ran; this
  // catches them, and is a no-op once a drive has probes.
  if (participant.captureSessionId) await scheduleRecallProbes(participant.captureSessionId);
  const probes = (await loadDueProbes(participant.userId)).filter(
    (p) => p.captureSessionId === participant.captureSessionId,
  );

  const ref = (value: string | undefined) => {
    const parsed = ProlificRef.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };
  return (
    <Part2Flow
      pid={pid.data}
      studyId={ref(first(params.STUDY_ID))}
      sessionId={ref(first(params.SESSION_ID))}
      sparks={participant.arm === "sparks"}
      taskTitle={studyTaskFor(participant.task)?.title ?? "the problem you talked about"}
      freeRecallDone={participant.freeRecallAt !== null}
      probes={probes.map((p) => ({ id: p.id, title: p.title, rated: p.confidence !== null }))}
    />
  );
}
