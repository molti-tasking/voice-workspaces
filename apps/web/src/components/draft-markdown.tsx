import { Fragment } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

/**
 * A draft's text, rendered from the markdown the model wrote it in.
 *
 * React elements only, built from `parseMarkdown` — never an HTML string — so
 * a draft cannot inject markup however it is worded. Sizing, colour, scrolling
 * and selection stay with the caller through `className`, because each place a
 * draft is shown (the live card, the drive page, the workspace) sets its own.
 */
export function DraftMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={["space-y-1.5 break-words", className].filter(Boolean).join(" ")}>
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === "heading") {
          return (
            <p key={i} className="font-semibold text-fg">
              <Inlines parts={block.inline} />
            </p>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={i} className={["space-y-0.5 pl-5", block.ordered ? "list-decimal" : "list-disc"].join(" ")}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inlines parts={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inlines parts={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "strong":
            return (
              <strong key={i} className="font-semibold text-fg">
                {part.text}
              </strong>
            );
          case "em":
            return <em key={i}>{part.text}</em>;
          case "code":
            return (
              <code key={i} className="rounded bg-fg/10 px-1 font-mono text-[0.9em]">
                {part.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={part.href}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-fg"
              >
                {part.text}
              </a>
            );
          default:
            return <Fragment key={i}>{part.text}</Fragment>;
        }
      })}
    </>
  );
}
