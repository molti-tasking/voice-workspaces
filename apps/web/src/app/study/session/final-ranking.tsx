"use client";

import { useState } from "react";
import { CONVERSATION_DISPLAYS, SessionFinal, type ConversationDisplay } from "@voicemural/shared";
import { createConversationStore } from "@/lib/talkback/conversation";
import { DEMO_POINTS, DEMO_STEPS } from "@/lib/talkback/demo-conversation";
import { createSparkLedger } from "@/lib/talkback/spark-ledger";
import { Choice, ErrorLine, PrimaryButton, StudyFrame } from "../../p/ui";
import { ConversationDisplay as Display } from "../../record/conversation-display";
import { DISPLAY_COPY } from "./session-copy";

/**
 * The end of the session: the four views ranked, best first, each shown as a
 * small, still picture of the same simulated conversation — so what they rank
 * is the view, not whichever of their own conversations went best. Then why,
 * anything else, and whether we may get back to them.
 */
export function FinalRanking({ onSubmit }: { onSubmit: (final: SessionFinal) => Promise<boolean> }) {
  const [ranking, setRanking] = useState<ConversationDisplay[]>([]);
  const [why, setWhy] = useState("");
  const [more, setMore] = useState("");
  const [contact, setContact] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const final = SessionFinal.safeParse({
    ranking,
    ...(why.trim() ? { why } : {}),
    ...(more.trim() ? { more } : {}),
    contact: contact ?? false,
  });
  const complete = final.success && contact !== null;

  function tap(display: ConversationDisplay) {
    // A ranked view tapped again leaves the ranking, with every view after it.
    setRanking((now) => (now.includes(display) ? now.slice(0, now.indexOf(display)) : [...now, display]));
  }

  async function submit() {
    if (!final.success || !complete) return;
    setBusy(true);
    setError(null);
    const ok = await onSubmit(final.data);
    setBusy(false);
    if (!ok) setError("That did not save. Please check your connection and try again.");
  }

  return (
    <StudyFrame eyebrow="Last questions" title="Which view helped you most?">
      <p className="text-fg/80">
        These are the four ways you saw your conversations, each shown here with the same example. Tap them in order,
        from the one that helped you most to the one that helped least. Tap one again to undo.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {CONVERSATION_DISPLAYS.map((display) => {
          const rank = ranking.indexOf(display);
          const label = DISPLAY_COPY[display].label;
          return (
            // A box with the button laid over it, not a button around it: the
            // preview is drawn by the real views, which have buttons of their own.
            <div
              key={display}
              className={[
                "relative overflow-hidden rounded-2xl border",
                rank >= 0 ? "border-fg ring-2 ring-fg" : "border-line",
              ].join(" ")}
            >
              <Preview display={display} />
              <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2 text-sm font-medium">
                {label}
                {rank >= 0 && (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-fg text-xs text-canvas" aria-hidden>
                    {rank + 1}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-pressed={rank >= 0}
                aria-label={rank >= 0 ? `${label}, ranked ${rank + 1}` : label}
                onClick={() => tap(display)}
                className="absolute inset-0 cursor-pointer rounded-2xl"
              />
            </div>
          );
        })}
      </div>

      <label className="block space-y-2">
        <span className="block font-medium">Why did you put your first one first?</span>
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-base leading-relaxed"
        />
      </label>
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

/**
 * One view, still and shrunk, of the whole simulated conversation: drawn by
 * the same component as the conversations themselves, so it looks the way the
 * view did. Not interactive, and hidden from screen readers — the label under
 * it is what is ranked.
 */
function Preview({ display }: { display: ConversationDisplay }) {
  const [{ store, ledger }] = useState(() => {
    const store = createConversationStore();
    for (const step of DEMO_STEPS) store.dispatch(step.message);
    const ledger = createSparkLedger();
    ledger.refresh(store.getSnapshot(), Date.now());
    return { store, ledger };
  });
  return (
    <div className="pointer-events-none relative h-60 overflow-hidden bg-canvas" aria-hidden inert>
      <div className="absolute top-0 left-0 h-[250%] w-[250%] origin-top-left scale-[0.4] p-4">
        <Display
          display={display}
          store={store}
          status={null}
          sparks={display === "transcript" ? null : ledger}
          live={false}
          captureSessionId={null}
          canPull={false}
          onPull={async () => null}
          fixedPoints={DEMO_POINTS}
          flow={{ drafts: [] }}
          className="h-full"
        />
      </div>
    </div>
  );
}
