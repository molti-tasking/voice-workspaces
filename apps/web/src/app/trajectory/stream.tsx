import { stackBands, stackHeight, type Trajectory } from "@voicemural/workspace";
import { Link } from "@/components/nav-link";

/**
 * The topic trajectory, as a stacked area.
 *
 * Hand-rolled SVG rather than a charting library. What is actually needed here
 * is a stack of closed polygons from an array of arrays, which is thirty lines
 * of path arithmetic — most of it already in `stackBands` — against a
 * dependency that would ship a layout engine, a scale system and a tooltip
 * framework to draw them.
 *
 * The reading: width is time, thickness is how much is currently held under a
 * topic, and a band that pinches to nothing is a thought that was finished
 * with. Bands are ordered by first appearance, never by size, so the picture
 * only changes when the thinking did.
 *
 * A server component. There is no hover, no tooltip and no client JavaScript:
 * every bucket is a link to the workspace at that instant, which is a page that
 * already exists and already renders the diff.
 */

const WIDTH = 960;
const HEIGHT = 260;
const PADDING_Y = 12;

/**
 * Band colours.
 *
 * Generated from a hue rotation rather than a palette, because the number of
 * topics is unbounded and a fixed palette would either run out or repeat
 * silently. Fixed saturation and lightness keep them all at the same visual
 * weight, so a band never looks more important than its neighbour for a reason
 * that is not its size.
 */
function bandColour(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1) + 200) % 360;
  return `hsl(${hue} 55% 58%)`;
}

export function Stream({
  trajectory,
  asOf,
}: {
  trajectory: Trajectory;
  asOf?: Date;
}) {
  const { buckets, tracks } = trajectory;
  const bands = stackBands(tracks);
  const tallest = stackHeight(tracks);

  const x = (i: number) =>
    buckets.length === 1 ? WIDTH / 2 : (i / (buckets.length - 1)) * WIDTH;
  const y = (value: number) =>
    HEIGHT - PADDING_Y - (value / tallest) * (HEIGHT - PADDING_Y * 2);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-64 w-full min-w-[640px]"
        role="img"
        aria-label={`${tracks.length} topics across ${buckets.length} recordings`}
      >
        {bands.map((band, index) => {
          const track = tracks[index]!;
          const top = band.map(([, upper], i) => `${x(i)},${y(upper!)}`);
          const bottom = [...band]
            .map(([lower], i) => ({ lower, i }))
            .reverse()
            .map(({ lower, i }) => `${x(i)},${y(lower!)}`);

          return (
            <polygon
              key={track.topicId}
              points={[...top, ...bottom].join(" ")}
              fill={bandColour(index, tracks.length)}
              fillOpacity={0.55}
              stroke={bandColour(index, tracks.length)}
              strokeOpacity={0.8}
              strokeWidth={1}
            >
              <title>{`${track.title} — ${track.current} block(s) now, ${track.weight} change(s) in total`}</title>
            </polygon>
          );
        })}

        {/* One tick per recording. Not a time axis: the buckets are
            event-dense, so spacing them evenly is honest about ordering and
            silent about duration, which is the right trade for "what happened
            when I was actually thinking". */}
        {buckets.map((at, i) => (
          <line
            key={at.toISOString()}
            x1={x(i)}
            x2={x(i)}
            y1={HEIGHT - PADDING_Y}
            y2={HEIGHT - PADDING_Y + 4}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
        ))}
      </svg>

      {/* The scrubber. Every bucket is a link, and both bounds live in the URL,
          so "the workspace as it stood after Tuesday, and what that recording
          changed" is a thing you can send someone. */}
      <ol className="mt-2 flex min-w-[640px] justify-between text-[11px] text-white/30">
        {buckets.map((at, i) => {
          const since = buckets[i - 1];
          const params = new URLSearchParams({ asOf: at.toISOString() });
          if (since) params.set("since", since.toISOString());
          const selected = asOf !== undefined && Math.abs(+asOf - +at) < 1000;

          return (
            <li key={at.toISOString()}>
              <Link
                href={`/workspace?${params.toString()}`}
                className={[
                  "block rounded px-1 py-0.5 tabular-nums underline-offset-4 hover:underline",
                  selected ? "bg-white/10 text-white/70" : "hover:text-white/60",
                ].join(" ")}
              >
                {at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
