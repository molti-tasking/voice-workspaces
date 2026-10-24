"use client";

import { useState } from "react";
import { SessionFinal } from "@voicemural/shared";
import { Choice, ErrorLine, PrimaryButton, StudyFrame } from "../../p/ui";

/**
 * The end of the session: anything else they would like to say, and whether
 * we may get back to them. No ranking of the views — each participant saw
 * one, and showing them the others would tell them what is being compared.
 */
export function FinalQuestions({ onSubmit }: { onSubmit: (final: SessionFinal) => Promise<boolean> }) {
  const [more, setMore] = useState("");
  const [contact, setContact] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const final = SessionFinal.safeParse({ ...(more.trim() ? { more } : {}), contact: contact ?? false });
  const complete = final.success && contact !== null;

  async function submit() {
    if (!final.success || !complete) return;
    setBusy(true);
    setError(null);
    const ok = await onSubmit(final.data);
    setBusy(false);
    if (!ok) setError("That did not save. Please check your connection and try again.");
  }

  return (
    <StudyFrame eyebrow="Last questions" title="Before you go">
      <label className="block space-y-2">
        <span className="block font-medium">Anything else you would like to tell us about the session?</span>
        <span className="block text-sm text-fg/60">Optional.</span>
        <textarea
          value={more}
          onChange={(e) => setMore(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base leading-relaxed"
        />
      </label>
      <Choice
        question="May we get back to you with a question or two about your answers?"
        options={[
          { value: true, label: "Yes" },
          { value: false, label: "No" },
        ]}
        value={contact}
        onPick={setContact}
      />

      {error && <ErrorLine>{error}</ErrorLine>}
      <PrimaryButton disabled={!complete || busy} onClick={() => void submit()}>
        {busy ? "Saving…" : "Finish the session"}
      </PrimaryButton>
    </StudyFrame>
  );
}
