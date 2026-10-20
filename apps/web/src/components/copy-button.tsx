"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Copy a draft's text, and say so for two seconds.
 *
 * Shared by the recording's page and the conversation on the recorder, which
 * since talkback-23 opens a draft where it was written.
 */
export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The text is on screen and selectable, so a refused clipboard costs a
      // long-press, not the draft.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={[
        "flex shrink-0 items-center gap-1.5 rounded border border-[var(--color-line)] px-2.5 py-1 text-xs text-fg/65 hover:border-fg/30 hover:text-fg/90",
        className,
      ].join(" ")}
    >
      {copied ? (
        <>
          <Check size={13} aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Copy size={13} aria-hidden />
          Copy
        </>
      )}
    </button>
  );
}
