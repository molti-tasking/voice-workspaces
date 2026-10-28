import { NextResponse } from "next/server";
import {
  createDesign,
  createSession,
  deleteDesign,
  deleteTestSessions,
  setDesignStatus,
  updateDesignDetails,
} from "@voicemural/db/study-session";
import { currentUserId } from "@/lib/session";
import { ResearcherAction } from "@/lib/study/researcher-actions";
import { isResearcher } from "@/lib/study/researchers";
import { studyBaseUrl } from "@/lib/study/session-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The researchers' page's actions on the display study (`ResearcherAction`):
 * setups made, made active, closed, given a completion code, deleted; invites
 * made; tests deleted.
 *
 * A 404 for anyone not in `RESEARCHER_USER_IDS`, signed in or not, like the
 * page: nothing here should confirm it exists. 409 with a reason the page
 * shows for what the database refused — a name taken, a setup that has
 * sessions, a cell it does not have.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!isResearcher(userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = ResearcherAction.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const headers = { "Cache-Control": "no-store" };
  const body = parsed.data;
  const refused = (reason: string) => NextResponse.json({ error: reason }, { status: 409, headers });

  switch (body.action) {
    case "create_design": {
      const result = await createDesign(body.design);
      return result.ok ? NextResponse.json({ ok: true, name: result.design.name }, { headers }) : refused(result.reason);
    }
    case "set_status": {
      const result = await setDesignStatus(body.name, body.status);
      return result.ok ? NextResponse.json({ ok: true }, { headers }) : refused(result.reason);
    }
    case "update_details": {
      const result = await updateDesignDetails(body.name, { completionCode: body.completionCode, note: body.note });
      return result.ok ? NextResponse.json({ ok: true }, { headers }) : refused(result.reason);
    }
    case "delete_design": {
      const result = await deleteDesign(body.name);
      return result.ok ? NextResponse.json({ ok: true }, { headers }) : refused(result.reason);
    }
    case "invite": {
      try {
        const { session, blocks } = await createSession({
          design: body.name,
          orderIndex: body.orderIndex ?? undefined,
          test: body.test,
        });
        return NextResponse.json(
          {
            ok: true,
            ref: session.ref,
            cell: session.orderIndex,
            view: blocks[0]?.display ?? null,
            task: blocks[0]?.task ?? null,
            test: session.test,
            link: `${studyBaseUrl(req.url)}/study/session?code=${session.inviteCode}`,
          },
          { headers },
        );
      } catch (err) {
        // A closed setup, or a cell it does not have: said in the database's words.
        return refused(err instanceof Error ? err.message : String(err));
      }
    }
    case "delete_tests":
      return NextResponse.json({ ok: true, deleted: await deleteTestSessions(body.name) }, { headers });
  }
}
