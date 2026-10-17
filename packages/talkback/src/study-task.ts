/**
 * The fixed tasks of the Prolific recall study (PROLIFIC.md).
 *
 * Every participant talks about the same problem, so what they remember a day
 * later can be scored against the same set of ideas. A good task here is one
 * nobody is an expert in, has several parts that become separate subjects of
 * the conversation, and leaves room for ideas from both sides — the question
 * the study asks is about the ones that came from the agent.
 *
 * Each task has two halves: `brief`, which the participant reads before the
 * conversation, and `agentSection`, composed into the agent's prompt for that
 * participant's drive. The section is identical in both arms; only the sparks
 * differ. Pure, so the pages and the session route share one copy.
 */

export interface StudyTask {
  id: string;
  /** Shown above the conversation as a reminder. */
  title: string;
  /** What the participant reads before starting: the problem, in plain words. */
  brief: string;
  /** The parts worth covering, shown as a checklist they may ignore. */
  prompts: readonly string[];
  /** Composed into the agent's system prompt (see `/api/realtime/session`). */
  agentSection: string;
}

/** Shared by every task: the setting, and what the agent must NOT do for the measure to hold. */
const STUDY_SETTING = `THIS CONVERSATION IS PART OF A STUDY
They are a study participant at a computer, and this conversation IS their main task: they are working through the problem below by talking it over with you. So, unlike usual, contribute. When they ask, answer with substance. When they stall, offer one concrete idea or consideration they have not mentioned — a fact, an option, a trade-off — rather than another question. Let them lead and do the deciding.

- Stay on the task. If they drift far from it, one short nudge back is fine.
- Never summarise the conversation or list what has been covered, and never offer to: not at the end, not when asked "where are we?" — then name only the part they are on and what is still open about it.
- Do not write drafts, notes or lists for them to keep. If they ask, say briefly that this study is about thinking it through out loud.
- If they ask whether they are done or how long to go on, say the page tells them when they can finish.`;

export const PROLIFIC_TASKS = {
  heat: {
    id: "heat",
    title: "A town getting ready for hotter summers",
    brief:
      "Imagine a small town of about 20,000 people that expects longer and hotter heatwaves over the next ten years. " +
      "Think through, out loud and together with the assistant, how the town could keep its residents safe and comfortable. " +
      "There is no right answer and you do not need any expert knowledge. Ask the assistant for facts or ideas whenever you like.",
    prompts: [
      "Who in the town is most at risk, and why?",
      "What could the town do this summer, quickly and cheaply?",
      "What could it change over the next ten years?",
      "What would you do first, and what would you leave out?",
    ],
    agentSection: `${STUDY_SETTING}

THE PROBLEM
A small town of about 20,000 people expects longer and hotter heatwaves over the next ten years. They are working out how the town could keep its residents safe and comfortable: who is most at risk, what can be done quickly this summer, what could change over ten years, and what to prioritise. There is no right answer, and they are not experts.`,
  },
} as const satisfies Record<string, StudyTask>;

export type StudyTaskId = keyof typeof PROLIFIC_TASKS;

/** The task every new participant gets. One today; a second would be assigned here. */
export const DEFAULT_STUDY_TASK: StudyTaskId = "heat";

export function isStudyTaskId(value: unknown): value is StudyTaskId {
  return typeof value === "string" && Object.hasOwn(PROLIFIC_TASKS, value);
}

/** A stored task id as its task, or null for an id no longer in the catalogue. */
export function studyTaskFor(id: string | null | undefined): StudyTask | null {
  return isStudyTaskId(id) ? PROLIFIC_TASKS[id] : null;
}
