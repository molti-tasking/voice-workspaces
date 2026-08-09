"use client";

import type { ReactNode } from "react";
import { capture } from "@/lib/analytics/client";
import { Link } from "@/components/nav-link";

/**
 * The timeline's marker pill, wrapped so the click can be recorded.
 *
 * This is the one place a user action points at a specific model call.
 * `extraction_id` is the same value as that generation's `$ai_trace_id`, so a
 * click here — and any survey answered on the page it leads to — can be
 * attributed to the exact extraction being reviewed. That join is what turns
 * feedback into an evaluation of the model rather than a satisfaction score.
 *
 * A client component only for the handler; `MarkerRow` stays on the server.
 */
export function MarkerLink({
  href,
  extractionId,
  opCount,
  totalTokens,
  resolvedModel,
  title,
  className,
  children,
}: {
  href: string;
  extractionId: string;
  opCount: number;
  totalTokens: number;
  resolvedModel: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={className}
      onClick={() => {
        capture("timeline_marker_clicked", {
          extraction_id: extractionId,
          op_count: opCount,
          total_tokens: totalTokens,
          resolved_model: resolvedModel,
        });
      }}
    >
      {children}
    </Link>
  );
}
