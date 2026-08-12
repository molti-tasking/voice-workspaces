import Link from "next/link";
import type { Metadata } from "next";
import { listSessionsWithStats } from "@voicemural/db/sessions";
import { formatOffset } from "@voicemural/shared";
import { AccountMenu } from "@/components/account-menu";
import { configuredProviders } from "@/lib/auth";
import { providerName } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { SITE, siteOrigin } from "@/lib/site";
import { GuestButton, SignInButton } from "./sign-in-button";

export const dynamic = "force-dynamic";

// Signed in, this route is a private session list; signed out, it is the only
// page anyone crawls. The metadata describes the second, because the first is
// never what a crawler is shown.
export const metadata: Metadata = {
  // Absolute, so the one page that carries the pitch is not titled
  // "VoiceMural — VoiceMural" by the layout's template.
  title: { absolute: SITE.title },
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const user = await currentUser();
  if (!user) return <Landing />;

  // `isAnonymous` is added to the user model by the anonymous plugin.
  const isGuest =
    (user as { isAnonymous?: boolean | null }).isAnonymous === true;
  const providers = configuredProviders();
  const canUpgrade = isGuest && providers.length > 0;

  const sessions = await listSessionsWithStats(user.id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">VoiceMural</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/workspace"
            className="text-white/40 underline-offset-4 hover:underline"
          >
            Workspace
          </Link>
          <Link
            href="/record"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
          >
            Record
          </Link>
          <AccountMenu />
        </div>
      </header>

      {canUpgrade && (
        <div className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="mb-1 font-medium text-amber-100">
            These recordings live in this browser&rsquo;s cookie
          </p>
          <p className="mb-3 text-sm text-white/60">
            Clearing site data, switching browsers, or recording from another
            device starts a separate account — and your sessions would be split
            across the two. Signing in moves everything you have recorded so far
            onto that account.
          </p>
          <div className="max-w-xs space-y-2">
            {providers.map((provider) => (
              <SignInButton
                key={provider}
                provider={provider}
                location="guest_banner"
                label={`Keep these — sign in with ${providerName(provider)}`}
              />
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-3 text-sm font-medium tracking-wide text-white/40 uppercase">
        Sessions
      </h2>

      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-[var(--color-line)]">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-white/5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {s.startedAt.toLocaleString(undefined, {
                      dateStyle: "full",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="text-sm text-white/40">
                    {formatOffset(s.recordedMs)} recorded · {s.chunkCount}{" "}
                    chunks · {s.utteranceCount} utterances
                    {s.endedAt === null && " · still open"}
                  </p>
                </div>
                {s.pendingChunks > 0 && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-xs text-amber-300">
                    {s.pendingChunks} pending
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="mb-1 font-medium">No sessions yet</p>
      <p className="text-sm text-white/40">
        Mount your phone, open{" "}
        <Link href="/record" className="underline">
          /record
        </Link>
        , and drive.
      </p>
    </div>
  );
}

/**
 * Schema.org description of the app, for the search results and link previews
 * that read it. Only rendered on the landing view — the signed-in session list
 * is not a page anything should be describing.
 */
function StructuredData() {
  const origin = siteOrigin();
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE.name,
    url: `${origin}/`,
    description: SITE.description,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires a browser with MediaRecorder support",
    // A research prototype with a participant list, not a product with a price.
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
  return (
    <script
      type="application/ld+json"
      // The object is ours and contains no user input, so there is nothing here
      // for a closing </script> to escape out of.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <StructuredData />
      <h1 className="mb-3 text-3xl font-semibold">VoiceMural</h1>
      <p className="mb-8 text-white/60">
        Speech is a good medium for formulating difficult problems and a poor
        medium for operating software. VoiceMural listens while you are
        eyes-busy and treats everything as content by default.
      </p>

      <div className="space-y-3">
        <GuestButton />
        {configuredProviders().map((provider) => (
          <SignInButton key={provider} provider={provider} location="landing" />
        ))}
      </div>

      <p className="mt-4 text-sm text-white/40">
        Starting as a guest needs no account. Your recordings are tied to this
        browser, so sign in when you want them to survive a cleared cookie —
        everything you have recorded moves across with you.
      </p>
    </main>
  );
}
