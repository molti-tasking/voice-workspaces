"use client";

import { Link as TransitionLink } from "next-view-transitions";
import { usePathname } from "next/navigation";
import { useEffect, type ComponentProps } from "react";

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
  { prefix: "/sessions", depth: 1 },
  { prefix: "/timeline", depth: 0 },
  { prefix: "/record", depth: 0 },
  { prefix: "/", depth: 0 },
];

function depthOf(pathname: string): number {
  return ROUTE_DEPTH.find((r) => pathname.startsWith(r.prefix))?.depth ?? 0;
}

export type NavDirection = "forward" | "back" | "record";

export function directionBetween(from: string, to: string): NavDirection {
  // Starting a recording is a change of activity, not a change of page, and
  // gets its own blur-and-resolve whatever transition mode is selected.
  if (to.startsWith("/record")) return "record";
  // Same depth still counts as forward: a plain rise reads better than a drop
  // for a sideways move.
  return depthOf(to) < depthOf(from) ? "back" : "forward";
}

function setDirection(direction: NavDirection) {
  document.documentElement.dataset.nav = direction;
}

/**
 * A link that tells the CSS which way the sheet should move.
 *
 * The direction is set in `onClick`, which next-view-transitions calls *before*
 * it starts the view transition — so the attribute is already in place when the
 * browser takes its snapshot and resolves the animations.
 */
export function Link({
  href,
  onClick,
  ...rest
}: ComponentProps<typeof TransitionLink>) {
  const pathname = usePathname();

  return (
    <TransitionLink
      href={href}
      onClick={(e) => {
        const target = typeof href === "string" ? href : (href.pathname ?? "");
        setDirection(directionBetween(pathname, target));
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

/**
 * Keeps the browser's back and forward buttons honest.
 *
 * The library starts a view transition on `popstate` too, and without this the
 * sheet would rise when the user is actually going back. On popstate the URL
 * has already changed, so the new path is readable directly.
 */
export function NavDirectionTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const onPopState = () => {
      setDirection(directionBetween(pathname, window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [pathname]);

  return null;
}
