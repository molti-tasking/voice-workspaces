import { SquareKanban } from "lucide-react";
import { boardEnabledAt } from "@voicemural/db/board";
import { Link } from "./nav-link";

/**
 * The header link to `/board`, for the participants it is switched on for.
 *
 * Reads `board_enabled_at` itself rather than taking a flag, so every page
 * header shows or hides the link from the one column that decides it — and
 * the before/after phase of the study cannot drift between pages.
 */
export async function BoardLink({
  userId,
  className = "flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline",
  size = 14,
}: {
  userId: string;
  className?: string;
  size?: number;
}) {
  if (!(await boardEnabledAt(userId))) return null;

  return (
    <Link href="/board" className={className}>
      <SquareKanban size={size} aria-hidden />
      Board
    </Link>
  );
}
