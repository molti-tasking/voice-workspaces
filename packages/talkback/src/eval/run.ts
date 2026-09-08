/**
 * Run the prompt against the cases and say how it did.
 *
 *   pnpm talkback:eval                          the current prompt, all cases
 *   pnpm talkback:eval -- --only stuck,mid-sentence
 *   pnpm talkback:eval -- --base ./candidate.md --label candidate-7
 *   pnpm talkback:eval -- --runs 3 --no-judge
 *   pnpm talkback:eval -- --setting desk         every case, in one setting
 *   pnpm talkback:eval -- --out report.json --strict
 *
 * `--base` swaps the base prompt for the contents of a file, leaving the
 * setting stanzas and the output contract as they are. That is the iteration
 * loop: write a candidate, run it against the same turns as the current
 * prompt, read the two reports side by side, and only then edit `prompt.ts`.
 *
 * With the LANGFUSE_* keys set — the same ones `bot.py` exports live drives
 * with — every evaluated turn is posted to Langfuse as a trace in one session
 * (the run id), tagged `talkback-eval` and the label, carrying the reply, the
 * judge's call and their scores, so drives and eval runs sit in one project
 * under one rubric. Nothing here needs Langfuse to work.
 *
 * Sampling is the model's: no temperature is sent, exactly as `bot.py` sends
 * none, so a run samples the distribution a drive would. `--runs 3` shows how
 * wide that distribution is on a case before anyone reads one failure as a
 * regression.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "@voicemural/llm";
import { TALKBACK_CONFIG_VERSION } from "../prompt";
import { SETTINGS, type Setting } from "../setting";
import { findCases, type EvalCase } from "./cases";
import { checkReply, type CheckResult } from "./checks";
import { JUDGE_AXES, judgeTurn, type Judgement } from "./judge";
import {
  ingestTrace,
  langfuseConfig,
  newTraceId,
  type GenerationRecord,
  type ScoreRecord,
} from "./langfuse";
import { buildTurnMessages } from "./messages";

/* --------------------------------------------------------------------------
 * Environment: the repo-root .env, without a dependency.
 * ------------------------------------------------------------------------ */

function loadDotEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = match;
    if (key && process.env[key] === undefined) {
      process.env[key] = raw!.replace(/^["']|["']$/g, "");
    }
  }
}

/* --------------------------------------------------------------------------
 * Arguments
 * ------------------------------------------------------------------------ */

interface Args {
  base: string | undefined;
  label: string;
  only: string[] | null;
  setting: Setting | null;
  runs: number;
  judge: boolean;
  out: string | null;
  strict: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    base: undefined,
    label: TALKBACK_CONFIG_VERSION,
    only: null,
    setting: null,
    runs: 1,
    judge: true,
    out: null,
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--base":
        args.base = readFileSync(resolve(next()), "utf8").trim();
        if (args.label === TALKBACK_CONFIG_VERSION) args.label = "candidate";
        break;
      case "--label":
        args.label = next();
        break;
      case "--only":
        args.only = next().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--setting": {
        const value = next();
        if (!(SETTINGS as readonly string[]).includes(value)) {
          throw new Error(`--setting must be one of ${SETTINGS.join(", ")}`);
        }
        args.setting = value as Setting;
        break;
      }
      case "--runs":
        args.runs = Math.max(1, Number(next()) || 1);
        break;
      case "--no-judge":
        args.judge = false;
        break;
      case "--out":
        args.out = resolve(next());
        break;
      case "--strict":
        args.strict = true;
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

/* --------------------------------------------------------------------------
 * One turn
 * ------------------------------------------------------------------------ */

interface TurnReport {
  id: string;
  run: number;
  setting: Setting;
  traceId: string;
  reply: string;
  check: CheckResult;
  judgement: Judgement | null;
  judgeError?: string;
  /** For Langfuse: the calls this turn made. */
  generations: GenerationRecord[];
  messages: { role: string; content: string }[];
  tags: string[];
}

async function runTurn(
  kase: EvalCase,
  run: number,
  args: Args,
  runId: string,
): Promise<TurnReport> {
  const setting = args.setting ?? kase.setting;
  const { composed, messages } = buildTurnMessages({
    compose: { base: args.base, setting },
    history: kase.history,
    context: kase.context,
    said: kase.said,
  });

  const traceId = newTraceId();
  const tags = ["talkback-eval", args.label, `case:${kase.id}`, `setting:${setting}`];
  // LiteLLM keeps `metadata` on its own request log, so spend per prompt
  // version is attributable there too. Langfuse is written to directly below.
  const metadata = {
    generation_name: "talkback.eval.turn",
    session_id: runId,
    tags,
    version: args.label,
  };
  const generations: GenerationRecord[] = [];

  // The conversation model, exactly as the container calls it: no
  // temperature, thinking off is the container's concern (it disables it for
  // latency, which does not change what is said), the same message shape.
  const startedAt = new Date();
  const result = await chat(messages, {
    role: "converse",
    temperature: null,
    maxTokens: 200,
    metadata,
  });
  generations.push({
    name: "talkback.eval.turn",
    model: result.resolvedModel,
    input: messages,
    output: result.content,
    startedAt,
    latencyMs: result.latencyMs,
    usage: { input: result.usage.promptTokens, output: result.usage.completionTokens },
  });

  const check = checkReply(kase, result.content, composed.maxReplyWords);

  let judgement: Judgement | null = null;
  let judgeError: string | undefined;
  if (args.judge) {
    const judgeStartedAt = new Date();
    try {
      const call = await judgeTurn(messages, result.content, kase.about, {
        ...metadata,
        generation_name: "talkback.eval.judge",
      });
      judgement = call.judgement;
      generations.push({
        name: "talkback.eval.judge",
        model: call.model,
        input: call.input,
        output: call.output,
        startedAt: judgeStartedAt,
        latencyMs: call.latencyMs,
        usage: call.usage,
      });
    } catch (err) {
      judgeError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    id: kase.id,
    run,
    setting,
    traceId,
    reply: result.content,
    check,
    judgement,
    judgeError,
    generations,
    messages,
    tags,
  };
}

/* --------------------------------------------------------------------------
 * Reporting
 * ------------------------------------------------------------------------ */

function line(report: TurnReport, runs: number): string {
  const mark = report.check.pass && report.judgement?.verdict !== "fail" ? "✓" : "✗";
  const id = runs > 1 ? `${report.id}#${report.run}` : report.id;
  const said = report.check.silent ? "<silence>" : `"${report.check.spoken}"`;
  const words = report.check.silent ? "" : ` (${report.check.words}w)`;
  const judge = report.judgement
    ? `  judge ${JUDGE_AXES.map((a) => `${a.split("_")[0]!.slice(0, 5)}=${report.judgement![a]}`).join(" ")} → ${report.judgement.verdict}`
    : report.judgeError
      ? `  judge: error (${report.judgeError})`
      : "";
  const parts = [`${mark} ${id.padEnd(22)} ${said}${words}${judge}`];
  for (const failure of report.check.failures) parts.push(`      · ${failure}`);
  if (report.judgement?.verdict === "fail" || (report.judgement && !report.check.pass)) {
    parts.push(`      · judge: ${report.judgement.reason}`);
  }
  return parts.join("\n");
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

async function main(): Promise<void> {
  loadDotEnv(fileURLToPath(new URL("../../../../.env", import.meta.url)));
  const args = parseArgs(process.argv.slice(2));
  const cases = findCases(args.only);
  const runId = `eval-${args.label}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const langfuse = langfuseConfig();

  console.log(`talk-back prompt eval  label=${args.label}  cases=${cases.length}  runs=${args.runs}  judge=${args.judge}`);
  console.log(`model: ${process.env.MODEL_CONVERSE ?? "(MODEL_CONVERSE unset)"}  judge: ${process.env.MODEL_REASONING ?? "(MODEL_REASONING unset)"}`);
  console.log(`langfuse session: ${runId}${langfuse ? "  → " + langfuse.host : "  (LANGFUSE_* unset: nothing posted)"}`);
  console.log("");

  const reports: TurnReport[] = [];
  let tracesPosted = 0;
  let tracesFailed = 0;

  for (const kase of cases) {
    for (let run = 1; run <= args.runs; run++) {
      let report: TurnReport;
      try {
        report = await runTurn(kase, run, args, runId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`✗ ${kase.id.padEnd(22)} ERROR ${message}`);
        reports.push({
          id: kase.id,
          run,
          setting: args.setting ?? kase.setting,
          traceId: "",
          reply: "",
          check: { silent: false, spoken: "", drafts: [], words: 0, failures: [`error: ${message}`], pass: false },
          judgement: null,
          generations: [],
          messages: [],
          tags: [],
        });
        continue;
      }
      reports.push(report);
      console.log(line(report, args.runs));

      if (langfuse) {
        const scores: ScoreRecord[] = [
          {
            name: "checks_pass",
            value: report.check.pass ? 1 : 0,
            comment: report.check.failures.join("; ") || undefined,
          },
          ...(report.judgement
            ? [
                ...JUDGE_AXES.map((axis) => ({ name: `judge_${axis}`, value: report.judgement![axis] })),
                { name: "judge_verdict", value: report.judgement.verdict, comment: report.judgement.reason },
              ]
            : []),
        ];
        try {
          await ingestTrace(langfuse, {
            id: report.traceId,
            // The same naming the container uses for a drive, so both sort together.
            name: `eval · ${kase.id}`,
            sessionId: runId,
            tags: report.tags,
            version: args.label,
            input: report.messages,
            output: report.reply,
            metadata: { case: kase.id, run, about: kase.about, setting: report.setting },
            generations: report.generations,
            scores,
          });
          tracesPosted++;
        } catch (err) {
          tracesFailed++;
          if (tracesFailed === 1) console.log(`      · langfuse: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  const checked = reports.filter((r) => r.check.pass).length;
  const judged = reports.filter((r) => r.judgement);
  console.log("");
  console.log(`checks: ${checked}/${reports.length} pass`);
  if (judged.length) {
    const summary = JUDGE_AXES.map(
      (axis) => `${axis}=${mean(judged.map((r) => r.judgement![axis]))!.toFixed(2)}`,
    ).join("  ");
    const verdicts = judged.filter((r) => r.judgement!.verdict === "pass").length;
    console.log(`judge:  ${verdicts}/${judged.length} pass  ${summary}`);
  }
  if (langfuse) console.log(`langfuse: ${tracesPosted} traces posted${tracesFailed ? `, ${tracesFailed} failed` : ""}`);

  if (args.out) {
    writeFileSync(
      args.out,
      JSON.stringify(
        { runId, label: args.label, configVersion: TALKBACK_CONFIG_VERSION, base: args.base ?? null, reports },
        null,
        2,
      ),
    );
    console.log(`report: ${args.out}`);
  }

  if (args.strict && checked < reports.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
