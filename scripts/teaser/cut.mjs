/**
 * The frames from film.mjs → storage/teaser/teaser.mp4 (or the name given),
 * with the stretches in storyboard.mjs SPEED time-lapsed.
 *
 *   node cut.mjs [name.mp4]
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { SPEED } from "./storyboard.mjs";

const ROOT = new URL("../../storage/teaser/", import.meta.url).pathname;
const DIR = ROOT + "frames/";
const { frames, markers } = JSON.parse(fs.readFileSync(DIR + "index.json", "utf8"));

// Markers carry wall-clock time; frames carry the compositor's. Line them up.
const offsets = frames.map((f) => f.wall - f.ts).sort((a, b) => a - b);
const offset = offsets[Math.floor(offsets.length / 2)];
const at = Object.fromEntries(markers.map((m) => [m.name, m.wall - offset]));
const speedAt = (t) => SPEED.find(([a, b]) => t >= at[a] && t < at[b])?.[2] ?? 1;

// Each frame's time in the output, then how long it stays on screen.
const out = [0];
for (let i = 1; i < frames.length; i++) out.push(out[i - 1] + (frames[i].ts - frames[i - 1].ts) / speedAt(frames[i - 1].ts));
const end = at.end ?? frames.at(-1).ts + 1;
let list = "";
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? out[i + 1] : out[i] + Math.max(0.5, end - frames[i].ts);
  list += `file '${frames[i].file}'\nduration ${Math.max(0.001, next - out[i]).toFixed(4)}\n`;
}
list += `file '${frames.at(-1).file}'\n`;
fs.writeFileSync(DIR + "list.txt", list);

const name = process.argv[2] ?? "teaser.mp4";
execFileSync("ffmpeg", [
  "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", DIR + "list.txt",
  "-vf", "fps=60,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-movflags", "+faststart",
  ROOT + name,
], { stdio: "inherit" });

// Where each marker lands in the video, for finding a moment to fix.
const outAt = (t) => { const i = frames.findIndex((f) => f.ts >= t); return out[i < 0 ? frames.length - 1 : i]; };
console.log("wrote", ROOT + name);
console.log(Object.entries(at).map(([k, t]) => `${k} ${outAt(t).toFixed(1)}s`).join(" · "));
