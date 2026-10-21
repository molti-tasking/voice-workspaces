"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorLine, PrimaryButton, StudyFrame } from "./ui";

/**
 * Ask for the microphone and show that it hears them, before anything else
 * depends on it. The stream is closed again: the recorder opens its own.
 */
export function MicCheck({
  eyebrow = "Part 1 of 2",
  onReady,
}: {
  /** Above the title: where in the study this is. */
  eyebrow?: string;
  onReady: () => void;
}) {
  const [state, setState] = useState<
    "idle" | "asking" | "listening" | "denied" | "unsupported"
  >("idle");
  const [heard, setHeard] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => () => stop.current(), []);

  async function listen() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return setState("unsupported");
    }
    setState("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setState("denied");
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 8);
      if (bar.current) bar.current.style.width = `${Math.round(level * 100)}%`;
      if (level > 0.25) setHeard(true);
      frame = requestAnimationFrame(tick);
    };
    tick();
    stop.current = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      void context.close().catch(() => undefined);
    };
    setState("listening");
  }

  return (
    <StudyFrame eyebrow={eyebrow} title="Check your microphone">
      <p>
        Your browser will ask for permission to use the microphone. Then say a
        few words; the bar should move. Headphones help, so the assistant does
        not hear itself.
      </p>
      {state === "idle" || state === "asking" ? (
        <PrimaryButton
          disabled={state === "asking"}
          onClick={() => void listen()}
        >
          Turn on microphone
        </PrimaryButton>
      ) : state === "denied" ? (
        <ErrorLine>
          The microphone was blocked. Allow it in your browser&apos;s address
          bar, then reload this page.
        </ErrorLine>
      ) : state === "unsupported" ? (
        <ErrorLine>
          This browser cannot record audio. Please use a current Chrome, Edge or
          Firefox.
        </ErrorLine>
      ) : (
        <>
          <div
            className="h-4 w-full overflow-hidden rounded-full bg-fg/10"
            aria-hidden
          >
            <div
              ref={bar}
              className="h-full w-0 rounded-full bg-emerald-500 transition-[width] duration-75"
            />
          </div>
          <p className="text-sm text-fg/60">
            {heard ? "We can hear you." : "Say something…"}
          </p>
          <PrimaryButton
            disabled={!heard}
            onClick={() => {
              stop.current();
              onReady();
            }}
          >
            Continue
          </PrimaryButton>
        </>
      )}
    </StudyFrame>
  );
}
