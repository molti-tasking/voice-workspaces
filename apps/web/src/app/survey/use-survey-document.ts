"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyAnswers,
  type SurveyAnswersOf,
  type SurveyKey,
  type SurveyResponseView,
} from "@voicemural/shared";

/**
 * One survey document, loaded from the server and saved back to it whole.
 *
 * Shared by `/survey` and `/survey/week`, so both save the same way: the
 * whole document a second after the last edit — not per field, and not on a
 * button, because a form on a phone is left mid-sentence when the bus
 * arrives. Send does the same write with `submit: true`. A saved draft loads
 * back on the next visit, from the server rather than from localStorage, so
 * the phone and the laptop see the same half-finished answers.
 */

const SAVE_AFTER_MS = 1000;

export type SaveStatus = "loading" | "idle" | "saving" | "saved" | "sent" | "error";

export function useSurveyDocument<K extends SurveyKey>(survey: K, version: string) {
  type Answers = SurveyAnswersOf<K>;
  const [answers, setAnswers] = useState<Answers>(() => emptyAnswers(survey));
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  // The save waiting to run, so Send can cancel it and save what is on screen
  // rather than what the last timer saw.
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/survey?survey=${survey}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const view = (await res.json()) as SurveyResponseView<Answers> | null;
        if (cancelled) return;
        if (view) {
          setAnswers(view.answers);
          setSubmittedAt(view.submittedAt);
        }
        setStatus(view?.submittedAt ? "sent" : "idle");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [survey]);

  const save = useCallback(
    async (next: Answers, submit: boolean) => {
      setStatus("saving");
      try {
        const res = await fetch("/api/survey", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ survey, version, answers: next, submit }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { submittedAt: string | null };
        setSubmittedAt(body.submittedAt);
        setStatus(body.submittedAt ? "sent" : "saved");
      } catch {
        setStatus("error");
      }
    },
    [survey, version],
  );

  const update = useCallback(
    (patch: (prev: Answers) => Answers) => {
      setAnswers((prev) => {
        const next = patch(prev);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save(next, false), SAVE_AFTER_MS);
        return next;
      });
    },
    [save],
  );

  const send = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    void save(answers, true);
  }, [answers, save]);

  return { answers, status, submittedAt, update, send };
}
