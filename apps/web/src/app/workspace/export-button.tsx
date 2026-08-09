"use client";

import { Download } from "lucide-react";
import { capture } from "@/lib/analytics/client";
import { useState } from "react";

/**
 * Download a topic as a Markdown file.
 *
 * The Markdown is composed on the server by `topicToMarkdown` and passed in
 * whole; this only wraps it in a Blob and clicks a link. Keeping the rendering
 * server-side means the export logic stays pure and testable, and the only
 * JavaScript on the page is this handful of lines.
 */
export function ExportButton({
  markdown,
  filename,
  blockCount,
}: {
  markdown: string;
  filename: string;
  /** For analytics only: how much substance the exported topic had. */
  blockCount: number;
}) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      title={`Download ${filename}`}
      aria-label={`Download ${filename}`}
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        // Revoking immediately can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);

        // `export_format` alone was constant, so it distinguished nothing.
        // Which topic, and how much was in it, is what says whether the
        // workspace produced something a participant judged worth keeping.
        capture("workspace_topic_exported", {
          topic_slug: filename.replace(/\.md$/, ""),
          block_count: blockCount,
          bytes: markdown.length,
        });
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className={[
        "shrink-0 rounded p-1 transition-colors",
        done ? "text-emerald-400" : "text-white/20 hover:text-white/70",
      ].join(" ")}
    >
      <Download size={14} aria-hidden />
    </button>
  );
}
