"use client";

/**
 * The inputs both survey pages are built from.
 *
 * Moved out of `survey-form.tsx` when the findings survey arrived, so the two
 * forms look and behave the same: large targets, nothing required, and a
 * scale that is a row of buttons rather than a slider a thumb has to hit.
 */

export function Field({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-fg/70">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-fg/55">{hint}</span>}
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-lg border border-line bg-fg/5 px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg/25 focus:border-fg/30 focus:outline-none"
      />
    </label>
  );
}

export const CHIP = "cursor-pointer rounded-full px-3 py-1.5 text-sm transition-colors";
export const CHIP_ON = "bg-fg/12 text-fg ring-1 ring-fg/25";
export const CHIP_OFF = "text-fg/60 hover:text-fg/70 ring-1 ring-fg/10";

export function Chips<T extends string>({
  label,
  options,
  labels,
  value,
  onPick,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | undefined;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-fg/70">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === value}
            onClick={() => onPick(option)}
            className={[CHIP, option === value ? CHIP_ON : CHIP_OFF].join(" ")}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function MultiChips<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (value: T[]) => void;
}) {
  const toggle = (option: T) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-fg/70">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option)}
              className={[CHIP, on ? CHIP_ON : CHIP_OFF].join(" ")}
            >
              {labels[option]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * One item as a row of targets, the same shape the recorder's ratings use.
 * Seven points unless told otherwise.
 */
export function Scale({
  label,
  low,
  high,
  value,
  onPick,
  points = 7,
}: {
  label: string;
  low: string;
  high: string;
  value: number | null;
  onPick: (value: number) => void;
  points?: number;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-fg/70">{label}</legend>
      {/* As wide as the buttons, so the anchors sit under the first and last. */}
      <div className="w-fit">
        <div className="flex gap-1.5">
          {Array.from({ length: points }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={n === value}
              onClick={() => onPick(n)}
              className={[
                "grid size-10 cursor-pointer place-items-center rounded-lg text-sm tabular-nums transition-colors",
                n === value ? CHIP_ON : "text-fg/60 ring-1 ring-fg/10 hover:text-fg/70",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-between gap-4 text-xs text-fg/50">
          <span>{low}</span>
          <span className="text-right">{high}</span>
        </div>
      </div>
    </fieldset>
  );
}
