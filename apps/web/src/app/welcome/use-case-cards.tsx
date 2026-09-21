const USE_CASES = [
  {
    id: "think_aloud",
    title: "Think a problem out, and come back to a board",
    promise:
      "Talk through something unresolved. It listens, and what you decide turns into tasks you can see afterwards.",
    opening:
      "I need to work out how to structure the method section. Let me think out loud for a bit.",
    then: "When something lands, say so — “right, that's decided” — or “mark that one done”.",
    point:
      "It hears a decision and moves the card. A recording app just keeps the audio.",
  },
  {
    id: "draft",
    title: "Get something written you can paste",
    promise:
      "Ask for an email, a message or notes. It writes them to the screen instead of reading them at you, and you can change them by voice.",
    opening: "Draft me a message to my sister with the action items from this.",
    then: "Then change it without repeating yourself: “make it shorter”, “warmer”, “fix the name”.",
    point:
      "The second ask revises the same draft rather than producing a second one.",
  },
  {
    id: "recall",
    title: "Pick the thread up tomorrow",
    promise:
      "Record something today, then start a second drive another day and ask where you got to.",
    opening: "Where did I get to on the ethics form?",
    then: "It answers from what you actually said, and says roughly when you said it.",
    point:
      "This is the one that needs two drives. It is also the one that most clearly is not a voice memo.",
  },
];

/**
 * The three worked examples, as things you can start.
 *  * Each card is a BUTTON, not a link, and that is deliberate: a link would be
 * followed by a crawler, a link preview or a prefetch, and the write would
 * happen without anybody having chosen anything.
 */
export function UseCaseCards() {
  return (
    <ol className="space-y-3">
      {USE_CASES.map((useCase, i) => (
        <li key={useCase.id}>
          <article className="rounded-xl border border-line bg-ink-soft/40 p-5">
            <header className="mb-2 flex items-baseline gap-3">
              <span
                className="font-mono text-xs text-white/25 tabular-nums"
                aria-hidden
              >
                {i + 1}
              </span>
              <h3 className="min-w-0 flex-1 text-base font-medium">
                {useCase.title}
              </h3>
            </header>

            <p className="mb-3 text-sm leading-relaxed text-white/60">
              {useCase.promise}
            </p>

            {/* The line they can read off the screen and repeat. The blank
                microphone is the problem this page exists to solve, so the
                example sentence gets the strongest treatment on the card. */}
            <p className="mb-2 border-l-2 border-white/20 pl-3 text-sm leading-relaxed text-white/90">
              “{useCase.opening}”
            </p>
            <p className="mb-3 text-xs leading-relaxed text-white/40">
              {useCase.then}
            </p>

            <p className="mb-4 text-xs leading-relaxed text-white/30 italic">
              {useCase.point}
            </p>
          </article>
        </li>
      ))}
    </ol>
  );
}
