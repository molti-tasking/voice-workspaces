"use client";

/**
 * The pieces both parts of the Prolific study are built from: a page frame,
 * a 1-7 scale and the completion screen. Plain and readable on a laptop,
 * which is where a Prolific participant is; none of the app's dock or drive
 * bar (lib/study/routes.ts).
 */

export function StudyFrame({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-12 pb-24">
      <header className="mb-8">
        {eyebrow && (
          <p className="mb-2 text-sm font-medium tracking-wide text-fg/60 uppercase">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>
      <div className="space-y-6 leading-relaxed">{children}</div>
    </main>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="w-full cursor-pointer rounded-2xl bg-fg px-4 py-3 text-base font-semibold text-canvas transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-8"
    >
      {children}
    </button>
  );
}

export function Scale({
  question,
  low,
  high,
  value,
  disabled,
  onPick,
}: {
  question: string;
  low: string;
  high: string;
  value: number | null;
  disabled?: boolean;
  onPick: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{question}</legend>
      <div className="grid grid-cols-7 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={value === n}
            onClick={() => onPick(n)}
            className={[
              "min-h-11 cursor-pointer rounded-xl text-base font-medium disabled:opacity-40",
              value === n ? "bg-fg text-canvas" : "bg-fg/10 hover:bg-fg/15",
            ].join(" ")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg/55">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

/** A few labelled buttons, one of which can be picked. */
export function Choice<T extends string | boolean>({
  question,
  hint,
  options,
  value,
  onPick,
}: {
  question: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{question}</legend>
      {hint && <p className="mb-2 text-sm text-fg/60">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onPick(o.value)}
            className={[
              "min-h-11 cursor-pointer rounded-xl px-6 text-base font-medium",
              value === o.value ? "bg-fg text-canvas" : "bg-fg/10 hover:bg-fg/15",
            ].join(" ")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** What went wrong, or what is missing: red, and read out as it appears. */
export function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm font-medium text-red-300">
      {children}
    </p>
  );
}

/**
 * The end of a part: the code, and the way back to Prolific. The code is shown
 * as well as linked, because a blocked redirect must not cost anyone their pay.
 */
export function Completion({
  part,
  eyebrow,
  url,
  code,
  next,
}: {
  /** The recall study's part; the display study has one, and no eyebrow. */
  part?: 1 | 2;
  eyebrow?: string;
  url: string | null;
  code: string | null;
  next?: string;
}) {
  return (
    <StudyFrame eyebrow={eyebrow ?? (part ? `Part ${part} of 2` : undefined)} title="Thank you, you are done">
      {next && <p>{next}</p>}
      {code ? (
        <>
          <p>
            Your completion code is{" "}
            <code className="rounded bg-fg/10 px-2 py-1 font-mono text-base">{code}</code>
          </p>
          {url && (
            <a
              href={url}
              className="inline-block w-full rounded-2xl bg-fg px-4 py-3 text-center text-base font-semibold text-canvas sm:w-auto sm:px-8"
            >
              Return to Prolific
            </a>
          )}
        </>
      ) : (
        <ErrorLine>No completion code is configured. Please message the researchers on Prolific.</ErrorLine>
      )}
    </StudyFrame>
  );
}
