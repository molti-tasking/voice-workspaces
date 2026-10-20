import type { Metadata } from "next";
import Link from "next/link";
import { configuredProviders } from "@/lib/auth";
import { providerName } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { SignInButton } from "../../sign-in-button";
import { WeekForm } from "./week-form";

export const dynamic = "force-dynamic";

/**
 * The end-of-week questionnaire of the field deployment.
 *
 * For a week, the days alternate: on some, Souffleur picks which subjects to
 * raise its questions about; on the others, the person picks, by keeping the
 * subjects they want to hold in their own head. The ledger counts what was
 * kept; this asks what choosing was like, once, at the end — and whether they
 * would talk about it, which is how the interview or focus group is recruited.
 *
 * Sent by URL with the end-of-week message, like `/survey`; tied to the same
 * user as the drives, so a person's account can be read next to what they
 * kept. `/my-week` is linked from here, because remembering a week is easier
 * with the week in front of you.
 */

export const metadata: Metadata = {
  // The root layout's template appends " — Souffleur".
  title: "Your week",
  // Sent to the people it is for, not found.
  robots: { index: false, follow: false },
};

export default async function WeekSurveyPage() {
  const user = await currentUser();

  return (
    <div className="mx-auto max-w-2xl vm-page-top px-6 pb-40">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium tracking-wide text-fg/60 uppercase">
          After a week
        </p>
        <h1 className="text-2xl font-semibold">How was it to choose?</h1>
        <p className="mt-2 leading-relaxed text-fg/60">
          This week, on some days Souffleur picked which subjects to ask you
          about, and on the others you picked them yourself, by keeping them.
          These questions are about that. Half-sentences are fine, and you can
          skip anything. It saves as you go, so you can stop and come back.
        </p>
        {user && (
          <p className="mt-3 text-sm text-fg/60">
            <Link href="/my-week" className="underline underline-offset-4 hover:text-fg">
              See your week
            </Link>{" "}
            — what you kept, day by day — if it helps to remember.
          </p>
        )}
      </header>

      {user ? (
        <WeekForm />
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-fg/60">
            Your answers are kept with your recordings, so you need to be the
            same person here as you were in the app. Open this link on the
            phone you record with, or sign in the way you did there.
          </p>
          <div className="max-w-xs space-y-2">
            {/* No guest button: a new guest would be somebody else, with no week. */}
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
