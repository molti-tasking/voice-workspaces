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

import { isSessionTaskId, type SessionTaskId } from "@voicemural/shared";

export interface StudyTask {
  id: string;
  /** Shown above the conversation as a reminder. */
  title: string;
  /** What the participant reads before starting: the problem, in plain words. */
  brief: string;
  /** The parts worth covering, shown as a checklist they may ignore. */
  prompts: readonly string[];
  /** What the plan is called: the agent titles its one draft this, and the screen names it. */
  planTitle: string;
  /** Composed into the agent's system prompt (see `/api/realtime/session`). */
  agentSection: string;
}

/** Shared by every task: the setting, and what the agent must NOT do for the measure to hold. */
const STUDY_SETTING = `THIS CONVERSATION IS PART OF A STUDY
They are a study participant working through the problem below by talking it over with you. Let them lead and do the deciding; you bring ideas, knowledge and an honest view.

- Stay on the task. If they drift far from it, one short nudge back is fine.
- Never summarise the conversation or list what has been covered, and never offer to: not at the end, not when asked "where are we?" — then name only the part they are on and what is still open about it.
- The plan below is the only thing you write. No other drafts, notes or lists.
- If they ask whether they are done or how long to go on, say the page tells them when they can finish, once the plan holds their decisions.`;

/**
 * The plan: one draft the participant and the agent build together, shown on
 * the study screen. It is what makes the task a task — without it, "give me
 * the full solution" and Finish was a complete session (first local run,
 * 18 Oct 2026) — and the rules keep it THEIRS: the agent writes only what
 * they decided, and answers "just write it" with options to choose from.
 */
function planSection(title: string): string {
  return `THE PLAN
Together you are writing one short plan, shown on their screen beside the conversation and updated within seconds of your writing it — in this study a draft IS shown on their screen. It is a draft titled "${title}": keep exactly one, and every change after the first is a revision of it (revises=…), never a second draft.
- Write to it when they ask ("put that on the plan", "add that", "change the second one", "take it out"). Write only what THEY decided, in their terms. Never add a measure they have not chosen.
- If they ask you to write the whole plan, or to decide for them, do not. Lay out two or three options for the first open decision, with a reason each, and ask which they choose; then write that one.
- When they settle something out loud but do not ask, you may offer once: "Shall I put that on the plan?"
- Its shape: up to three measures, each one line with its reason, then "Still open:" with anything undecided. No introduction and no conclusion.
- Having written it, say one short sentence ("That's on the plan."). Never read the plan out.`;
}

export const PROLIFIC_TASKS = {
  heat: {
    id: "heat",
    title: "A heat plan for a small town",
    brief:
      "A town of about 20,000 people expects longer and hotter heatwaves over the next ten years, and its council has asked you for a short plan: " +
      "the three measures the town should take first, and why. Work it out by talking it over with the assistant. " +
      "The assistant can explain, suggest and argue, but the choices are yours, and it writes onto the plan only what you decide. " +
      "There is no right answer and you need no expert knowledge.",
    prompts: [
      "Who in the town is most at risk, and why?",
      "What could help this summer, and what takes years?",
      "Which three would you pick, and what would you leave out?",
      "Say “put that on the plan” whenever you have decided something.",
    ],
    planTitle: "Heat plan",
    agentSection: `${STUDY_SETTING}

THE PROBLEM
A small town of about 20,000 people expects longer and hotter heatwaves over the next ten years. Its council has asked them for a short plan: the three measures the town should take first, and why. Who is most at risk, what can be done quickly this summer, what takes years, and what to leave out are all part of it. There is no right answer, and they are not experts.

${planSection("Heat plan")}`,
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

/**
 * The display study's tasks (`SESSION_TASK_IDS` in @voicemural/shared), one
 * per session; sessions rotate two of them (`SESSION_TASK_PAIR`).
 *
 * MADE TO BE COMPARABLE. Each is an everyday plan nobody needs expertise
 * for, with three parts that become separate topics in about five minutes, a
 * constraint or two that the conversation has to come back to, and room for
 * ideas from both sides. The cells cross the tasks with the views, so a task
 * that is easier than the other costs balance, not validity — but the
 * closer they are, the less noise.
 *
 * No plan to write, unlike the Prolific task: what they worked out is asked
 * afterwards, in their own words, and a plan on the screen would be a
 * summary the views do not all show.
 */
export interface SessionTask {
  id: string;
  /** Shown at the top of the conversation as a reminder. */
  title: string;
  /** What they read before starting: the problem, in plain words. */
  brief: string;
  /** The parts worth covering, shown as a checklist they may ignore. */
  prompts: readonly string[];
  /** Composed into the agent's system prompt (see `/api/realtime/session`). */
  agentSection: string;
}

/** Shared by the four: the setting, and what the agent must NOT do for the measures to hold. */
const SESSION_SETTING = `THIS CONVERSATION IS PART OF A STUDY
They are a study participant working through the everyday problem below by talking it over with you, for about five minutes. Let them lead and do the deciding; you bring ideas, knowledge and an honest view.

- Stay on the problem. If they drift far from it, one short nudge back is fine.
- Never summarise the conversation or list what has been covered, and never offer to: not at the end, not after a pause, not when asked "where were we?" — then name only the part they were on, in a few words, and let them carry on.
- If they ask whether they are done or how long to go on, say the page tells them when they can finish.`;

function sessionSection(problem: string): string {
  return `${SESSION_SETTING}

THE PROBLEM
${problem} There is no right answer, and they are not experts.`;
}

export const SESSION_TASKS = {
  trip: {
    id: "trip",
    title: "A weekend away for four",
    brief:
      "You and three friends want to get away for a weekend next month. You have about 150 euros each for everything, and one of you does not drive. " +
      "Work out where to go, how all four of you get there, and where to stay, by talking it over with the assistant.",
    prompts: ["Where, and why there?", "How do all four of you get there?", "Where do you stay, and what do you leave out?"],
    agentSection: sessionSection(
      "They and three friends want a weekend away next month, with about 150 euros each for everything, and one of the four does not drive. Where to go, how all four get there, and where to stay are the parts of it.",
    ),
  },
  birthday: {
    id: "birthday",
    title: "A 40th birthday dinner",
    brief:
      "A close friend turns 40 in three weeks, and you are organising a dinner for twelve people. One guest is vegan, and the budget is about 40 euros a head. " +
      "Work out where to hold it, what to eat, and one thing that makes the evening special, by talking it over with the assistant.",
    prompts: ["At home, or somewhere else?", "What do you serve, with one guest vegan?", "What makes the evening special?"],
    agentSection: sessionSection(
      "A close friend of theirs turns 40 in three weeks, and they are organising a dinner for twelve people, one of them vegan, at about 40 euros a head. Where to hold it, what to serve, and one thing that makes the evening special are the parts of it.",
    ),
  },
  move: {
    id: "move",
    title: "Moving to a new flat",
    brief:
      "You are moving to a flat across town in four weeks. You work full time, you have no car, and the new flat is on the third floor with no lift. " +
      "Work out how you pack, how your things get there, and what to sort out before the day, by talking it over with the assistant.",
    prompts: ["How and when do you pack?", "How do your things get there?", "What must be sorted before the day?"],
    agentSection: sessionSection(
      "They are moving to a flat across town in four weeks. They work full time, have no car, and the new flat is on the third floor with no lift. How and when to pack, how their things get there, and what to sort out before the day are the parts of it.",
    ),
  },
  dinners: {
    id: "dinners",
    title: "A week of family dinners",
    brief:
      "You are planning next week's dinners for a family of four, with two children who are picky eaters, about 70 euros for the whole week, and little time to cook on weekdays. " +
      "Work out the meals, the shopping, and what to cook ahead, by talking it over with the assistant.",
    prompts: ["Which meals, with two picky eaters?", "How do you shop for 70 euros?", "What can you cook ahead?"],
    agentSection: sessionSection(
      "They are planning next week's dinners for a family of four, with two children who are picky eaters, about 70 euros for the whole week, and little time to cook on weekdays. The meals, the shopping, and what to cook ahead are the parts of it.",
    ),
  },
} as const satisfies Record<SessionTaskId, SessionTask>;

/** A block's stored task id as its task, or null for an id not in the catalogue. */
export function sessionTaskFor(id: string | null | undefined): SessionTask | null {
  return isSessionTaskId(id) ? SESSION_TASKS[id] : null;
}
