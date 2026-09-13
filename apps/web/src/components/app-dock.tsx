import { boardEnabledAt } from "@voicemural/db/board";
import { currentUser } from "@/lib/session";
import { AppDockClient } from "./app-dock-client";

/**
 * The dock, with the one question only the server can answer resolved.
 *
 * `board_enabled_at` decides whether the board exists for this participant,
 * and it is read here for the same reason `BoardLink` read it: the study's
 * before/after phase must come from the one column that defines it, so the
 * dock and the overflow menu cannot drift apart mid-study.
 *
 * Renders nothing for a signed-out visitor — the landing page owns that case,
 * and a record button for nobody is a dead target.
 */
export async function AppDock() {
  const user = await currentUser();
  if (!user) return null;

  // `boardEnabledAt` returns the timestamp itself, which is also the flag.
  return <AppDockClient boardEnabled={(await boardEnabledAt(user.id)) !== null} />;
}
