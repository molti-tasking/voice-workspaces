"use client";

import { useEffect, useState } from "react";
import { ESM_EXPIRY_MS, ESM_ITEMS, type EsmItem } from "@voicemural/shared";

/**
 * What a block's conversation is interrupted by, besides the game
 * (`block-moments.ts`): the one-tap prompt over its bottom edge.
 */

/**
 * One tap, 1 to 7, over the bottom of the conversation, which stays in view.
 * It goes by itself after `ESM_EXPIRY_MS`; the bar shows how long is left.
 */
export function EsmPrompt({ item, onAnswer }: { item: EsmItem; onAnswer: (value: number) => void }) {
  const copy = ESM_ITEMS[item];
  const [draining, setDraining] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDraining(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role="dialog"
      aria-label={copy.question}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl rounded-2xl border border-line bg-surface p-3 shadow-lg"
    >
      <p className="mb-2 text-[0.95rem] font-medium">{copy.question}</p>
      <div className="grid grid-cols-7 gap-1">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onAnswer(n)}
            className="min-h-11 cursor-pointer rounded-xl bg-fg/10 text-base font-medium hover:bg-fg/15 active:bg-fg active:text-canvas"
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg/55">
        <span>{copy.low}</span>
        <span>{copy.high}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-fg/10" aria-hidden>
        <div
          className="h-full rounded-full bg-fg/40 ease-linear"
          style={{
            width: draining ? "0%" : "100%",
            transitionProperty: "width",
            transitionDuration: `${ESM_EXPIRY_MS}ms`,
          }}
        />
      </div>
    </div>
  );
}
