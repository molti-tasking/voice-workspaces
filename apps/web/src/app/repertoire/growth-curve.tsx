/**
 * The repertoire growing.
 *
 * Notes.md names this as the paper's dependent variable: "which capabilities
 * were added, when, after what triggering episode, and which survived". This is
 * the first two, drawn.
 *
 * A step chart, not a smooth line: the repertoire changes at discrete moments
 * and interpolating between them would draw a person acquiring half a
 * capability on a Tuesday. Split by origin, because the whole claim is that
 * needs cannot be specified in advance — a curve that is all `starter` is the
 * null result, and one that climbs on `crystallisation` is the finding.
 *
 * Hand-rolled SVG. Sixty lines against a charting dependency for a monotone
 * step function is not a trade worth making.
 */
const WIDTH = 640;
const HEIGHT = 140;
const PAD = 10;

export interface GrowthPoint {
  at: Date;
  createdVia: "starter" | "crystallisation" | "reflexive";
}

const ORIGIN_COLOUR: Record<GrowthPoint["createdVia"], string> = {
  starter: "hsl(215 15% 45%)",
  crystallisation: "hsl(150 55% 55%)",
  reflexive: "hsl(265 55% 62%)",
};

const ORIGIN_LABEL: Record<GrowthPoint["createdVia"], string> = {
  starter: "seeded",
  crystallisation: "crystallised from use",
  reflexive: "authored by voice",
};

export function GrowthCurve({ points }: { points: GrowthPoint[] }) {
  if (points.length === 0) return null;

  const ordered = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = ordered[0]!.at.getTime();
  // A repertoire seeded and never added to would otherwise divide by zero.
  const span = Math.max(ordered[ordered.length - 1]!.at.getTime() - first, 1);
  const total = ordered.length;

  const x = (at: Date) => PAD + ((at.getTime() - first) / span) * (WIDTH - PAD * 2);
  const y = (n: number) => HEIGHT - PAD - (n / total) * (HEIGHT - PAD * 2);

  // Steps: across to the moment it was added, then up by one.
  const path: string[] = [`M ${PAD} ${y(0)}`];
  ordered.forEach((point, i) => {
    path.push(`L ${x(point.at)} ${y(i)}`, `L ${x(point.at)} ${y(i + 1)}`);
  });
  path.push(`L ${WIDTH - PAD} ${y(total)}`);

  const byOrigin = new Map<GrowthPoint["createdVia"], number>();
  for (const point of ordered) {
    byOrigin.set(point.createdVia, (byOrigin.get(point.createdVia) ?? 0) + 1);
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-32 w-full min-w-[420px]"
          role="img"
          aria-label={`${total} capabilities acquired over time`}
        >
          <path d={path.join(" ")} fill="none" stroke="var(--color-line)" strokeWidth={1.5} />
          {ordered.map((point, i) => (
            <circle
              key={`${point.at.toISOString()}-${i}`}
              cx={x(point.at)}
              cy={y(i + 1)}
              r={3}
              fill={ORIGIN_COLOUR[point.createdVia]}
            >
              <title>{`${ORIGIN_LABEL[point.createdVia]} — ${point.at.toLocaleDateString()}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/35">
        {[...byOrigin.entries()].map(([origin, count]) => (
          <li key={origin} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: ORIGIN_COLOUR[origin] }}
            />
            {count} {ORIGIN_LABEL[origin]}
          </li>
        ))}
      </ul>
    </div>
  );
}
