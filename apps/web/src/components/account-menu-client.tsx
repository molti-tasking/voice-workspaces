"use client";

import { LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { capture, resetIdentity } from "@/lib/analytics/client";
import { signIn, signOut } from "@/lib/auth-client";
import { type SocialProvider, providerName } from "@/lib/providers";

export type AccountUser = {
  name: string | null;
  email: string | null;
  image: string | null;
  isGuest: boolean;
};

/** Initials for the fallback avatar, from whatever identity we actually have. */
function initials(user: AccountUser): string {
  const source = user.name?.trim() || user.email?.trim() || "";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * What stands in for a picture: initials for a real account, a generic figure
 * for a guest — who has no name worth reducing to letters.
 */
function AvatarFallback({ user }: { user: AccountUser }) {
  if (user.isGuest) return <UserRound size={15} aria-hidden />;
  return <span aria-hidden>{initials(user)}</span>;
}

/**
 * Avatar and account dropdown.
 *
 * Deliberately absent from `/record`: that screen is operated at a glance from a
 * car cradle, and a tappable menu in the corner is a hazard there rather than a
 * convenience.
 */
export function AccountMenuClient({
  user,
  providers,
}: {
  user: AccountUser;
  providers: SocialProvider[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  /**
   * The avatar URL that failed to load, not a boolean.
   *
   * Provider avatars do fail in practice — Google's `lh3.googleusercontent.com`
   * URLs 403 under rate limiting and can expire outright — and a failed <img>
   * renders the browser's broken-image glyph rather than nothing, which reads as
   * a bug in the app.
   *
   * Storing the URL rather than a flag means a *different* picture is retried on
   * its own merits, with no effect needed to reset anything: the comparison
   * below is derived state, so signing into an account whose avatar does load
   * shows it immediately.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user.isGuest ? "Guest account" : (user.email ?? "Account")}
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-ink-soft)] text-xs font-medium text-white/70 hover:border-white/30 hover:text-white"
      >
        {user.image && failedSrc !== user.image ? (
          // Provider avatars are arbitrary remote hosts, so this stays a plain
          // <img>: next/image would need every provider CDN allow-listed in
          // next.config.ts, and a missed one renders a broken avatar in prod.
          //
          // `referrerPolicy` is load-bearing, not hygiene: Google returns 403 for
          // avatar requests carrying a Referer from an unrecognised origin, so
          // without it the picture fails on the deployed domain while working
          // locally.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(user.image)}
            className="size-full object-cover"
          />
        ) : (
          <AvatarFallback user={user} />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)] shadow-2xl shadow-black/50"
        >
          <div className="border-b border-[var(--color-line)] px-4 py-3">
            <p className="truncate text-sm font-medium">
              {user.isGuest ? "Guest" : (user.name ?? user.email ?? "Signed in")}
            </p>
            <p className="mt-0.5 truncate text-xs text-white/40">
              {/* A guest's address is a synthetic @guest.voicemural.local one;
                  showing it would read as a real account. */}
              {user.isGuest ? "Recordings tied to this browser" : user.email}
            </p>
          </div>

          {user.isGuest ? (
            <div className="px-4 py-3">
              {providers.length > 0 ? (
                <>
                  <p className="mb-3 text-xs leading-relaxed text-white/50">
                    Clearing site data or recording from another device starts a
                    separate account. Signing in moves everything you have recorded
                    so far across.
                  </p>
                  <div className="space-y-2">
                    {providers.map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        role="menuitem"
                        disabled={pending !== null}
                        onClick={() => {
                          setPending(provider);
                          capture("sign_in_started", {
                            provider,
                            location: "account_menu",
                          });
                          void signIn.social({ provider, callbackURL: "/" });
                        }}
                        className="w-full rounded-lg border border-[var(--color-line)] bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
                      >
                        {pending === provider
                          ? "Redirecting…"
                          : `Sign in with ${providerName(provider)}`}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                // Without this the menu is silently empty for a guest and looks
                // broken, when the real cause is that no provider is configured
                // in this deployment's environment.
                <p className="text-xs leading-relaxed text-white/50">
                  No sign-in provider is configured for this deployment, so
                  recordings stay tied to this browser.
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // Order matters: capture, then reset. `resetIdentity` calls
                // posthog.reset(), which mints a fresh anonymous distinct_id —
                // so an event sent afterwards would be attributed to nobody
                // rather than to the person who just signed out.
                capture("user_signed_out", { is_guest: user.isGuest });
                resetIdentity();
                void signOut({ fetchOptions: { onSuccess: () => location.reload() } });
              }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white"
            >
              <LogOut size={14} aria-hidden />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
