"use client";

import {
  Book,
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Languages,
  Monitor,
  PenLine,
  Search,
  Share,
  Smartphone,
  SquarePlus,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SITE } from "@/lib/site";

/**
 * Putting the app on the home screen, drawn rather than described.
 *
 * ## Why it is on this page
 *
 * The service worker exists so that the install is offered at all, and the
 * manifest points the installed icon at `/record` — but neither does anything
 * until somebody actually adds it, and an icon on the home screen is the
 * difference between starting a recording before pulling away and hunting for
 * a tab in a car park (see `public/sw.js`). That makes it a setup step for the
 * study rather than a nicety, so it belongs beside the invitation instead of in
 * a help page nobody opens.
 *
 * ## Why it is drawn
 *
 * "Tap the share button" assumes you already know which of the five glyphs in
 * Safari's bottom bar is the share button. The audience here is being asked to
 * set something up once, on their own phone, probably standing next to a car.
 * So every step shows the control it is talking about — in the bar it lives in,
 * with its real neighbours around it, and a ring round the one to hit.
 *
 * The mock-ups are `aria-hidden` and inert. They are pictures of somebody
 * else's interface, so the instruction beside each one has to be complete on
 * its own for anyone reading with a screen reader or with images off.
 *
 * ## Why it does not nag
 *
 * The section removes itself the moment the app is running installed, and where
 * the browser offers a real install prompt (`beforeinstallprompt`, in practice
 * Chrome) the button does the whole job and the drawn steps fold away behind a
 * disclosure. Nobody is shown instructions for a thing they have already done.
 */

/** Which set of steps to draw. Not the same question as which browser. */
type Phone = "ios" | "android";

export function AddToHomeScreen({ host }: { host: string }) {
  const platform = usePlatform();
  const installed = useInstalled();
  const prompt = useInstallPrompt();
  /** Set only when they correct us — a bad guess must not be a dead end. */
  const [chosen, setChosen] = useState<Phone | null>(null);

  // Already installed: there is nothing to ask for.
  if (installed) return null;

  // `platform` is null until the first client render, and deliberately so — the
  // alternative is guessing on the server and flashing the wrong phone's
  // instructions at half the readers.
  if (platform === null) return null;

  const onDesk = platform === "desktop";
  const phone: Phone = chosen ?? (onDesk ? "ios" : platform);

  return (
    <section className="mb-8" aria-labelledby="install">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="install" className="text-sm font-medium">
          Put it on your home screen
        </h2>
        <div className="flex gap-1" role="group" aria-label="Which kind of phone">
          <PhoneTab phone="ios" current={phone} onChoose={setChosen} />
          <PhoneTab phone="android" current={phone} onChoose={setChosen} />
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-white/50">
        The installed icon opens straight into the recorder, full screen, so a drive
        starts with one tap instead of with finding a browser tab. Fifteen seconds,
        once.
        {onDesk && (
          <>
            {" "}
            You are on a computer, so this is one to do on the phone you will actually
            drive with — the steps are below either way.
          </>
        )}
      </p>

      {prompt.available && (
        <button
          type="button"
          onClick={prompt.install}
          className="mb-4 flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-ink-soft px-4 py-2.5 text-sm font-medium text-white/90 hover:border-white/30 hover:text-white"
        >
          <SquarePlus size={15} aria-hidden />
          {onDesk ? "Install it on this computer" : "Add to home screen"}
        </button>
      )}

      {prompt.available ? (
        // The button above does this for them; the steps stay reachable for the
        // case where it opens a dialog they were not expecting and back out of.
        <details>
          <summary className="w-fit cursor-pointer text-xs text-white/30 hover:text-white/60">
            Or add it by hand
          </summary>
          <div className="mt-4">
            <Steps phone={phone} host={host} />
          </div>
        </details>
      ) : (
        <Steps phone={phone} host={host} />
      )}
    </section>
  );
}

function Steps({ phone, host }: { phone: Phone; host: string }) {
  return phone === "ios" ? <IosSteps /> : <AndroidSteps host={host} />;
}

/* --- iOS ------------------------------------------------------------------
   Safari only. Chrome and Firefox on iOS reach the same share sheet, so the
   drawing holds for them; an in-app browser — which is how a link sent by
   message usually opens — cannot do it at all, and the note at the end is
   there because that failure looks exactly like the feature being missing. */

function IosSteps() {
  return (
    <>
      <ol className="space-y-4">
        <Step n={1} instruction="Tap the share button — the box with the arrow out of the top — in the bar along the bottom of Safari.">
          <Mock>
            <div className="flex items-center justify-between gap-1">
              <Glyph>
                <ChevronLeft size={17} />
              </Glyph>
              <Glyph>
                <ChevronRight size={17} />
              </Glyph>
              <Glyph hit>
                <Share size={17} />
              </Glyph>
              <Glyph>
                <Book size={17} />
              </Glyph>
              <Glyph>
                <Copy size={17} />
              </Glyph>
            </div>
          </Mock>
        </Step>

        <Step
          n={2}
          instruction="Scroll the sheet down past the row of apps, then tap “Add to Home Screen”."
        >
          <Mock>
            <Rows>
              <Row icon={<Search size={15} />}>Find on Page</Row>
              <Row hit icon={<SquarePlus size={15} />}>
                Add to Home Screen
              </Row>
              <Row icon={<PenLine size={15} />}>Markup</Row>
            </Rows>
          </Mock>
        </Step>

        <Step n={3} instruction="Tap “Add”, top right. The icon lands on your home screen.">
          <Mock>
            <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2 text-[11px]">
              <span className="text-white/25">Cancel</span>
              <span className="truncate text-white/40">Add to Home Screen</span>
              <Chip>Add</Chip>
            </div>
            <AppRow />
          </Mock>
        </Step>
      </ol>

      <p className="mt-4 text-xs leading-relaxed text-white/30">
        Opened this link from a message or an email? Some apps open links in a browser
        of their own, which has no “Add to Home Screen” — tap the share button and
        choose “Open in Safari” first.
      </p>
    </>
  );
}

/* --- Android --------------------------------------------------------------
   Chrome, where `beforeinstallprompt` usually means these steps are folded
   away behind the disclosure. They are still written out because Firefox and
   Samsung Internet never fire it, and because Chrome fires it once per page
   load — arriving here by a client-side navigation can miss it. */

function AndroidSteps({ host }: { host: string }) {
  return (
    <ol className="space-y-4">
      <Step n={1} instruction="Tap the three-dot menu in the top right of Chrome.">
        <Mock>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-white/30">
              {host}
            </span>
            <Glyph hit>
              <EllipsisVertical size={17} />
            </Glyph>
          </div>
        </Mock>
      </Step>

      <Step
        n={2}
        instruction="Choose “Add to Home screen”. Some versions of Chrome call it “Install app”."
      >
        <Mock>
          <div className="ml-auto w-48 max-w-full">
            <Rows>
              <Row icon={<Languages size={15} />}>Translate…</Row>
              <Row hit icon={<Smartphone size={15} />}>
                Add to Home screen
              </Row>
              <Row icon={<Monitor size={15} />}>Desktop site</Row>
            </Rows>
          </div>
        </Mock>
      </Step>

      <Step n={3} instruction="Tap “Install”. The icon lands on your home screen.">
        <Mock>
          <AppRow host={host} />
          <div className="mt-2.5 flex items-center justify-end gap-2 text-[11px]">
            <span className="px-2 py-0.5 text-white/25">Cancel</span>
            <Chip>Install</Chip>
          </div>
        </Mock>
      </Step>
    </ol>
  );
}

/* --- The pieces every step is drawn from ---------------------------------- */

/**
 * One numbered step: the sentence that has to stand alone, and the picture.
 *
 * Numbered with a span rather than an `<ol>` marker for the same reason the use
 * case cards are — the number is set in the mono face at a size a list marker
 * cannot be given.
 */
function Step({
  n,
  instruction,
  children,
}: {
  n: number;
  instruction: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 font-mono text-xs text-white/25 tabular-nums" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-sm leading-relaxed text-white/60">{instruction}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * A piece of the phone's own interface, drawn.
 *
 * Inert and hidden from assistive technology on purpose: it is a picture of a
 * control that lives somewhere else, and both tapping it and hearing it read
 * out would be misleading. Darker than the page so it reads as a quotation of
 * another surface rather than as part of this one.
 */
function Mock({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none rounded-lg border border-white/10 bg-black/40 p-2 select-none"
    >
      {children}
    </div>
  );
}

/** A stack of menu rows, hairline-separated the way both platforms draw them. */
function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-white/5 rounded-md bg-white/3">{children}</div>
  );
}

/** One row of a menu. `hit` is the row they are looking for. */
function Row({
  hit = false,
  icon,
  children,
}: {
  hit?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 px-2.5 py-2 text-[13px]",
        hit
          ? "rounded-md bg-white/10 text-white ring-2 ring-white/60"
          : "text-white/30",
      ].join(" ")}
    >
      <span className="truncate">{children}</span>
      <span className="shrink-0">{icon}</span>
    </div>
  );
}

/** One control in a drawn toolbar. Everything dim except the one to hit. */
function Glyph({ hit = false, children }: { hit?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={[
        "grid size-8 shrink-0 place-items-center rounded-lg",
        hit ? "bg-white/10 text-white ring-2 ring-white/60" : "text-white/25",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/** The button that finishes the job, drawn as the phone highlights it. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-white ring-2 ring-white/60">
      {children}
    </span>
  );
}

/**
 * The app as the confirmation dialog shows it.
 *
 * The real icon, at the size it is about to appear on their home screen, so
 * the last step ends on the thing they are looking for afterwards.
 *
 * A plain <img> rather than next/image: this exact file is precached by the
 * service worker (`PRECACHE` in public/sw.js) and served under the long-lived
 * header next.config.ts sets for `/icons/`, both of which a trip through the
 * optimiser at `/_next/image` would give up for a 36px decoration.
 */
function AppRow({ host }: { host?: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-[9px]" />
      <div className="min-w-0">
        <p className="truncate text-[13px] text-white/60">{SITE.name}</p>
        {host && <p className="truncate text-[10px] text-white/25">{host}</p>}
      </div>
    </div>
  );
}

/** The escape hatch for when the user agent string lied, or nobody asked it. */
function PhoneTab({
  phone,
  current,
  onChoose,
}: {
  phone: Phone;
  current: Phone;
  onChoose: (phone: Phone) => void;
}) {
  const active = phone === current;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChoose(phone)}
      className={[
        "cursor-pointer rounded-full px-3 py-1 text-xs transition-colors",
        active
          ? "bg-white/12 text-white ring-1 ring-white/25"
          : "text-white/40 hover:text-white/70",
      ].join(" ")}
    >
      {phone === "ios" ? "iPhone" : "Android"}
    </button>
  );
}

/* --- What the browser will tell us ---------------------------------------- */

/**
 * Which set of steps to show first, read off the user agent.
 *
 * User agent sniffing, which is normally the wrong answer — but the question
 * here is genuinely "whose share sheet am I drawing", and no feature detection
 * answers that. `PhoneTab` is the correction when it is wrong, so the cost of a
 * bad guess is one tap rather than a wrong instruction with no way past it.
 */
function detectPlatform(): Phone | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPhone|iPod|iPad/.test(ua)) return "ios";
  // An iPad on iPadOS 13+ claims to be a Mac. The touch points give it away,
  // and a touchscreen Mac is not a thing that exists.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function usePlatform(): Phone | "desktop" | null {
  // Null from the server snapshot, so the section renders nothing at all until
  // the client can answer. `detectPlatform` returns a string, so the snapshot
  // is stable by value and this never loops.
  return useSyncExternalStore(subscribeNever, detectPlatform, () => null);
}

function subscribeNever(): () => void {
  return () => {};
}

/**
 * Set once the browser reports the install went through.
 *
 * Module scope because the page that asked for the install is still an ordinary
 * tab afterwards: `display-mode` stays `browser` there, and without this the
 * instructions would sit under a freshly installed icon telling them to install
 * it. Cleared by the next full load, which is when the media query takes over.
 */
let installedHere = false;

/** Whether this document is the installed app rather than a tab. */
function useInstalled(): boolean {
  return useSyncExternalStore(subscribeInstalled, getInstalled, () => false);
}

function displayModeQuery(): MediaQueryList | null {
  // Both, because `display_override` in the manifest asks for minimal-ui as the
  // fallback and a minimal-ui window is just as installed as a standalone one.
  return (
    window.matchMedia?.("(display-mode: standalone), (display-mode: minimal-ui)") ?? null
  );
}

function getInstalled(): boolean {
  if (installedHere) return true;
  if (displayModeQuery()?.matches) return true;
  // Safari's original spelling, still the only answer on older iOS.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function subscribeInstalled(onChange: () => void): () => void {
  const query = displayModeQuery();
  const onInstalled = () => {
    installedHere = true;
    onChange();
  };
  query?.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    query?.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Chrome's own install prompt, if it offers one.
 *
 * Listened for in an effect rather than at module scope because the event
 * cannot fire before the service worker is registered, and registration waits
 * for `load` (`components/service-worker.tsx`) — so the listener is always in
 * place first on a fresh load. Reaching this page by a client-side navigation
 * long afterwards can miss it, and the drawn steps are what that person gets.
 */
function useInstallPrompt(): { available: boolean; install: () => void } {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keeps Chrome's own mini-infobar off the bottom of the page; the button
      // above is the same offer, in a place the copy can explain.
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const install = useCallback(() => {
    if (!event) return;
    void (async () => {
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        // Accepted: `appinstalled` fires and the whole section unmounts.
        // Dismissed: the event is spent and cannot be shown again, so drop it
        // and let the drawn steps take over rather than leaving a dead button.
        if (outcome === "dismissed") setEvent(null);
      } catch {
        setEvent(null);
      }
    })();
  }, [event]);

  return { available: event !== null, install };
}
