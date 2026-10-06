"use client";

import { usePathname } from "next/navigation";
import { Link as TransitionLink, useTransitionRouter } from "next-view-transitions";
import { useCallback, useEffect, type ComponentProps } from "react";
import { directionBetween, type NavDirection } from "./nav-direction";

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
 * `Link`'s navigation, for code that moves somewhere without a link to click —
 * the dock's record button taking a new drive to the conversation view. Same
 * direction, same transition.
 */
export function useDirectedPush(): (href: string) => void {
  const pathname = usePathname();
  const router = useTransitionRouter();
  return useCallback(
    (href: string) => {
      setDirection(directionBetween(pathname, href));
      router.push(href);
    },
    [pathname, router],
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
