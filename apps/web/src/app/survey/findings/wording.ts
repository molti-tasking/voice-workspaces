import type {
  Arrival,
  FindingsTextField,
  HandOffAnswer,
  HandOffTask,
  KeepUsing,
  UsageLevel,
  UseReason,
  WrapUp,
} from "@voicemural/shared";

/**
 * Every sentence the findings survey shows, in one copy.
 *
 * ONE COPY because two pages show them: the form asks them, and the results
 * page labels its charts with them. A chart labelled in different words from
 * the question people answered is a chart that misreports what was asked.
 * The keys these label live in `@voicemural/shared/findings-survey`; reword
 * here freely, and bump `FINDINGS_VERSION` there when the meaning moves.
 *
 * Pure data and no imports beyond types, so a server component and a client
 * component can both read it.
 */

export const INTRO = {
  eyebrow: "Four early findings",
  title: "What do you make of these?",
  body:
    "A few things the study has seen so far, and your reaction to each. Answer from whatever " +
    "you experienced, even if that was a single drive, and skip anything you can't answer. " +
    "It takes about eight minutes. Answers are anonymous: no account, no name, and only the " +
    "day you sent it is kept.",
};

export const USAGE_QUESTION = "How much did you use Souffleur?";
export const USAGE_LABELS: Record<UsageLevel, string> = {
  once_or_twice: "Once or twice",
  a_handful: "A handful of drives",
  regularly: "Regularly",
};

export interface Finding {
  n: number;
  title: string;
  statement: string;
}

/** Exactly four, in order; the form and the dashboard each name them by position. */
export const FINDINGS: readonly [Finding, Finding, Finding, Finding] = [
  {
    n: 1,
    title: "It's hard to tell what silence means",
    statement:
      "When Souffleur went quiet, people often couldn't tell whether it was listening, working on something, or broken.",
  },
  {
    n: 2,
    title: "Few made it a habit",
    statement: "Most people tried it a few times; few made it part of their drives.",
  },
  {
    n: 3,
    title: "Drives don't end, they just stop",
    statement:
      "Most recordings were never stopped; people arrived and got out. So the short reflection meant to follow a drive rarely happened.",
  },
  {
    n: 4,
    title: "Holding vs. thinking",
    statement:
      "People were glad to have it hold things for them — tasks, loose ends, where they left off — but were split on whether it should think along.",
  },
];

export const SILENCE_MATCH = {
  question: "How well does this match your experience?",
  low: "Not at all",
  high: "Exactly",
  notApplicable: "It didn't come up for me",
};
export const SILENCE_WANTED = "When it went quiet, what would you have wanted to hear or notice?";

export const USE_REASONS_QUESTION = "What shaped how much you used it?";
export const USE_REASONS_HINT = "Tick all that apply.";
export const USE_REASON_LABELS: Record<UseReason, string> = {
  part_of_commute: "It became part of my commute",
  unsure_what_for: "I wasn't sure what to use it for",
  nothing_on_mind: "Nothing much was on my mind on those drives",
  forgot: "I forgot it was there",
  too_much_effort: "Starting it was too much effort",
  unsure_it_keeps: "I wasn't sure it would keep what I said",
  did_not_work: "It didn't work when I tried",
  not_alone: "Someone else was in the car",
  not_recorded: "I didn't want to be recorded",
  other: "Something else",
};
export const USE_REASON_OTHER = "What else?";
export const LEARNED = "How did you find out what it could do — and what do you wish it had told you, and when?";

export const ARRIVAL_QUESTION = "When you arrived, what usually happened?";
export const ARRIVAL_LABELS: Record<Arrival, string> = {
  stop_and_reflect: "I pressed Stop and did the reflection",
  stop_and_skip: "I pressed Stop and skipped it",
  forgot_it_was_on: "I forgot it was still on",
  left_it: "I left it; other things came first",
  other: "Something else",
};
export const ARRIVAL_OTHER = "What happened instead?";

export const WRAP_UP_QUESTION = "Where should a drive be wrapped up?";
export const WRAP_UP_LABELS: Record<WrapUp, string> = {
  in_the_car: "In the car, before getting out",
  after_arriving: "Right after arriving, on the phone",
  at_the_desk: "Later, at my desk",
  not_at_all: "Not at all",
};
export const WRAP_UP_WHY = "Why? (optional)";

export const HAND_OFF_QUESTION = "While driving, would you hand this to a voice partner?";
export const HAND_OFF_TASK_LABELS: Record<HandOffTask, string> = {
  remember_task: "Remember a task or loose end",
  where_left_off: "Keep track of where I left off in a project",
  sum_up: "Sum up what I said",
  ask_questions: "Ask me questions to sharpen a thought",
  suggest_topic: "Suggest what to think about on this drive",
  draft_message: "Draft a message or text for me",
  what_matters: "Tell me what matters most",
};
export const HAND_OFF_ANSWER_LABELS: Record<HandOffAnswer, string> = {
  gladly: "Yes, gladly",
  check_later: "Only if I can check it later",
  myself: "No — I want to do that myself",
};
export const NEVER_DO = "Where's the line for you — what should a voice partner never do for you?";

export const OVERALL_TITLE = "Overall";
export const UMUX_CAPABILITIES = {
  question: "Souffleur's capabilities meet my requirements.",
  low: "Strongly disagree",
  high: "Strongly agree",
};
export const UMUX_EASE = {
  question: "Souffleur is easy to use.",
  low: "Strongly disagree",
  high: "Strongly agree",
};
export const KEEP_USING_QUESTION = "If it stayed available, would you keep using it?";
export const KEEP_USING_LABELS: Record<KeepUsing, string> = {
  regularly: "Yes, regularly",
  certain_drives: "For certain drives",
  no: "No",
};
export const WORKSHOP_QUESTION =
  "For tomorrow: one question about voice assistants and offloading you'd like the group to discuss.";

/** How each free-text field is introduced on the results page. */
export const TEXT_FIELD_LABELS: Record<FindingsTextField, string> = {
  silenceWanted: SILENCE_WANTED,
  useReasonOther: "Something else shaped their use",
  learned: LEARNED,
  arrivalOther: "Something else happened on arrival",
  wrapUpWhy: "Why wrap up there",
  neverDo: NEVER_DO,
  workshopQuestion: "Questions for the workshop",
};
