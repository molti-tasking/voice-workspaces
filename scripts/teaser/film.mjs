/**
 * Records the teaser: /record/demo on a phone in stage.html, with the
 * captions, the call and the transcript → stack morph from storyboard.mjs.
 *
 * Every composited frame is saved with its timestamp to storage/teaser/frames;
 * cut.mjs turns them into the video. Nothing in the app changes: the morph and
 * the hidden demo controls are injected from here.
 *
 *   node film.mjs           record headless
 *   node film.mjs --watch   record in a visible Chrome window
 *
 * Needs the web app on BASE (pnpm --filter @voicemural/web dev).
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import { BEATS, CALLER, CLOSING, CUES, FRAME, LABEL, MORPH, OPENING, TOPICS } from "./storyboard.mjs";

const BASE = process.env.TEASER_BASE ?? "http://localhost:3000";
const ROOT = new URL("../../storage/teaser/", import.meta.url).pathname;
const OUT = ROOT + "frames/";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const STAGE = fs.readFileSync(new URL("./stage.html", import.meta.url), "utf8");

// Inside the app: the demo's badge, notes, controls and view switch, the dev
// indicator, and the draft "rethink" marks are not part of the design shown.
const APP_CSS = `
  nextjs-portal{display:none!important}
  main>header, main>header+p, main>header+p+div{display:none!important}
  main{padding-top:14px!important}
  svg.fill-current.text-amber-600{display:none!important}
`;

/** The transcript → stack morph, run inside the app's frame. */
const morph = async ({ zoomMs, tintMs, holdMs, dropMs, flyMs, stagger, topics }) => {
  const topicOf = (text) => topics.find(([, , starts]) => starts.some((p) => text.trim().startsWith(p)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ease = "cubic-bezier(.65,0,.35,1)";

  const main = document.querySelector("main");
  const scroller = main.querySelector(".overflow-y-auto");
  const col = scroller.firstElementChild;
  const area = scroller.getBoundingClientRect();

  // A copy of the transcript over the real one, to animate freely.
  const ov = document.createElement("div");
  Object.assign(ov.style, {
    position: "fixed", left: area.left + "px", top: area.top + "px", width: area.width + "px",
    height: area.height + "px", overflow: "hidden", zIndex: 1000, background: getComputedStyle(document.body).backgroundColor,
  });
  document.body.appendChild(ov);
  const W = col.offsetWidth, H = col.offsetHeight;
  const clone = col.cloneNode(true);
  Object.assign(clone.style, { position: "absolute", left: 0, top: 0, width: W + "px", transformOrigin: "0 0", margin: 0 });
  ov.appendChild(clone);
  const y0 = -scroller.scrollTop;
  const pad = 18;
  const s = Math.min(1, (area.height - 2 * pad) / H);
  const x1 = (area.width - W * s) / 2, y1 = pad + (area.height - 2 * pad - H * s) / 2;

  // 1. Zoom out: the whole transcript, as long as it really is.
  await clone.animate(
    [{ transform: `translate(0px,${y0}px) scale(1)` }, { transform: `translate(${x1}px,${y1}px) scale(${s})` }],
    { duration: zoomMs, easing: ease, fill: "forwards" },
  ).finished;

  // 2. Tint: each run of turns on one topic, as a block over the words.
  const o = ov.getBoundingClientRect();
  const runs = [];
  for (const el of clone.children) {
    const t = topicOf(el.textContent);
    if (!t) continue;
    const r = el.getBoundingClientRect();
    const last = runs.at(-1);
    if (last && last.topic === t) {
      last.bottom = r.bottom; last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right);
    } else runs.push({ topic: t, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  }
  for (const run of runs) {
    const b = document.createElement("div");
    const g = 3;
    Object.assign(b.style, {
      position: "absolute", left: run.left - o.left - g + "px", top: run.top - o.top - g + "px",
      width: run.right - run.left + 2 * g + "px", height: run.bottom - run.top + 2 * g + "px",
      background: run.topic[1], borderRadius: "6px", opacity: 0, mixBlendMode: "multiply",
    });
    ov.appendChild(b);
    run.el = b;
    b.animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: tintMs, easing: ease, fill: "forwards" });
  }
  await sleep(tintMs + holdMs);

  // 3. The words fall away; the topics remain.
  clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dropMs, easing: ease, fill: "forwards" });
  for (const { el } of runs) el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: dropMs, easing: ease, fill: "forwards" });
  await sleep(dropMs);
  for (const { el } of runs) el.style.mixBlendMode = "normal";

  // 4. The same conversation as the Stack, laid out underneath, still hidden.
  localStorage.setItem("souffleur.record-view.v2", "stack");
  window.dispatchEvent(new Event("souffleur:local-value"));
  await sleep(350);
  const section = main.querySelector("section");
  const targetOf = (title) => {
    // Titles follow a screen-reader-only "whose words" line, so match by inclusion.
    if (section?.querySelector("button")?.textContent.includes(title)) return section;
    return [...main.querySelectorAll("button")].find((b) => !section?.contains(b) && b.textContent.includes(title));
  };
  const shown = [...main.querySelectorAll("[data-slot], button, section")].filter((e) => !section?.contains(e) || e === section);
  for (const e of shown) e.style.opacity = 0;
  ov.style.background = "transparent";

  // 5. Each block flies to its topic's card; the card appears where it lands.
  const flights = [];
  [...new Set(runs.map((r) => r.topic))].forEach((topic, i) => {
    const target = targetOf(topic[0]);
    if (!target) return;
    const t = target.getBoundingClientRect();
    const radius = getComputedStyle(target).borderRadius;
    for (const { el } of runs.filter((r) => r.topic === topic)) {
      const from = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height, borderRadius: "6px", backgroundColor: topic[1], opacity: 1 };
      const to = { left: t.left - o.left + "px", top: t.top - o.top + "px", width: t.width + "px", height: t.height + "px", borderRadius: radius, backgroundColor: topic[1], opacity: 1 };
      flights.push(el.animate([from, { ...to, offset: 0.8 }, { ...to, backgroundColor: "#ffffff", opacity: 0 }], {
        duration: flyMs, delay: i * stagger, easing: ease, fill: "forwards",
      }).finished);
    }
    target.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "scale(1)" }], {
      duration: flyMs * 0.45, delay: i * stagger + flyMs * 0.6, easing: ease, fill: "forwards",
    });
    flights.push(sleep(i * stagger + flyMs * 1.05).then(() => { target.style.opacity = ""; }));
  });
  await Promise.all(flights);
  for (const e of shown) { e.style.opacity = ""; e.getAnimations().forEach((a) => a.cancel()); }
  ov.remove();
};

const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--watch") });
const ctx = await browser.newContext({
  viewport: { width: FRAME.width, height: FRAME.height },
  deviceScaleFactor: FRAME.scale,
  colorScheme: "light",
});
await ctx.addInitScript(() => {
  if (location.pathname.startsWith("/record")) {
    localStorage.setItem("souffleur.record-view.v2", "chat");
    localStorage.setItem("souffleur.rethink", "off");
  }
});
// Served from the app's origin, so the stage can reach into the app's frame.
await ctx.route(`${BASE}/__teaser`, (r) => r.fulfill({ contentType: "text/html", body: STAGE }));
const page = await ctx.newPage();
await page.goto(`${BASE}/__teaser`);

const stage = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const cap = (beat) => stage((b) => window.cap(b), beat);
await stage(({ w, h }) => {
  document.documentElement.style.setProperty("--frame-w", w + "px");
  document.documentElement.style.setProperty("--frame-h", h + "px");
}, { w: FRAME.width, h: FRAME.height });
await stage((t) => { document.getElementById("label").textContent = t; }, LABEL.before);
await stage((c) => window.caller(c), CALLER);
await stage((c) => window.card(c, true), OPENING);

// Screencast: every composited frame, with its timestamp.
const cdp = await ctx.newCDPSession(page);
const frames = [];
const markers = [];
let n = 0;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = `f${String(n++).padStart(6, "0")}.jpg`;
  fs.writeFileSync(OUT + file, Buffer.from(data, "base64"));
  frames.push({ file, ts: metadata.timestamp, wall: Date.now() / 1000 });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
const mark = (name) => { markers.push({ name, wall: Date.now() / 1000 }); console.log("mark", name); };
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

mark("start");
try {
  await wait(OPENING.holdMs);
  // The app loads behind the opening card, so the conversation starts on cue.
  await stage(() => { document.getElementById("app").src = "/record/demo"; });
  let app;
  while (!(app = page.frames().find((f) => f.url().includes("/record/demo")))) await wait(50);
  await app.waitForLoadState("domcontentloaded");
  await app.addStyleTag({ content: APP_CSS });
  await app.waitForFunction(() => document.querySelector("main .overflow-y-auto p"), null, { polling: 50 });
  await stage((c) => window.card(c, false), OPENING);

  // The transcript.
  await cap(BEATS.setting);
  mark("chat");
  await wait(BEATS.setting.holdMs);
  await cap(BEATS.transcript);
  mark("chat-fast");
  await app.waitForFunction(
    (words) => document.querySelector("main .overflow-y-auto")?.textContent.includes(words),
    CUES.callAfter, { timeout: 90000, polling: 100 },
  );
  await wait(1300);
  mark("chat-slow");
  await wait(1200);

  // The call, and back.
  await app.evaluate(() => document.querySelector('button[aria-label="Pause"]').click());
  await stage(() => window.call(true));
  await cap(BEATS.call);
  await wait(BEATS.call.holdMs);
  await stage(() => window.call(false));
  await wait(500);
  await cap(BEATS.where);
  await wait(BEATS.where.holdMs);

  // The morph.
  mark("morph");
  await cap(BEATS.same);
  const morphed = app.evaluate(morph, { ...MORPH, topics: TOPICS });
  await wait(MORPH.zoomMs + MORPH.tintMs + MORPH.holdMs * 0.7);
  await stage((t) => window.label(t), LABEL.after);
  await cap(BEATS.stack);
  await morphed;
  await wait(BEATS.stack.holdMs);

  // The stack, playing on.
  mark("resume");
  await app.evaluate(() => document.querySelector('button[aria-label="Play"]').click());
  await cap(BEATS.return);
  await app.waitForFunction(
    (title) => document.querySelector("main section button")?.textContent.includes(title),
    CUES.returnTo, { timeout: 30000, polling: 50 },
  );
  mark("return");
  await wait(BEATS.return.holdMs);
  mark("stack-fast");
  await cap(BEATS.live);
  await app.waitForFunction(() => !document.querySelector('button[aria-label="Pause"]'), null, { timeout: 60000, polling: 100 });
  await wait(1500);
  mark("stack-slow");
  await wait(2500);

  await stage((c) => window.card(c, true), CLOSING);
  await wait(CLOSING.holdMs);
  mark("end");
} finally {
  await cdp.send("Page.stopScreencast").catch(() => {});
  await wait(300);
  fs.writeFileSync(OUT + "index.json", JSON.stringify({ frames, markers }, null, 1));
  console.log(`${frames.length} frames over ${(frames.at(-1)?.ts - frames[0]?.ts).toFixed(1)} s → ${OUT}`);
  await browser.close();
}
