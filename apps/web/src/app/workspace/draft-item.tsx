import type { WorkspaceDraft } from "@voicemural/db/drafts";
import { Link } from "@/components/nav-link";
import { When } from "@/components/when";
import { ArchiveDraftButton } from "./curation";

/**
 * A draft the agent wrote during a drive, where the workspace shows it: on the
 * topic it was filed on, or under "From your drives".
 *
 * Closed by default — a list of songs or an email is long, and the card is a
 * summary — with the title and the date always visible, so it can be found.
 * The full text, versions and editing stay on the drive's own page.
 */
export function DraftItem({
  draft,
  editable = true,
}: {
  draft: WorkspaceDraft;
  editable?: boolean;
}) {
  return (
    <li className="group flex gap-2">
      <details className="min-w-0 flex-1 rounded-lg bg-fg/[0.04] px-3 py-2">
        <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{draft.title || "Draft"}</span>
          <When date={draft.updatedAt} className="shrink-0 text-xs text-fg/55" />
        </summary>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-fg/80">{draft.text}</p>
        <Link
          href={`/sessions/${draft.captureSessionId}`}
          className="mt-2 inline-block text-xs text-fg/55 underline hover:text-fg/80"
        >
          Open in its drive · {draft.version}
        </Link>
      </details>
      {editable && <ArchiveDraftButton draftId={draft.id} />}
    </li>
  );
}
