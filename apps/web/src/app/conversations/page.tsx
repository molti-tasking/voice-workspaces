import type { Metadata } from "next";
import { listSessionsWithStats, loadSessionHeads, type SessionHead } from "@voicemural/db/sessions";
import { formatOffset } from "@voicemural/shared";
import { contentWords, searchConversations, type TranscriptHit } from "@voicemural/talkback";
import { AppDock } from "@/components/app-dock";
import { Link } from "@/components/nav-link";
import { NavMenu } from "@/components/nav-menu";
import { When } from "@/components/when";
import { ViewEvent } from "@/lib/analytics/view-event";
import { currentUser } from "@/lib/session";
import { transcriptHref } from "../board/brief-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conversations",
  robots: { index: false, follow: false },
};

/** Drives per page of the list. A row is one line and a half on a phone. */
const PAGE_SIZE = 30;
/** Search hits shown. Ranked, so the useful ones are at the top. */
const MAX_HITS = 40;
const MAX_QUERY_CHARS = 200;

/**
 * Finding a past conversation, by what it was about or by what was said.
 *
 * "The tool does not allow me to view my past transcripts easily" (7 Oct
 * 2026). The only way back to a drive was Timeline, which reads every
 * transcript end to end with a date over each — fine for reading, no help for
 * finding. Here each drive is one row, named by the last live title the agent
 * gave it (`capture_session.title`) or, failing that, by its first words; and
 * a search over everything said opens the drive at the line that matched.
 *
 * Not the session list that was removed on 28 Sep 2026 for being "a second
 * list of the same drives the timeline shows": that one was dates and counts.
 * This replaces Timeline in the dock, and Timeline moves to the menu, so the
 * number of places stays the same.
 */
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-fg/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to see your conversations.
        </p>
      </main>
    );
  }

  const params = await searchParams;
  const query = (params.q ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 0;

  return (
    // Bottom padding clears the dock and its scrim.
    <div className="mx-auto max-w-2xl vm-page-top px-6 pb-40">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Conversations</h1>
        <NavMenu />
      </header>

      {/* A plain GET form: it works before any script has loaded, the query
          lands in the URL so a search can be reloaded or shared, and the back
          button returns to it. */}
      <form action="/conversations" method="get" role="search" className="mb-8">
        <label htmlFor="conversation-search" className="sr-only">
          Search what was said
        </label>
        <input
          id="conversation-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search what was said…"
          enterKeyHint="search"
          autoComplete="off"
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/40 px-4 py-3 text-base text-fg placeholder:text-fg/40 focus:border-fg/40 focus:outline-none"
        />
      </form>

      {query ? (
        <SearchResults userId={user.id} query={query} />
      ) : (
        <DriveList userId={user.id} page={page} />
      )}

      <AppDock />
    </div>
  );
}

async function DriveList({ userId, page }: { userId: string; page: number }) {
  // One extra row says whether there is an older page, without a count query.
  const rows = await listSessionsWithStats(userId, PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasOlder = rows.length > PAGE_SIZE;
  // A drive with nothing in it and nothing still on its way is a mis-tap.
  const drives = rows.slice(0, PAGE_SIZE).filter((d) => d.utteranceCount > 0 || d.pendingChunks > 0);

  return (
    <>
      <ViewEvent
        event="conversations_viewed"
        properties={{ searched: false, result_count: drives.length, page }}
      />
      {drives.length === 0 && page === 0 ? (
        <p className="text-sm text-fg/60">
          Nothing recorded yet.{" "}
          <Link href="/record" className="underline">
            Start a conversation
          </Link>{" "}
          and it will appear here.
        </p>
      ) : (
        <ol className="divide-y divide-[var(--color-line)]">
          {drives.map((drive) => (
            <li key={drive.id}>
              <Link href={transcriptHref(drive.id)} className="block py-3 hover:bg-fg/[0.03]">
                <DriveName title={drive.title} firstWords={drive.firstWords} />
                <p className="mt-0.5 text-xs text-fg/55 tabular-nums">
                  <When date={drive.startedAt} withTime /> · {formatOffset(drive.recordedMs)}
                  {drive.pendingChunks > 0 && " · still transcribing"}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {(page > 0 || hasOlder) && (
        <nav className="mt-6 flex justify-between text-sm text-fg/60" aria-label="Pages">
          {page > 0 ? (
            <Link href={page === 1 ? "/conversations" : `/conversations?page=${page - 1}`} className="hover:text-fg">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {hasOlder && (
            <Link href={`/conversations?page=${page + 1}`} className="hover:text-fg">
              Older →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

/** The drive's name: its saved title, else its first words in quotes. */
function DriveName({ title, firstWords }: { title: string | null; firstWords: string | null }) {
  if (title) return <p className="truncate font-medium text-fg">{title}</p>;
  if (firstWords) {
    return <p className="truncate text-fg/75 italic">&ldquo;{clipWords(firstWords, 12)}&rdquo;</p>;
  }
  return <p className="text-fg/55">Untitled</p>;
}

async function SearchResults({ userId, query }: { userId: string; query: string }) {
  let hits: TranscriptHit[];
  try {
    hits = await searchConversations(userId, query, { limit: MAX_HITS });
  } catch {
    // Said, not shown as "nothing found": an empty result that was really a
    // failure is the mistake the agent's web search made on the same day.
    return <p className="text-sm text-amber-300">The search could not run just now. Try again in a moment.</p>;
  }

  const words = contentWords(query);
  const heads = new Map(
    (await loadSessionHeads(userId, [...new Set(hits.map((h) => h.captureSessionId))])).map((h) => [h.id, h]),
  );
  // Grouped under their drive, in the order the drives first rank.
  const groups = new Map<string, TranscriptHit[]>();
  for (const hit of hits) {
    if (!heads.has(hit.captureSessionId)) continue;
    groups.set(hit.captureSessionId, [...(groups.get(hit.captureSessionId) ?? []), hit]);
  }

  return (
    <>
      <ViewEvent event="conversations_viewed" properties={{ searched: true, result_count: hits.length, page: 0 }} />
      {groups.size === 0 ? (
        <p className="text-sm text-fg/60">
          {words.length === 0
            ? "Search for a word that was said — a name, a place, a topic."
            : "Nothing said in your conversations matches that."}{" "}
          <Link href="/conversations" className="underline">
            All conversations
          </Link>
        </p>
      ) : (
        <div className="space-y-6">
          {[...groups].map(([sessionId, inDrive]) => (
            <SearchGroup key={sessionId} head={heads.get(sessionId)!} hits={inDrive} words={words} />
          ))}
        </div>
      )}
    </>
  );
}

function SearchGroup({ head, hits, words }: { head: SessionHead; hits: TranscriptHit[]; words: string[] }) {
  return (
    <section>
      <Link href={transcriptHref(head.id)} className="mb-1.5 flex items-baseline justify-between gap-3 hover:text-fg">
        <span className="min-w-0 truncate text-sm font-medium text-fg/85">{head.title ?? "Untitled"}</span>
        <When date={head.startedAt} withTime className="shrink-0 text-xs text-fg/50 tabular-nums" />
      </Link>
      <ul className="space-y-1.5">
        {hits.map((hit) => (
          <li key={hit.utteranceId}>
            <Link
              href={transcriptHref(head.id, hit.utteranceId)}
              className="block rounded-lg bg-fg/[0.04] px-3 py-2 text-sm leading-snug text-fg/75 hover:bg-fg/[0.08]"
            >
              <Highlighted text={clipWords(hit.text, 40)} words={words} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The searched words marked in a snippet, matched as `contentWords` saw them. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "giu");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-400/25 px-0.5 text-fg">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function clipWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > max ? `${words.slice(0, max).join(" ")}…` : words.join(" ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
