import type { Metadata } from "next";
import Link from "next/link";
import { AppDock } from "@/components/app-dock";
import { configuredProviders } from "@/lib/auth";
import { providerName } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { GuestButton, SignInButton } from "../sign-in-button";
import { UseCaseCards } from "./use-case-cards";

export const dynamic = "force-dynamic";

/**
 * The page a peer reads before their first drive.
 *
 * ## What it is answering
 *
 * Two of the first people to try the system reported the same thing: *"it
 * seemed like an organizer for voice memos"* and *"I didn't really know what it
 * could do so I didn't know how to get started."* Neither had hit a bug. The
 * interface is a microphone, and a microphone tells you nothing about what may
 * be said into it — which is G1 ("make clear what the system can do") failing
 * in the specific way a voice-first system fails it. This page is the
 * intervention, and the fact that it was needed is itself a finding worth
 * reporting rather than quietly fixing.
 *
 * ## Why it is not `/`
 *
 * The landing page is the one thing crawlers see and the one thing a stranger
 * lands on; it makes an argument. This makes a request of people who have
 * already agreed to help, so it is noindexed like `/study`, and reachable only
 * by the link they were sent.
 *
 * ## What it is NOT
 *
 * Not the participant information sheet. `/study` carries consent, the privacy
 * boundary and the contact details, and this page links to it rather than
 * restating any of it — two documents that both describe the data handling are
 * two documents that will disagree.
 */

export const metadata: Metadata = {
  // The root layout's template appends " — VoiceMural".
  title: "Welcome",
  // An invitation with an audience of about five people.
  robots: { index: false, follow: false },
};

/**
 * The welcome video.
 *
 * `intro-video.mp4` is a web encode of `intro-video.mov`, the master the phone
 * handed over: HEVC in a QuickTime container, 68 MB for 32 seconds. The master
 * is kept beside it in Git LFS, and is deliberately not what this points at.
 * Safari is the only browser that reliably decodes HEVC, so serving the .mov
 * would have handed most of the invite list a black rectangle — which is the
 * exact failure this page was written to prevent, arriving one element sooner.
 *
 * After replacing the master, regenerate both derived files:
 *
 *   ffmpeg -i intro-video.mov -vf "scale=720:-2,fps=30" \
 *     -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -preset slow \
 *     -c:a aac -b:a 128k -movflags +faststart intro-video.mp4
 *   ffmpeg -ss 0.2 -i intro-video.mp4 -frames:v 1 -q:v 4 intro-poster.jpg
 *
 * `-movflags +faststart` is not optional: it moves the index to the front of
 * the file so playback can start before 5 MB has arrived, which on the mobile
 * connection this audience is on is the difference between a video and a wait.
 *
 * `captions` stays unset. The picture already carries burned-in subtitles, and
 * a track invented here rather than transcribed from the audio would be a
 * caption that lies — worse for the person relying on it than none at all.
 */
const VIDEO: { src: string; poster?: string; captions?: string } | null = {
  src: "/welcome/intro-video.mp4",
  poster: "/welcome/intro-poster.jpg",
};

export default async function WelcomePage() {
  const user = await currentUser();

  return (
    <div className="mx-auto max-w-2xl px-6 pt-10 pb-40">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Thanks for trying this</h1>
        <p className="mt-2 leading-relaxed text-white/60">
          VoiceMural listens while your hands and eyes are somewhere else — driving,
          walking, washing up. You think out loud; it keeps everything you said, answers
          when you ask it something, and turns what you decide into something you can
          look at afterwards.
        </p>
      </header>

      {/*
        Shot in portrait on a phone, so it is capped rather than run to the
        column width: at `w-full` a 720x1212 frame is over 1100px tall and
        pushes every word on the page below the fold. `playsInline` keeps iOS
        from yanking it into its own fullscreen player, and the intrinsic
        dimensions reserve the box before the metadata lands so the text below
        does not jump.
      */}
      {VIDEO && (
        <video
          className="mx-auto mb-8 w-full max-w-[300px] rounded-xl border border-[var(--color-line)]"
          src={VIDEO.src}
          poster={VIDEO.poster}
          width={720}
          height={1212}
          controls
          playsInline
          preload="metadata"
        >
          {VIDEO.captions && (
            <track kind="captions" src={VIDEO.captions} srcLang="en" label="English" default />
          )}
        </video>
      )}

      <section className="mb-8" aria-labelledby="try">
        <h2 id="try" className="mb-1 text-sm font-medium tracking-wide text-white/40 uppercase">
          Three things to try
        </h2>
        <p className="mb-4 text-sm text-white/40">
          Pick one and it starts a recording. You do not have to stick to it — say
          whatever you actually want to say.
        </p>
        <UseCaseCards />
      </section>

      {/*
        The honest half, and the reason this page works at all.

        Someone who tries something the system cannot do concludes it does not
        work, and stops. Saying the boundary out loud costs one paragraph and
        buys back every attempt that would have been spent on the wrong thing —
        which is precisely what G1 is about. Keep this list TRUE: a promise here
        that does not fire is worse than no page.
      */}
      <section className="mb-8 rounded-xl border border-[var(--color-line)] p-5">
        <h2 className="mb-2 text-sm font-medium">What it cannot do yet</h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-white/50">
          <li>
            Speech is the only way in. There is no chat box — it cannot read a file, a
            link or anything you paste.
          </li>
          <li>
            It cannot send anything anywhere. Drafts wait on screen for you to copy
            them; nothing is emailed, shared or posted.
          </li>
          <li>
            It only knows what you have said to it. Not your calendar, your inbox, or
            anybody else&rsquo;s recordings.
          </li>
          <li>
            It cannot learn new behaviour mid-drive. Asking it to “be more proactive
            from now on” does nothing — ask it to do the thing now instead.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium">A word on what is recorded</h2>
        <p className="text-sm leading-relaxed text-white/50">
          Everything you say is transcribed and kept, so that you can read it back. Nobody
          on the research team listens to your recordings or reads your transcripts — the{" "}
          <Link href="/study" className="underline underline-offset-4 hover:text-white/80">
            information sheet
          </Link>{" "}
          says exactly what is and is not seen. The models behind it run in the US, so the
          same rule as any hosted assistant applies: nothing you would not put in a
          third-party tool.
        </p>
      </section>

      {user ? (
        <AppDock />
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-white/40">
            Signing in keeps your recordings across devices. Starting as a guest needs no
            account, and everything moves across if you sign in later.
          </p>
          <div className="max-w-xs space-y-2">
            <GuestButton />
            {configuredProviders().map((provider) => (
              <SignInButton
                key={provider}
                provider={provider}
                location="welcome"
                label={`Sign in with ${providerName(provider)}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
