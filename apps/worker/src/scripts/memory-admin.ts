/**
 * Memory index maintenance.
 *
 *   pnpm memory:status               rows per user, models in use, drives waiting
 *   pnpm memory:reindex              forget every derived entry and rebuild now
 *   pnpm memory:show --user <id>     print the topic entries as the model reads them
 *
 * `reindex` is what a MODEL_EMBED change needs: rows carry the model that made
 * them and search only sees the current one, so until this runs recall is
 * lexical-only. All accept `--user <id>`; without it they cover every user.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { closeDb } from "@voicemural/db";
import { clearMemory, listTopicEntries, memoryStatus, usersNeedingMemoryIndex } from "@voicemural/db/memory";
import { hasEmbeddings } from "@voicemural/llm";
import { indexMemory } from "../jobs/index-memory";

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const userId = flag("user");

  switch (command) {
    case "status": {
      const rows = await memoryStatus();
      if (rows.length === 0) console.log("no users");
      for (const row of rows) {
        if (userId && row.userId !== userId) continue;
        console.log(
          `${row.userId}  passages=${row.passages}  topics=${row.topics}  ` +
            `models=${row.models.join(",") || "-"}  drives waiting=${row.unindexedSessions}`,
        );
      }
      console.log(hasEmbeddings() ? `MODEL_EMBED=${process.env.MODEL_EMBED}` : "MODEL_EMBED unset: index is off");
      break;
    }
    case "reindex": {
      if (!hasEmbeddings()) throw new Error("MODEL_EMBED is not set; nothing to index with.");
      await clearMemory(userId);
      const users = userId ? [userId] : await usersNeedingMemoryIndex();
      for (const id of users) {
        const result = await indexMemory(id);
        console.log(`${id}  ${JSON.stringify(result)}`);
      }
      break;
    }
    case "show": {
      if (!userId) throw new Error("show needs --user <id>");
      for (const entry of await listTopicEntries(userId)) {
        console.log(`--- ${entry.refId}  (${entry.updatedAt.toISOString()})`);
        console.log(entry.text);
      }
      break;
    }
    default:
      throw new Error("usage: memory-admin <status|reindex|show> [--user <id>]");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
