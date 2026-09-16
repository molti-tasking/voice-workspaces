import { describe, expect, it } from "vitest";
import { cardHandle } from "@voicemural/workspace";
import {
  MAX_DRAFT_CONTEXT_CHARS,
  buildDraftContext,
  draftHandle,
  type DraftForContext,
} from "./draft-context";

function draft(over: Partial<DraftForContext> & { id: string }): DraftForContext {
  return {
    title: "Email to William",
    text: "Dear William, the pilot starts on Monday.",
    version: "v1.0",
    author: "agent",
    ...over,
  };
}

// The handle is the LAST six hex characters, matching `cardHandle`.
const A = "00000000-0000-4000-8000-0000003f9a2c";
const B = "00000000-0000-4000-8000-000000b7e40d";

describe("draft handles", () => {
  it("are six hex characters off the lineage id", () => {
    expect(draftHandle(A)).toBe("3f9a2c");
    expect(draftHandle(B)).toBe("b7e40d");
  });

  it("match `cardHandle`, so one prompt never carries two handle formats", () => {
    expect(draftHandle(A)).toBe(cardHandle(A));
    expect(draftHandle(A.toUpperCase())).toBe("3f9a2c");
  });
});

describe("the draft context block", () => {
  it("is nothing at all when the drive has produced no drafts", () => {
    expect(buildDraftContext([])).toEqual({ text: null, shown: 0, total: 0 });
  });

  it("names each draft with its handle, version and who last touched it", () => {
    const block = buildDraftContext([
      draft({ id: A }),
      draft({ id: B, title: "Notes", version: "v1.1", author: "user", text: "Some notes." }),
    ]);

    expect(block.text).toContain('draft 3f9a2c "Email to William" (v1.0, written by you)');
    expect(block.text).toContain('draft b7e40d "Notes" (v1.1, last edited by them)');
    expect(block.shown).toBe(2);
    expect(block.total).toBe(2);
  });

  it("includes the bodies, so a revision is a rewrite rather than a fresh guess", () => {
    const block = buildDraftContext([draft({ id: A, text: "Dear William." })]);
    expect(block.text).toContain("draft 3f9a2c:\nDear William.");
  });

  it("lists at most six, keeping the newest", () => {
    const drafts = Array.from({ length: 8 }, (_, i) =>
      draft({ id: `00000000-0000-4000-8000-00000000000${i}`, text: `body ${i}` }),
    );
    const block = buildDraftContext(drafts);

    // The first two are an hour ago and the least likely to be the one being
    // revised.
    expect(block.text).not.toContain("body 0");
    expect(block.text).not.toContain("body 1");
    expect(block.text).toContain("body 7");
    expect(block.total).toBe(8);
  });

  it("skips a body that does not fit rather than cutting it short", () => {
    const huge = "x".repeat(MAX_DRAFT_CONTEXT_CHARS + 1);
    const block = buildDraftContext([
      draft({ id: A, title: "Short one", text: "Dear William." }),
      draft({ id: B, title: "Huge one", text: huge }),
    ]);

    // A truncated body is the worst outcome: the model cannot tell it is
    // truncated, so it rewrites the draft and deletes the half it never saw.
    expect(block.text).not.toContain("xxxx");
    expect(block.text).toContain('draft b7e40d "Huge one" (v1.0, written by you, text not shown)');
    // …and the short one is still there. A greedy fill, not a stop at the first
    // over-budget body.
    expect(block.text).toContain("draft 3f9a2c:\nDear William.");
    expect(block.shown).toBe(1);
  });

  it("stays inside its budget however many drafts there are", () => {
    const drafts = Array.from({ length: 6 }, (_, i) =>
      draft({ id: `00000000-0000-4000-8000-00000000000${i}`, text: "y".repeat(600) }),
    );
    const block = buildDraftContext(drafts);
    const bodyChars = (block.text ?? "").match(/y/g)?.length ?? 0;
    expect(bodyChars).toBeLessThanOrEqual(MAX_DRAFT_CONTEXT_CHARS);
    expect(block.shown).toBeLessThan(6);
  });

  it("calls an untitled draft untitled rather than rendering an empty label", () => {
    const block = buildDraftContext([draft({ id: A, title: "" })]);
    expect(block.text).toContain('draft 3f9a2c "untitled"');
  });
});
