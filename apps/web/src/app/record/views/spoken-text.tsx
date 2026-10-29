import { Fragment, type CSSProperties } from "react";
import { spokenLine, type SpokenWord } from "@/lib/talkback/spoken";

/**
 * A turn's words while the agent's voice is saying them (lib/talkback/spoken.ts):
 * every word in its place from the start, the ones the voice has not reached
 * held invisible, each fading in as it is said (`vm-word-in`). A turn already
 * said — every turn but the one being spoken — is plain text.
 */
export function SpokenText({ text, voiced }: { text: string; voiced?: number }) {
  if (voiced === undefined) return <>{text}</>;
  return <SpokenWords words={spokenLine(text, voiced)} />;
}

/** Words laid out as one run, a space between each; `style` for one word by its index. */
export function SpokenWords({
  words,
  animate = true,
  style,
  after,
}: {
  words: readonly SpokenWord[];
  /** Fade them in as they are said; off for a turn already said. */
  animate?: boolean;
  style?: (index: number) => CSSProperties | undefined;
  /** Drawn right after the last word said: the speaker's caret. */
  after?: React.ReactNode;
}) {
  const lastSaid = words.findLastIndex((w) => w.said);
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={word.start}>
          {i > 0 && " "}
          <span style={style?.(i)}>
            <span className={animate ? (word.said ? "vm-word-in" : "opacity-0") : undefined}>{word.text}</span>
          </span>
          {i === lastSaid && after}
        </Fragment>
      ))}
    </>
  );
}
