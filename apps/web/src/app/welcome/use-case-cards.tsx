"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { USE_CASES, rememberUseCase, type UseCaseId } from "@/lib/use-cases";

/**
 * The three worked examples, as things you can start.
 *
 * A client component only because tapping one has to write the choice down
 * before navigating — see `rememberUseCase`. The copy itself comes from
 * `@/lib/use-cases`, which is also what the recorder reads, so the card and the
 * column can never name different things.
 *
 * Each card is a BUTTON, not a link, and that is deliberate: a link would be
 * followed by a crawler, a link preview or a prefetch, and the write would
 * happen without anybody having chosen anything.
 */
export function UseCaseCards() {
  const router = useRouter();

  const choose = (id: UseCaseId) => {
    rememberUseCase(id);
    router.push("/record");
  };

  return (
    <ol className="space-y-3">
      {USE_CASES.map((useCase, i) => (
        <li key={useCase.id}>
          <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-5">
            <header className="mb-2 flex items-baseline gap-3">
              <span
                className="font-mono text-xs text-white/25 tabular-nums"
                aria-hidden
              >
                {i + 1}
              </span>
              <h3 className="min-w-0 flex-1 text-base font-medium">{useCase.title}</h3>
            </header>

            <p className="mb-3 text-sm leading-relaxed text-white/60">{useCase.promise}</p>

            {/* The line they can read off the screen and repeat. The blank
                microphone is the problem this page exists to solve, so the
                example sentence gets the strongest treatment on the card. */}
            <p className="mb-2 border-l-2 border-white/20 pl-3 text-sm leading-relaxed text-white/90">
              “{useCase.opening}”
            </p>
            <p className="mb-3 text-xs leading-relaxed text-white/40">{useCase.then}</p>

            <p className="mb-4 text-xs leading-relaxed text-white/30 italic">{useCase.point}</p>

            <button
              type="button"
              onClick={() => choose(useCase.id)}
              className="flex items-center gap-1.5 rounded border border-[var(--color-line)] px-3 py-1.5 text-xs text-white/70 hover:border-white/30 hover:text-white/95"
            >
              Try this one
              <ArrowRight size={13} aria-hidden />
            </button>
          </article>
        </li>
      ))}
    </ol>
  );
}
