/**
 * How "deep" a route sits in the stack.
 *
 * The sheet transition is directional: the workspace is a sheet lying *on top
 * of* the timeline, so it rises into view and drops back out. Without a notion
 * of depth the animation is symmetric, and going back feels like going forward
 * again — which is what made the original version read wrong.
 */
const ROUTE_DEPTH: { prefix: string; depth: number }[] = [
  { prefix: "/workspace", depth: 1 },
  // A derived view alongside the workspace, folded from the same log.
  { prefix: "/board", depth: 1 },
  { prefix: "/sessions", depth: 1 },
  // Overviews, alongside the timeline rather than on top of it: both are ways
  // of reading the whole corpus, and moving between them is sideways.
  { prefix: "/trajectory", depth: 0 },
  { prefix: "/repertoire", depth: 0 },
  { prefix: "/timeline", depth: 0 },
  { prefix: "/record", depth: 0 },
  { prefix: "/", depth: 0 },
];

function depthOf(pathname: string): number {
  return ROUTE_DEPTH.find((r) => pathname.startsWith(r.prefix))?.depth ?? 0;
}

export type NavDirection = "forward" | "back" | "record" | "none";

export function directionBetween(from: string, to: string): NavDirection {
  // Starting a recording is a change of activity, not a change of page, and
  // gets its own blur-and-resolve whatever transition mode is selected.
  if (to.startsWith("/record")) return "record";
  const [fromDepth, toDepth] = [depthOf(from), depthOf(to)];
  if (toDepth < fromDepth) return "back";
  if (toDepth > fromDepth) return "forward";
  // SIDEWAYS IS A PLAIN CUT. It used to count as forward, so every dock tap
  // from the record screen to the timeline slid a whole new sheet up from the
  // bottom of the screen — mid-drive, over and over: "on timeline over and
  // over again, it always pops up" (27 Sep 2026). Nothing lies on top of
  // anything in a sideways move, so there is nothing for a sheet to say.
  return "none";
}
