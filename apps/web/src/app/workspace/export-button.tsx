"use client";

import { Download } from "lucide-react";
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
}: {
  markdown: string;
  filename: string;
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
