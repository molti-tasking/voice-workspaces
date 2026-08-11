"use client";

import type { AnalyticsEventMap } from "@voicemural/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { capture } from "@/lib/analytics/client";
import { signIn } from "@/lib/auth-client";
import { type SocialProvider, providerName } from "@/lib/providers";

type SignInLocation = AnalyticsEventMap["sign_in_started"]["location"];

/**
 * Start recording immediately, with no account.
 *
 * Creates a real user row behind a cookie, so sessions, repertoire and
 * invocations are scoped exactly as they are for a signed-in user — the growth
 * curve is measured identically. The catch is that the identity lives in the
 * cookie, so clearing site data or switching browsers starts a new person.
 */
export function GuestButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const { error } = await signIn.anonymous();
          if (error) {
            setError(error.message ?? "Could not start a guest session.");
            setPending(false);
            return;
          }
          router.push("/record");
          router.refresh();
        }}
        className="w-full rounded-lg bg-[var(--color-accent)] px-5 py-3 font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Starting…" : "Start recording"}
      </button>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}

export function SignInButton({
  provider,
  label,
  location,
}: {
  provider: SocialProvider;
  label?: string;
  /** Which surface the gesture came from; see `sign_in_started`. */
  location: SignInLocation;
}) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        // Captured before the redirect, which is the only chance: the OAuth hop
        // is a full document navigation and nothing queued after it survives.
        // The matching `user_signed_in` is emitted server-side, so the gap
        // between the two is the OAuth drop-off.
        capture("sign_in_started", { provider, location });
        void signIn.social({ provider, callbackURL: "/" });
      }}
      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-5 py-3 font-medium text-white hover:bg-white/10 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : (label ?? `Sign in with ${providerName(provider)}`)}
    </button>
  );
}

