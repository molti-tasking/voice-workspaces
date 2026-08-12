import type { Metadata } from "next";
import Link from "next/link";

/**
 * The page participants read before day one, and re-read on their phone when
 * they forget what to do. Kept short on purpose: everything here has to survive
 * being skimmed once, in a car park.
 *
 * Two things are deliberately absent, and both matter:
 *
 * 1. **The phase structure.** Participants are not told that the repertoire is
 *    fixed for the first days and extensible afterwards. A participant who
 *    knows authoring is coming authors in response to us rather than to their
 *    own need, which is precisely the thing the deployment is trying to
 *    observe. This is partial disclosure, not deception — it has to be declared
 *    in the ethics application and undone in the exit debrief.
 *
 * 2. **The research questions.** No growth curve, no direction-versus-content,
 *    no talk of a repertoire. Telling someone we are counting the capabilities
 *    they create is the fastest way to make the count meaningless.
 *
 * The privacy boundary is a study design decision, not a courtesy. Participants
 * are recruited from people who know the research team, and someone who thinks
 * their supervisor might hear the tape does not think out loud — which would
 * leave the deployment measuring self-censorship. So the drive is unread and
 * the debrief is the channel addressed to us. Say nothing here that undercuts
 * that split.
 */

export const metadata: Metadata = {
  // The root layout's template appends " — VoiceMural".
  title: "Taking part",
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
  /** "on our own servers", or "by «provider», under a contract that …". */
  transcription: "«where speech is turned into text»",
  compensation: "«amount, paid on completion»",
};

const QUESTIONS = [
  "What did you want it to do that it couldn't?",
  "What did it do that you didn't ask for?",
  "What would you make into a thing, if that were easy?",
];

const PHRASES: [string, string][] = [
  [
    "Mark this",
    "Flags what you just said so it stands out later. Use it freely — it is the one thing that costs nothing to get wrong.",
  ],
  [
    "Make a diary entry",
    "Turns the drive into a dated write-up you can read afterwards.",
  ],
  ["Send it to the doc", "Appends that write-up to a document you nominate."],
  [
    "Interview me",
    "It starts asking you one question at a time instead of listening quietly. “Stop interviewing” ends it.",
  ],
];

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
          You already do some of your best thinking in the car, where you cannot
          write any of it down. For {STUDY.days} days, VoiceMural listens while
          you drive and keeps what you said. We want to find out whether that
          turns out to be worth anything.
        </p>
      </header>

      <Section n={1} title="What we are asking of you">
        <p>
          Record your normal commute — not a special trip, not a demonstration.
          Talk if you feel like talking. Say nothing if you do not. There is no
          target, and a quiet drive is real data.
        </p>
        <List>
          <li>Roughly {STUDY.days} days of ordinary commuting.</li>
          <li>A one-minute debrief once you have parked, after each drive.</li>
          <li>One conversation with us at the end, about 45 minutes.</li>
        </List>
      </Section>

      <Section n={2} title="A drive, start to finish">
        <Steps
          steps={[
            [
              "Before you pull away",
              <>
                Phone in the cradle, cable in, open <Code>/record</Code> and
                press <strong>Start recording</strong>. Check it says it is
                recording before you move off.
              </>,
            ],
            [
              "While you drive",
              <>
                Talk, or do not. Leave the app in front and the screen awake —
                recording stops if the phone locks or you switch apps, and that
                stretch cannot be recovered.
              </>,
            ],
            [
              "Once you have parked",
              <>
                Press <strong>Stop</strong>. Three questions appear on screen;
                answer them out loud, because it is still listening. Under a
                minute. Forget, and the recording closes itself.
              </>,
            ],
          ]}
        />
        <div className="rounded-xl border border-line p-5">
          <p className="mb-3 text-sm font-medium tracking-wide text-white/40 uppercase">
            The three questions
          </p>
          <ol className="space-y-2.5">
            {QUESTIONS.map((q, i) => (
              <li key={q} className="flex gap-3 leading-relaxed">
                <span className="shrink-0 font-mono text-sm text-white/30">
                  {i + 1}
                </span>
                {q}
              </li>
            ))}
          </ol>
        </div>
        <p className="text-white/50">
          Same three every time, so you can turn them over while you drive.
          &ldquo;Nothing today&rdquo; is a fine answer, and complaints are the
          useful one — if it keeps doing something irritating, say exactly that.
        </p>
      </Section>

      <Section n={3} title="Safety, which overrides everything else here">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
          <p className="mb-3 font-medium text-amber-100">
            Nothing in this study is worth taking your eyes off the road for.
          </p>
          <List className="text-amber-100/80">
            <li>
              The phone goes in a cradle, positioned before you set off. We
              supply one if you need it.
            </li>
            <li>
              Never touch or read it while the car is moving — not to check it is
              working, not to fix an error, not for anything. Whatever it wants,
              it can wait until you have parked.
            </li>
            <li>
              Talking to it should feel like talking to a passenger. If it ever
              feels more demanding than that, stop and tell us. That is a problem
              with our design, not with you.
            </li>
          </List>
        </div>
      </Section>

      <Section n={4} title="What you can say to it">
        <p>
          Mostly you ask it for nothing — it is recording, and everything you say
          is treated as something you meant to say. These are the exceptions,
          said in passing, the way you would ask a passenger to jot something
          down. The wording does not have to be exact.
        </p>
        <dl className="my-5 divide-y divide-line rounded-xl border border-line">
          {PHRASES.map(([phrase, what]) => (
            <div key={phrase} className="p-4">
              <dt className="mb-1 font-medium">&ldquo;{phrase}&rdquo;</dt>
              <dd className="text-sm leading-relaxed text-white/50">{what}</dd>
            </div>
          ))}
        </dl>
        <p>
          It will sometimes mishear and mark the wrong sentence. That is
          expected: it can only ever add to the recording, never edit or delete
          what you actually said.
        </p>
      </Section>

      <Section n={5} title="Nobody reads your drives">
        <p>
          You know us — which is exactly why it is built this way. Someone who
          suspects a colleague might hear the recording does not think out loud,
          and then there is nothing here worth studying.
        </p>
        <div className="my-5 rounded-xl border border-line bg-ink-soft p-5">
          <p className="mb-2 font-medium">
            No one on the research team listens to your drives or reads your
            transcripts.
          </p>
          <p className="text-sm leading-relaxed text-white/60">
            Not selectively, not in summary, not &ldquo;only if something looks
            interesting&rdquo;. Speech is turned into text {STUDY.transcription},
            the audio is deleted as soon as that is done, and the text stays in
            your account. It is not ours.
          </p>
        </div>
        <List>
          <li>
            <strong>What we see</strong> is counts and timings — how long you
            recorded, when you asked for something, whether it worked, what you
            named the things you made. Not what you talked about.
          </li>
          <li>
            <strong>What you hand us</strong> is the debrief after each drive,
            anything you mark as shareable, and whatever you show us in the final
            conversation. Quotes in a paper can only come from that, are
            anonymised, and go past you first.
          </li>
          <li>
            <strong>Passengers and phone calls are still recorded</strong> while
            it runs, even though we never hear it. Tell whoever is in the car, or
            leave that trip unrecorded.
          </li>
        </List>
        <p className="rounded-xl border border-line p-4">
          <strong className="font-medium">Deleting a drive.</strong> Tell us
          which one — the date and roughly the time is enough — and it goes, in
          full, within a working day. You never have to say why and we will not
          ask; since we cannot read it, we take your word for it.
        </p>
      </Section>

      <Section n={6} title="If it breaks, and how to stop">
        <p>
          It will break. It is a research prototype: recordings fail to upload,
          transcripts garble words, it reacts to things you never asked it to
          react to. <strong>None of that is your fault or yours to fix.</strong>{" "}
          Message {STUDY.researcher} once you have parked and carry on with the
          next drive — we check every day that recordings are arriving, so we
          often know before you do.
        </p>
        <List>
          <li>
            You can stop at any point, without a reason, and still be paid{" "}
            {STUDY.compensation}.
          </li>
          <li>
            You can skip any drive, any question, and anything in the final
            conversation.
          </li>
          <li>
            You can have everything deleted, up until the results are written up,
            and see everything we hold about you whenever you ask.
          </li>
        </List>
        <p className="text-sm text-white/40">
          Approved by the research ethics committee at {STUDY.institution} under{" "}
          {STUDY.approval}, which is also the data controller. If you have a
          concern you would rather not raise with us, the committee&rsquo;s
          details are on the consent form you signed.
        </p>
      </Section>

      <footer className="mt-14 border-t border-line pt-6">
        <p className="mb-4 text-white/50">
          Questions before you start, however small — ask. If something here is
          unclear, we wrote it badly.
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
          <span className="text-white/40">{STUDY.phone}</span>
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
    <ol className="my-5 space-y-5 border-l border-line pl-6">
      {steps.map(([label, body]) => (
        <li key={label} className="relative">
          <span className="absolute top-2 -left-[25px] size-2 rounded-full bg-line" />
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
