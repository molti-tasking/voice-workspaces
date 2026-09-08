import { CircleSlash, Mic, PenLine, Sprout } from "lucide-react";

export interface CapabilityView {
  id: string;
  name: string;
  type: "mode" | "persona" | "action" | "rule";
  restatement: string | null;
  markdown: string;
  version: number;
  retiredAt: Date | null;
  createdVia: "starter" | "crystallisation" | "reflexive" | null;
  fires: number;
  lastFiredAt: Date | null;
  history: { version: number; restatement: string | null; createdAt: Date }[];
}

const ORIGIN = {
  starter: { label: "seeded", Icon: Sprout },
  crystallisation: { label: "from your own use", Icon: Mic },
  reflexive: { label: "authored by voice", Icon: PenLine },
} as const;

/**
 * One capability, with everything that makes it measurable.
 *
 * Version number, origin and fire count are on the card rather than behind a
 * click because they are the study's data, not metadata: how it arrived, how
 * often it was actually used, and whether it has been edited since. A card that
 * showed only the name and the description would look tidier and answer none of
 * the questions the repertoire exists to answer.
 *
 * The version history is a `<details>`. `capability_version` is append-only so
 * edits are visible by design — but the current version is what is in force,
 * and putting five superseded restatements above it would bury that.
 */
export function CapabilityCard({ capability }: { capability: CapabilityView }) {
  const origin = capability.createdVia ? ORIGIN[capability.createdVia] : null;
  const OriginIcon = origin?.Icon;
  const retired = capability.retiredAt !== null;

  return (
    <article
      className={[
        "rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-4",
        retired ? "opacity-45" : "",
      ].join(" ")}
    >
      <header className="mb-1 flex items-baseline gap-2">
        <h3 className={`font-medium ${retired ? "line-through" : ""}`}>{capability.name}</h3>
        {capability.version > 1 && (
          <span className="font-mono text-[10px] text-white/25">v{capability.version}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs text-white/30">
          {capability.fires === 0 ? "never used" : `${capability.fires}×`}
        </span>
      </header>

      {capability.restatement && (
        <p className="text-sm leading-snug text-white/60">{capability.restatement}</p>
      )}

      <footer className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/25">
        {origin && OriginIcon && (
          <span className="flex items-center gap-1">
            <OriginIcon size={11} aria-hidden />
            {origin.label}
          </span>
        )}
        {capability.lastFiredAt && (
          <span>
            last{" "}
            {capability.lastFiredAt.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
        {retired && (
          <span className="flex items-center gap-1">
            <CircleSlash size={11} aria-hidden />
            retired
          </span>
        )}
      </footer>

      {capability.history.length > 1 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[10px] text-white/20 hover:text-white/50">
            edited · {capability.history.length - 1} earlier version
            {capability.history.length === 2 ? "" : "s"}
          </summary>
          <ol className="mt-1 space-y-1 border-l border-[var(--color-line)] pl-2.5">
            {capability.history.slice(1).map((version) => (
              <li key={version.version} className="text-xs text-white/25">
                <span className="font-mono">v{version.version}</span>{" "}
                {version.restatement ?? "—"}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
