"use client";

import { Check, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CONVERSATION_DISPLAYS, normalizeDisplay, type ConversationDisplay } from "@voicemural/shared";
import { Link } from "@/components/nav-link";
import { useLocalValue, writeLocalValue } from "@/lib/local-value";

/**
 * Which way the conversation is shown (`ConversationView`): a choice of this
 * browser, kept across conversations, and the same switch on the recorder,
 * on a past conversation's page and in the simulated conversation. A drive
 * whose condition forces a view has no switch at all.
 *
 * TWO VIEWS, AND THE REST BEHIND A BUTTON (2 Nov 2026). The app is
 * consolidated onto one screen: the Stack, with the plain Transcript (the
 * `chat` display) as the one alternative. The five other views from the
 * display studies (Topics, Uptake, Now, Open, Recent) still work and stay
 * selectable for the study setups, but only from the menu at the top right,
 * so the everyday screen offers one choice, not seven.
 *
 * A new storage key, so everyone starts on the Stack: the old key held
 * "chat" for almost everyone, because Chat was the default until now.
 */

const VIEW_KEY = "souffleur.record-view.v2";

/** Each view's name, as the researchers' page and the menu name them. */
export const VIEW_LABELS: Record<ConversationDisplay, string> = {
  chat: "Chat",
  topics: "Topics",
  uptake: "Uptake",
  now: "Now",
  open: "Open",
  recent: "Recent",
  stack: "Stack",
};

/** The two everyday views, in the order the switch shows them, with the switch's names. */
const PRIMARY_VIEWS = [
  { id: "stack", label: "Stack" },
  { id: "chat", label: "Transcript" },
] as const satisfies readonly { id: ConversationDisplay; label: string }[];

/** The views from the earlier display studies: kept, not on the switch. */
const OTHER_VIEWS = CONVERSATION_DISPLAYS.filter((v) => !PRIMARY_VIEWS.some((p) => p.id === v));

const DEFAULT_VIEW: ConversationDisplay = "stack";

export function useRecordView(): ConversationDisplay {
  // A view remembered from before the views were renamed reads as its successor.
  const stored = normalizeDisplay(useLocalValue(VIEW_KEY));
  return (CONVERSATION_DISPLAYS as readonly unknown[]).includes(stored) ? (stored as ConversationDisplay) : DEFAULT_VIEW;
}

/**
 * The comprehension monitor (DRAFT): on unless turned off in the menu. Never
 * on a study drive, which fixes its own view and does not get this switch.
 */
const MONITOR_KEY = "souffleur.rethink";

export function useMonitorOn(): boolean {
  return useLocalValue(MONITOR_KEY) !== "off";
}

function chooseView(view: ConversationDisplay): void {
  writeLocalValue(VIEW_KEY, view);
}

/**
 * Topics | Transcript: one tap, sized for a thumb but small enough to sit at
 * the top right beside the stop. When one of the other views is chosen the
 * switch shows neither as pressed, and the menu says which one it is.
 */
export function ViewSwitch({ view }: { view: ConversationDisplay }) {
  return (
    <div role="group" aria-label="Show the conversation as" className="flex shrink-0 rounded-full bg-fg/[0.06] p-0.5">
      {PRIMARY_VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => chooseView(id)}
          className={[
            "min-h-9 cursor-pointer rounded-full px-3 text-[13px] transition-colors",
            view === id ? "bg-surface font-semibold text-fg shadow-sm" : "text-fg/65 hover:text-fg",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The button at the top right: the other views, and the pages that used to
 * be tabs (past conversations, and the older workspace, board and timeline),
 * which are no longer the way through the app but are still there.
 */
export function MoreMenu({
  view,
  canChooseView = true,
  links = MORE_LINKS,
}: {
  view: ConversationDisplay;
  canChooseView?: boolean;
  links?: readonly { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const monitorOn = useMonitorOn();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-label="More views and pages"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 cursor-pointer place-items-center rounded-full text-fg/65 hover:bg-fg/[0.08] hover:text-fg"
      >
        <Ellipsis size={18} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1 w-56 overflow-hidden rounded-2xl border border-line bg-surface py-1 text-sm shadow-lg"
        >
          {canChooseView && (
            <>
              <p className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-fg/50 uppercase">Other views</p>
              {OTHER_VIEWS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={view === id}
                  onClick={() => {
                    chooseView(id);
                    setOpen(false);
                  }}
                  className="flex min-h-10 w-full cursor-pointer items-center justify-between px-3 text-left text-fg/80 hover:bg-fg/[0.06] hover:text-fg"
                >
                  {VIEW_LABELS[id]}
                  {view === id && <Check size={15} aria-hidden />}
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={monitorOn}
                onClick={() => writeLocalValue(MONITOR_KEY, monitorOn ? "off" : "on")}
                className="flex min-h-10 w-full cursor-pointer items-center justify-between px-3 text-left text-fg/80 hover:bg-fg/[0.06] hover:text-fg"
              >
                <span>
                  Rethink checks <span className="text-xs text-fg/45">draft</span>
                </span>
                {monitorOn && <Check size={15} aria-hidden />}
              </button>
              {links.length > 0 && <div className="my-1 border-t border-line" />}
            </>
          )}
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center px-3 text-fg/80 hover:bg-fg/[0.06] hover:text-fg"
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** The pages the menu leads to. The workspace, board and timeline are kept, not developed. */
const MORE_LINKS: readonly { href: string; label: string }[] = [
  { href: "/conversations", label: "Past conversations" },
  { href: "/workspace", label: "Workspace (older)" },
  { href: "/board", label: "Board (older)" },
  { href: "/timeline", label: "Timeline (older)" },
];
