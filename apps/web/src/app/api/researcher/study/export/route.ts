import { NextResponse } from "next/server";
import { buildProlificKey, buildSessionExport, toCsv } from "@voicemural/db/study-export";
import { findDesign } from "@voicemural/db/study-session";
import { DesignName } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";
import { EXPORT_FILES, type ExportFile } from "@/lib/study/researcher-actions";
import { isResearcher } from "@/lib/study/researchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A setup's data as a download, for the researchers' page:
 * `?design=name&file=sessions|blocks|moments|prolific-key|transcripts`.
 * The same files as `pnpm study:session export`, tests left out, built fresh
 * on every request.
 *
 * Their words are in them — summaries and what they wrote, and the
 * conversations themselves in `transcripts` — and `prolific-key` says who
 * each pseudonym is. A 404 for anyone not in `RESEARCHER_USER_IDS`; never
 * cached anywhere on the way.
 */
export async function GET(req: Request) {
  const userId = await currentUserId(req);
  if (!isResearcher(userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const params = new URL(req.url).searchParams;
  const name = DesignName.safeParse(params.get("design"));
  const file = params.get("file") as ExportFile | null;
  if (!name.success || !file || !EXPORT_FILES.includes(file)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!(await findDesign(name.data))) return NextResponse.json({ error: "unknown" }, { status: 404 });

  const design = name.data;
  let content: string;
  let type = "text/csv; charset=utf-8";
  let extension = "csv";
  if (file === "prolific-key") {
    content = toCsv(await buildProlificKey({ design }));
  } else if (file === "transcripts") {
    const { transcripts } = await buildSessionExport({ design, text: true });
    content = transcripts.map((t) => JSON.stringify(t)).join("\n") + (transcripts.length ? "\n" : "");
    type = "application/x-ndjson; charset=utf-8";
    extension = "jsonl";
  } else {
    content = toCsv((await buildSessionExport({ design }))[file]);
  }

  return new NextResponse(content, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${design}-${file}.${extension}"`,
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex",
    },
  });
}
