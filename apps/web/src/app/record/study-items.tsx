"use client";

import { useCallback, useState } from "react";
import {
  STUDY_SCALE_MAX,
  itemsForPhase,
  type StudyItem,
  type StudyResponsePhase,
} from "@voicemural/shared";

/**
 * The ratings that follow a drive, under the debrief's spoken questions.
 *
 * WHY THEY EXIST. Pilot 01 measured only the system — latency, turn counts,
 * decline rate — and every one of those numbers was healthy on a drive that
 * left the participant waiting in silence with no way to tell working from
 * broken. Whether the system RELIEVED them, and whether they were still the
 * one doing the thinking, are not derivable from the ledger. They have to be
 * asked, in the seconds after a drive, or they will not be answered at all.
 *
 * NOTHING BEFORE IT ANY MORE. Mental load was also asked before Record, for a
 * pre/post change. That item lived only on the record screen's setup, which a
 * drive started from the dock never passes through, and every drive now opens
 * straight into the conversation — so it was dropped rather than asked a few
 * seconds into the recording (6 Oct 2026). See `MENTAL_LOAD`.
 *
 * NOT THE DEBRIEF. The three spoken questions are separate, older, and
 * promised verbatim on `/study` — they live in `@/lib/study/debrief` and are
 * answered ALOUD inside the recording. These are taps on a scale, and they sit
 * beside those questions rather than replacing them: a number the participant
 * chooses is not content, so it needs no window and crosses the privacy
 * boundary unchanged.
 *
 * DESIGNED FOR A PHONE IN A CRADLE, like everything else here: one row of
 * large targets, no typing, nothing to scroll past to reach the answer, and
 * every item skippable by simply carrying on. A study instrument that makes
 * somebody stop and read is a study instrument that changes what it measures.
 */

async function record(body: {
  captureSessionId: string | null;
  phase: StudyResponsePhase;
  item: string;
  value: number;
}): Promise<void> {
  try {
    await fetch("/api/study/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, scaleMax: STUDY_SCALE_MAX }),
    });
  } catch {
    // A rating that does not reach the server is a missing cell in the
    // analysis. It is never worth interrupting a drive over.
  }
}

/** One 1–7 item as a row of targets. Answering twice corrects the answer. */
function Scale({
  item,
  value,
  onPick,
}: {
  item: StudyItem;
  value: number | null;
  onPick: (value: number) => void;
}) {
  return (
    <fieldset className="w-full">
      <legend className="mb-2 text-sm text-fg/70">{item.question}</legend>
      <div className="flex gap-1.5">
        {Array.from({ length: STUDY_SCALE_MAX }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            aria-pressed={value === n}
            className={[
              "h-11 flex-1 cursor-pointer rounded-lg font-mono text-sm transition-colors",
              value === n
                ? "bg-fg text-[var(--color-canvas)]"
                : "bg-fg/10 text-fg/70 hover:bg-fg/20",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg/55">
        <span>{item.anchors[0]}</span>
        <span>{item.anchors[1]}</span>
      </div>
    </fieldset>
  );
}

/**
 * The post items, shown under the three spoken questions while the microphone
 * is still open.
 *
 * Under rather than over: the spoken answers are what the debrief is for and
 * what the window is measured against, and a row of number buttons above them
 * would make the drive end with a form. These are answered while the
 * participant thinks about what to say.
 */
export function PostDriveItems({ captureSessionId }: { captureSessionId: string | null }) {
  const [picked, setPicked] = useState<Record<string, number>>({});

  const pick = useCallback(
    (item: string, value: number) => {
      setPicked((prev) => ({ ...prev, [item]: value }));
      void record({ captureSessionId, phase: "post", item, value });
    },
    [captureSessionId],
  );

  return (
    <div className="mt-4 space-y-4 border-t border-amber-500/20 pt-4">
      {itemsForPhase("post").map((item) => (
        <Scale
          key={item.key}
          item={item}
          value={picked[item.key] ?? null}
          onPick={(value) => pick(item.key, value)}
        />
      ))}
    </div>
  );
}
