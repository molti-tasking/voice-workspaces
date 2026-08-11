import Link from "next/link";
import type { Metadata } from "next";

/**
 * The page participants read before day one, and re-read on their phone when
 * they forget what to do.
 *
 * Two things are deliberately absent, and both matter:
 *
 * 1. **The phase structure.** Participants are not told that the repertoire is
 *    fixed for the first days and extensible afterwards. A participant who
 *    knows authoring is coming authors in response to us rather than to their
 *    own need, which is precisely the thing the deployment is trying to
 *    observe. This is partial disclosure, not deception — it has to be
 *    declared in the ethics application and undone in the exit debrief.
 *
 * 2. **The research questions.** No growth curve, no direction-versus-content,
 *    no talk of a repertoire. Telling someone we are counting the capabilities
 *    they create is the fastest way to make the count meaningless.
 *
 * What is present is everything a participant needs to consent honestly and to
 * get through a day without us: what is recorded, who hears it, what to say,
 * what to do when it breaks, and how to stop.
 */

export const metadata: Metadata = {
  title: "Taking part — VoiceMural",
  // A participant information sheet has an audience of about nine people.
  robots: { index: false, follow: false },
};

/** Everything that changes between studies, in one place to edit. */
const STUDY = {
  institution: "«Institution»",
  approval: "«Ethics approval reference»",
  researcher: "«Researcher name»",
  email: "«contact email»",
  phone: "«contact phone»",
  days: 10,
  audioRetention: "«e.g. 12 months after the study ends»",
  compensation: "«amount, paid on completion»",
};

export default function StudyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-12">
        <p className="mb-2 text-sm font-medium tracking-wide text-white/40 uppercase">
          Taking part
        </p>
        <h1 className="mb-4 text-3xl font-semibold">
          Thinking out loud on your commute
        </h1>
        <p className="text-lg leading-relaxed text-white/60">
          You already do some of your best thinking in the car, where you
          cannot write any of it down. For {STUDY.days} days, VoiceMural
          listens while you drive and keeps what you said. We want to find out
          whether that turns out to be worth anything.
        </p>
      </header>

      <Section n={1} title="What we are asking of you">
        <p>
          Record your normal commute. Not a special trip, not a demonstration —
          the drive you were going to make anyway. Talk if you feel like
          talking. Say nothing if you do not.
        </p>
        <List>
          <li>
            Roughly {STUDY.days} days of ordinary commuting, both directions
            where that fits your day.
          </li>
          <li>
            Three short questions at the end of each drive, answered on your
            phone once you have parked.
          </li>
          <li>
            One conversation with us at the end, about 45 minutes, in person or
            by video.
          </li>
        </List>
        <p>
          There is no target. A quiet drive where you said nothing is real data
          and tells us something a talkative one does not. Please do not
          perform for the recording.
        </p>
      </Section>

      <Section n={2} title="A drive, start to finish">
        <Steps
          steps={[
            [
              "Before you pull away",
              <>
                Phone in the cradle, cable plugged in, screen on, open{" "}
                <Code>/record</Code> and press <strong>Start recording</strong>.
                Check it says it is recording before you move off.
              </>,
            ],
            [
              "While you drive",
              <>
                Talk, or do not. Leave the app in the foreground and the screen
                awake — the phone stops recording if it locks or you switch
                apps, and there is nothing we can do to recover that stretch.
              </>,
            ],
            [
              "When you arrive",
              <>
                Stop the car first. Then press <strong>Stop</strong> and answer
                the three questions. It takes under a minute. If you forget, the
                recording closes itself — nothing is lost.
              </>,
            ],
            [
              "Later, if you are curious",
              <>
                Open{" "}
                <Link href="/timeline" className="underline underline-offset-4">
                  the timeline
                </Link>{" "}
                on any device to read back what you said. Reading it is optional
                and you should not feel obliged.
              </>,
            ],
          ]}
        />
      </Section>

      <Section n={3} title="Safety, which overrides everything else here">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
          <p className="mb-3 font-medium text-amber-100">
            Nothing in this study is worth taking your eyes off the road for.
          </p>
          <List className="text-amber-100/80">
            <li>
              The phone goes in a proper cradle, positioned before you set off.
              We supply one if you need it.
            </li>
            <li>
              Never touch, read, or hold it while the car is moving. Not to
              check it is working, not to fix an error, not for anything.
            </li>
            <li>
              If it wants your attention, it can wait until you have parked. It
              will not lose anything in the meantime.
            </li>
            <li>
              Talking to it should feel like talking to a passenger. If it ever
              feels more demanding than that, stop and tell us — that is a
              problem with our design, not with you.
            </li>
          </List>
        </div>
      </Section>

      <Section n={4} title="What you can ask it to do">
        <p>
          Most of the time you do not ask it to do anything. It is recording,
          and everything you say is treated as something you meant to say. These
          are the exceptions — spoken in passing, the way you would ask someone
          in the passenger seat to jot something down.
        </p>
        <dl className="my-5 divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
          {[
            [
              "Mark this",
              "Flags whatever you just said so it stands out later. Use it freely — it is the one thing that costs nothing to get wrong.",
            ],
            [
              "Make a diary entry",
              "Turns the drive into a dated, structured write-up you can read afterwards.",
            ],
            [
              "Send it to the doc",
              "Appends that write-up to a document you nominate when we set you up.",
            ],
            [
              "Interview me",
              "Switches to asking you one question at a time instead of listening quietly. Say “stop interviewing” to go back.",
            ],
          ].map(([phrase, what]) => (
            <div key={phrase} className="p-4">
              <dt className="mb-1 font-medium">&ldquo;{phrase}&rdquo;</dt>
              <dd className="text-sm leading-relaxed text-white/50">{what}</dd>
            </div>
          ))}
        </dl>
        <p>
          You do not have to phrase these exactly. And when it mishears you and
          marks the wrong sentence, that is expected — it can only ever add to
          the recording, never edit or delete what you actually said.
        </p>
      </Section>

      <Section n={5} title="The three questions at the end">
        <p>
          Same three every time, so you can think about them while you drive.
          Short answers are fine. &ldquo;Nothing today&rdquo; is fine.
        </p>
        <ol className="my-5 space-y-3 rounded-xl border border-[var(--color-line)] p-5">
          {[
            "What did you want it to do that it couldn't?",
            "What did it do that you didn't ask for?",
            "What would you make into a thing, if that were easy?",
          ].map((q, i) => (
            <li key={q} className="flex gap-3">
              <span className="shrink-0 font-mono text-sm text-white/30">
                {i + 1}
              </span>
              <span className="leading-relaxed">{q}</span>
            </li>
          ))}
        </ol>
        <p className="text-white/50">
          Complaints are the useful answer here. If the honest response to the
          second question is that it keeps doing something irritating, say
          exactly that — we would much rather hear it than not.
        </p>
      </Section>

      <Section n={6} title="What gets recorded, and who can hear it">
        <p>
          Be clear about this before you agree, because it is the part that
          matters most.
        </p>
        <List>
          <li>
            <strong>Audio of the drive</strong>, from when you press start until
            you stop. Plus the written transcript, and timings of what you did
            in the app.
          </li>
          <li>
            <strong>Anyone else in the car is recorded too</strong>, and so is
            anything audible from outside. Please tell passengers before you
            start, or do not record that trip. A phone call you take while
            recording is captured in full.
          </li>
          <li>
            <strong>Transcription happens on an external service.</strong> Audio
            leaves our servers to be turned into text, under a contract that
            forbids the provider from keeping it or training on it.
          </li>
          <li>
            <strong>Who listens.</strong> The research team, to understand what
            happened. Nothing is published that could identify you or anyone
            else you recorded — quotes in any paper are anonymised, and we will
            show you any quote of yours before it is used.
          </li>
          <li>
            <strong>How long.</strong> Audio is kept until {STUDY.audioRetention},
            then deleted. Anonymised transcripts may be kept longer for the
            research record.
          </li>
        </List>
        <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-4">
          <strong className="font-medium">Deleting a drive.</strong> Tell us
          which one — the date and roughly the time is enough — and we remove
          the audio and the transcript for good, within a working day. You never
          have to say why, and we will not ask. If you said something you would
          rather we did not hear, have it deleted; doing so affects neither your
          taking part nor your being paid.
        </p>
      </Section>

      <Section n={7} title="When it goes wrong">
        <p>
          It will. It is a research prototype and parts of it are held together
          with tape. Recordings sometimes fail to upload, the transcript
          sometimes garbles a word, it sometimes reacts to something you never
          asked it to react to.
        </p>
        <p>
          <strong>None of that is your fault and none of it needs fixing by
          you.</strong>{" "}
          Message {STUDY.researcher} at{" "}
          <a
            href={`mailto:${STUDY.email}`}
            className="underline underline-offset-4"
          >
            {STUDY.email}
          </a>{" "}
          or {STUDY.phone} once you have parked, and carry on with the next
          drive as normal. We check every day that your recordings are arriving,
          so we often know before you do.
        </p>
      </Section>

      <Section n={8} title="Stopping, and your rights">
        <List>
          <li>
            You can stop at any point, without giving a reason, and still be
            paid {STUDY.compensation}.
          </li>
          <li>
            You can ask us to delete everything, up to the point where the
            results are written up. After that, anonymised data cannot be pulled
            back out.
          </li>
          <li>
            You can skip any drive, any question, and anything in the final
            conversation.
          </li>
          <li>
            You can see everything we hold about you, on request, at any time.
          </li>
        </List>
        <p className="text-sm text-white/40">
          Approved by the research ethics committee at {STUDY.institution} under{" "}
          {STUDY.approval}. {STUDY.institution} is the data controller. If you
          have a concern you would rather not raise with the research team, the
          committee&rsquo;s contact details are on the consent form you signed.
        </p>
      </Section>

      <footer className="mt-14 border-t border-[var(--color-line)] pt-6">
        <p className="mb-4 text-white/50">
          Questions before you start, however small — ask. There is no such
          thing as a question that reflects badly on you here; if something is
          unclear, we designed it badly.
        </p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link
            href="/record"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
          >
            Open the recorder
          </Link>
          <a
            href={`mailto:${STUDY.email}`}
            className="text-white/40 underline-offset-4 hover:underline"
          >
            {STUDY.email}
          </a>
        </div>
      </footer>
    </main>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 flex items-baseline gap-3 text-xl font-semibold">
        <span className="font-mono text-sm text-white/25">
          {String(n).padStart(2, "0")}
        </span>
        {title}
      </h2>
      <div className="space-y-4 leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

function List({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={`list-outside list-disc space-y-2.5 pl-5 marker:text-white/25 ${className}`}
    >
      {children}
    </ul>
  );
}

function Steps({ steps }: { steps: [string, React.ReactNode][] }) {
  return (
    <ol className="my-5 space-y-5 border-l border-[var(--color-line)] pl-6">
      {steps.map(([label, body]) => (
        <li key={label} className="relative">
          <span className="absolute top-2 -left-[25px] size-2 rounded-full bg-[var(--color-line)]" />
          <p className="mb-1 font-medium text-white">{label}</p>
          <p className="text-white/60">{body}</p>
        </li>
      ))}
    </ol>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  );
}
