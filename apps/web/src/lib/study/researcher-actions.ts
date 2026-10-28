import { z } from "zod";
import { CompletionCode, DesignInput, DesignName } from "@voicemural/shared";

/**
 * What the researchers' page (/researcher) asks of `/api/researcher/study`:
 * the display study's setups and sessions, managed from a browser instead of
 * `pnpm study:session` in the worker's container. Shared by the page and the
 * route, and safe in the browser.
 */
export const ResearcherAction = z.discriminatedUnion("action", [
  /** A new setup, as a draft. */
  z.object({ action: z.literal("create_design"), design: DesignInput }),
  /** Make it the one new sessions go to (the one that was closes), or close it. */
  z.object({ action: z.literal("set_status"), name: DesignName, status: z.enum(["active", "closed"]) }),
  /** What may change at any time: the completion code and the note. */
  z.object({
    action: z.literal("update_details"),
    name: DesignName,
    completionCode: CompletionCode.nullable(),
    note: z.string().trim().max(500).nullable(),
  }),
  /** A setup nobody took part in. */
  z.object({ action: z.literal("delete_design"), name: DesignName }),
  /** An invite link: its cell, or the least held; a test holds none. */
  z.object({
    action: z.literal("invite"),
    name: DesignName,
    orderIndex: z.number().int().min(0).max(63).nullable(),
    test: z.boolean(),
  }),
  /** Every test of the setup, with its blocks and moments. */
  z.object({ action: z.literal("delete_tests"), name: DesignName }),
]);
export type ResearcherAction = z.infer<typeof ResearcherAction>;

/** The files the page offers for a setup. `transcripts` carries their words. */
export const EXPORT_FILES = ["sessions", "blocks", "moments", "prolific-key", "transcripts"] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];
