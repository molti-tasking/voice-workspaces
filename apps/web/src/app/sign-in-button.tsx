"use client";

import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "@/lib/auth-client";

export function PostHogIdentity() {
  const { data: session, isPending } = useSession();
  const identifiedUserId = useRef<string | null>(null);
  const user = session?.user;

  useEffect(() => {
    if (isPending) return;

    if (!user) {
      if (identifiedUserId.current) posthog.reset();
      identifiedUserId.current = null;
      return;
    }

    if (identifiedUserId.current && identifiedUserId.current !== user.id) {
      posthog.reset();
    }

    const personProperties: Record<string, string> = {};
    if (user.email) personProperties.email = user.email;
    if (user.name) personProperties.name = user.name;

    posthog.identify(user.id, personProperties);
    identifiedUserId.current = user.id;
  }, [isPending, user?.email, user?.id, user?.name]);

  return null;
}

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

export function SignInButton({ label = "Sign in with GitHub" }: { label?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn.social({ provider: "github", callbackURL: "/" });
      }}
      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-5 py-3 font-medium text-white hover:bg-white/10 disabled:opacity-60"
    >
      {pending ? "Redirecting…" : label}
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => {
        posthog.reset();
        void signOut({ fetchOptions: { onSuccess: () => location.reload() } });
      }}
      className="text-white/40 underline-offset-4 hover:text-white/70 hover:underline"
    >
      Sign out
    </button>
  );
}
