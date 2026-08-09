"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { identifyUser } from "./client";

/**
 * Keeps PostHog's notion of who is using the app in step with Better Auth's.
 *
 * Mounted once in the root layout. Renders nothing.
 *
 * Note this deliberately does *not* reset on sign-out — `useSession` reporting
 * no user is ambiguous (it also happens on a cookie hiccup or a slow refresh),
 * and resetting on a false negative would orphan the person mid-drive. Sign-out
 * is an explicit gesture and calls `resetIdentity()` from the button instead.
 */
export function PostHogIdentity() {
  const { data: session, isPending } = useSession();
  const user = session?.user;

  const userId = user?.id;
  // Better Auth's anonymous plugin adds this; it is not on the base user type.
  const isGuest = (user as { isAnonymous?: boolean | null } | undefined)?.isAnonymous === true;
  const email = user?.email;
  const name = user?.name;

  useEffect(() => {
    if (isPending || !userId) return;
    identifyUser({ userId, isGuest, email, name });
  }, [isPending, userId, isGuest, email, name]);

  return null;
}
