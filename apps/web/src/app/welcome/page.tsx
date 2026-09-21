import type { Metadata } from "next";
import { AppDock } from "@/components/app-dock";
import { configuredProviders } from "@/lib/auth";
import { providerName } from "@/lib/providers";
import { currentUser } from "@/lib/session";
import { siteUrl } from "@/lib/site";
import { GuestButton, SignInButton } from "../sign-in-button";
import { AddToHomeScreen } from "./add-to-home-screen";
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
 * boundary and the contact details, and this page does not restate any of it —
 * two documents that both describe the data handling are two documents that
 * will disagree. It says only the one thing a reader needs before the first
 * drive: that everything is kept, and where the models run.
 *
 * ## Keep the examples true
 *
 * Every worked example in `use-case-cards.tsx` and every line under "What it
 * cannot do yet" is checked against the agent: `prompt.ts` for what it is
 * told, `board-tools.ts`, `web-search.ts` and `draft-context.ts` for what it
 * can do, `retrieval.ts` for how it dates what it recalls. Web search is only
 * offered where `SEARXNG_URL` is set, so the fourth example assumes production
 * has it.
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
        <h1 className="text-2xl font-semibold">Welcome to VoiceMural</h1>
        <p className="mt-2 leading-relaxed text-white/60">
          VoiceMural listens while you think out loud, keeps everything you
          said, and helps you make something of it: an answer when you ask, a
          draft you can paste, a task board that fills in from what you decide.
          It is yours to use for whatever you are actually working on. We built
          it so that you get something out of it, and we would like to hear
          whether you do.
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
          className="mx-auto mb-8 w-full max-w-75 rounded-xl border border-line"
          src={VIDEO.src}
          poster={VIDEO.poster}
          width={720}
          height={1212}
          controls
          playsInline
          preload="metadata"
        >
          {VIDEO.captions && (
            <track
              kind="captions"
              src={VIDEO.captions}
              srcLang="en"
              label="English"
              default
            />
          )}
        </video>
      )}

      <section className="mb-8" aria-labelledby="try">
        <h2
          id="try"
          className="mb-1 text-sm font-medium tracking-wide text-white/40 uppercase"
        >
          What to say into it
        </h2>
        <p className="mb-4 text-sm text-white/40">
          Four things it is good at, shown the way they play out. None of them
          is a script: say whatever you actually want to say.
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
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium">Current limitations</h2>
        <ul className="space-y-1.5 text-sm text-white/50 list-disc">
          <li>
            Speech first: Do not expect all the different chat interactions from
            tools you may already know
          </li>
          <li>
            It cannot send anything anywhere. Drafts wait on screen for you to
            copy them; nothing is emailed, shared or posted.
          </li>
          <li>
            Beyond what you have said and what it can find on the web, it knows
            nothing. Not your calendar, your inbox, or anybody else&rsquo;s
            recordings.
          </li>
          <li>
            It cannot change how it behaves mid-drive. “Be more proactive from
            now on” does nothing; how talkative it is comes from the setting
            you pick before you start. Ask it to do the thing now instead.
          </li>
          <li>
            It cannot record while the phone is locked or another app is in
            front. Keep it on screen, in a cradle, for the whole drive.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium">A word on what is recorded</h2>
        <p className="text-sm leading-relaxed text-white/50">
          Everything you say is transcribed and kept, so that you can read it
          back. When it looks something up, the search words go to a search
          engine and nothing else from the drive does. The models behind it run
          in the US, so the same rule as any hosted assistant applies: nothing
          you would not put in a third-party tool. We will not read your specific transcripts unless you ask us to.
        </p>
      </section>

      {/*
        Last of the practicalities, and deliberately after the honest list
        rather than before it: this asks them to put an icon on their phone,
        which is a bigger commitment than reading a page, and nobody should be
        asked for it until they know what they are installing.
      */}
      <AddToHomeScreen host={siteUrl().host} />

      {user ? (
        <AppDock />
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-white/40">
            Signing in keeps your recordings across devices. Starting as a guest
            needs no account, and everything moves across if you sign in later.
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
