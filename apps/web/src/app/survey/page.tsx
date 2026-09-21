import type { Metadata } from "next";
import { configuredProviders } from "@/lib/auth";
import { providerName } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { GuestButton, SignInButton } from "../sign-in-button";
import { SurveyForm } from "./survey-form";

export const dynamic = "force-dynamic";

/**
 * The initial-use survey.
 *
 * ## What it asks
 *
 * Where and when did you use it, and what was it like in those moments. The
 * system used to answer the first half itself, from the accelerometer, and
 * tune the conversation to the guess; that was taken out (see
 * `@voicemural/talkback/profile`). The question moved here, to be asked of
 * the person afterwards, moment by moment — which is also the only way to get
 * the second half at all.
 *
 * ## Why it is a page and not a pop-up
 *
 * `SurveyHost` renders PostHog surveys at trigger moments: one question, in
 * passing. This is the opposite: several minutes of recall, done once, on
 * whatever device is to hand. It is saved as it goes, so a phone can start it
 * and a laptop finish it, and it is reachable by URL so it can be sent in a
 * message rather than waited for.
 *
 * ## Who can answer
 *
 * Anyone with a session, guests included — the answers are tied to the same
 * user row as their drives, so the researcher can put a person's account of a
 * moment next to what the ledger recorded of it. Signed-out readers see the
 * same buttons `/welcome` shows; nothing about the survey is readable without
 * being someone.
 */

export const metadata: Metadata = {
  // The root layout's template appends " — VoiceMural".
  title: "Survey",
  // Sent to the people it is for, not found.
  robots: { index: false, follow: false },
};

export default async function SurveyPage() {
  const user = await currentUser();

  return (
    <div className="mx-auto max-w-2xl px-6 pt-10 pb-40">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium tracking-wide text-white/40 uppercase">
          A few questions
        </p>
        <h1 className="text-2xl font-semibold">Where and when did you use it?</h1>
        <p className="mt-2 leading-relaxed text-white/60">
          Think back to the moments you actually had VoiceMural on. Add each
          one you can remember, and tell us a little about it. Half-sentences
          are fine, and you can skip anything. It saves as you go, so you can
          stop and come back.
        </p>
      </header>

      {user ? (
        <SurveyForm />
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-white/40">
            Your answers are kept with your recordings, so you need to be the
            same person here as you were in the app. Starting as a guest needs
            no account.
          </p>
          <div className="max-w-xs space-y-2">
            <GuestButton label="Continue as a guest" next="/survey" />
            {configuredProviders().map((provider) => (
              <SignInButton
                key={provider}
                provider={provider}
                location="survey"
                label={`Sign in with ${providerName(provider)}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
