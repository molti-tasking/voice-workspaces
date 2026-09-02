"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { capture } from "@/lib/analytics/client";

export interface Proposal {
  id: string;
  canonicalForm: string;
  proposedName: string;
  restatement: string;
  markdown: string;
  occurrenceCount: number;
  sessionCount: number;
  occurrences: { text: string; occurredAt: string }[];
  replay: { title: string | null; body: string } | null;
}

/**
 * A macro the system noticed and is offering back.
 *
 * The verification problem, from Notes.md: the person cannot read the file. So
 * what is loudest here is the one-sentence restatement — the thing that would
 * be spoken aloud — and beneath it the REPLAY: the proposal run against the
 * very speech that triggered it. They see the effect, not the definition. The
 * markdown is available and deliberately not first.
 *
 * Declining is a real answer and is recorded as one. "What they tried to add
 * and failed" is a stated field-study measure, so a refusal has to be an event
 * rather than the absence of one — and the proposal is never offered again.
 */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (accept: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/repertoire/proposals/${proposal.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: accept ? "accept" : "decline" }),
        });
        if (!res.ok) {
          setError("That did not go through. Try again.");
          return;
        }
        capture("macro_decided", {
          canonical_form: proposal.canonicalForm,
          accepted: accept,
          occurrences: proposal.occurrenceCount,
        });
        router.refresh();
      } catch {
        setError("That did not go through. Try again.");
      }
    });
  };

  return (
    <article className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
      <header className="mb-2">
        <p className="text-xs tracking-wide text-emerald-200/60 uppercase">
          You keep doing this
        </p>
        <h3 className="mt-1 text-lg font-medium">{proposal.proposedName}</h3>
        <p className="mt-0.5 text-sm text-white/70">{proposal.restatement}</p>
      </header>

      <p className="mb-3 text-xs text-white/35">
        {proposal.occurrenceCount} time{proposal.occurrenceCount === 1 ? "" : "s"} across{" "}
        {proposal.sessionCount} recording{proposal.sessionCount === 1 ? "" : "s"}
      </p>

      {proposal.replay && (
        <div className="mb-3 rounded-lg border border-[var(--color-line)] bg-black/20 p-3">
          <p className="mb-1.5 text-[11px] text-white/30">
            What it would have produced, from your own words:
          </p>
          <pre className="text-[13px] leading-snug whitespace-pre-wrap text-white/70">
            {proposal.replay.body}
          </pre>
        </div>
      )}

      <details className="mb-3">
        <summary className="cursor-pointer list-none text-[11px] text-white/25 hover:text-white/50">
          the capability itself
        </summary>
        <pre className="mt-1.5 rounded bg-black/20 p-2.5 text-xs leading-snug whitespace-pre-wrap text-white/50">
          {proposal.markdown}
        </pre>
      </details>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className="rounded bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:bg-white/90 disabled:opacity-50"
        >
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(false)}
          className="rounded px-3 py-1.5 text-sm text-white/40 hover:text-white/70 disabled:opacity-50"
        >
          No thanks
        </button>
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </article>
  );
}
