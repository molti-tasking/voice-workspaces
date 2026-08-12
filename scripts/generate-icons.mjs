/**
 * Draws the VoiceMural mark and writes every raster the browser, the OS and the
 * install prompt each want a different file for.
 *
 * Run with `pnpm icons` after changing anything in GEOMETRY below.
 *
 * Why a rasteriser by hand rather than sharp/resvg/ImageMagick: the outputs are
 * committed assets that change roughly never, and a build-time image dependency
 * would have to survive the Docker build, CI and every contributor's machine to
 * regenerate files that are already in git. This is ~200 lines of arithmetic
 * with no install step, and the geometry below stays the single source of truth
 * for the SVG as well — so the vector favicon and the PNGs cannot drift apart.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps/web");

// --- The mark ---------------------------------------------------------------
// Four bars of a voice envelope on the app's own background. Four rather than
// the five it started with: at a 16px favicon a 512-space bar narrower than
// ~60 units lands on less than two device pixels and turns to mush, and legible
// at 16px is the only requirement a favicon actually has.
//
// All coordinates are in a 512 unit square, which is also the SVG viewBox.
const GEOMETRY = {
  size: 512,
  radius: 114, // iOS-ish squircle corner, ~22% of the side
  background: "#0f1115", // --color-ink
  bar: "#e5484d", // --color-accent
  barWidth: 64,
  barGap: 52,
  /** Rising then falling, so it reads as speech rather than as a bar chart. */
  barHeights: [156, 320, 240, 112],
};

/** The bars as rounded rects, centred on the canvas. */
function bars({ size, barWidth, barGap, barHeights }) {
  const span = barHeights.length * barWidth + (barHeights.length - 1) * barGap;
  const left = (size - span) / 2;
  return barHeights.map((h, i) => ({
    x: left + i * (barWidth + barGap),
    y: (size - h) / 2,
    w: barWidth,
    h,
    r: barWidth / 2, // fully rounded caps
  }));
}

/** Bounding box of the bars, used to size the maskable icon's safe zone. */
function barsBox(g) {
  const bs = bars(g);
  const x0 = bs[0].x;
  const x1 = bs.at(-1).x + bs.at(-1).w;
  const h = Math.max(...g.barHeights);
  return { w: x1 - x0, h };
}

// --- Rasteriser -------------------------------------------------------------

const SAMPLES = 4; // per axis, so 16 coverage samples per pixel

/** Signed containment test for a rounded rectangle. */
function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Renders the mark at `size` pixels.
 *
 * `cornerRadius` is in 512-space; pass 0 for a full-bleed square (Apple and
 * Android apply their own mask and a second rounding looks like a mistake).
 * `contentScale` shrinks the bars about the centre, which is how the maskable
 * variant keeps its content inside Android's safe circle.
 */
function render(size, { cornerRadius, contentScale = 1 }) {
  const g = GEOMETRY;
  const unit = g.size / size; // canvas units per output pixel
  const bg = hexToRgb(g.background);
  const fg = hexToRgb(g.bar);
  const mid = g.size / 2;

  const shapes = bars(g).map((b) => ({
    x: mid + (b.x - mid) * contentScale,
    y: mid + (b.y - mid) * contentScale,
    w: b.w * contentScale,
    h: b.h * contentScale,
    r: b.r * contentScale,
  }));
  const plate = { x: 0, y: 0, w: g.size, h: g.size, r: cornerRadius };

  const px = Buffer.alloc(size * size * 4);
  const step = unit / SAMPLES;
  const offset = step / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        const cy = y * unit + sy * step + offset;
        for (let sx = 0; sx < SAMPLES; sx++) {
          const cx = x * unit + sx * step + offset;
          if (!insideRoundedRect(cx, cy, plate)) continue;
          bgHits++;
          if (shapes.some((s) => insideRoundedRect(cx, cy, s))) fgHits++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = bgHits / total;
      const i = (y * size + x) * 4;
      if (alpha === 0) continue;
      // Bars only ever sit on the plate, so compositing them against the
      // background colour first and then applying the plate's own coverage
      // gives a correctly premultiplied edge in one step.
      const mix = fgHits / bgHits;
      px[i] = Math.round(bg[0] + (fg[0] - bg[0]) * mix);
      px[i + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * mix);
      px[i + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * mix);
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// --- PNG --------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // One filter byte per scanline; filter 0 (none) throughout, which costs a
  // little size and saves a lot of code.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO with PNG payloads — understood by every browser still shipping. */
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

// --- SVG --------------------------------------------------------------------

function svg() {
  const g = GEOMETRY;
  const rects = bars(g)
    .map(
      (b) =>
        `  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" fill="${g.bar}"/>`,
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.size} ${g.size}" width="${g.size}" height="${g.size}">
  <!-- Generated by scripts/generate-icons.mjs — edit the geometry there. -->
  <rect width="${g.size}" height="${g.size}" rx="${g.radius}" fill="${g.background}"/>
${rects}
</svg>
`;
}

// --- Outputs ----------------------------------------------------------------

/**
 * Android masks a maskable icon to a circle 80% of the canvas wide, so the
 * bars have to fit inside a circle of radius 0.4 * size. Scale by the ratio of
 * that radius to the bars' own half-diagonal.
 */
function maskableScale() {
  const { w, h } = barsBox(GEOMETRY);
  const halfDiagonal = Math.hypot(w / 2, h / 2);
  return (0.4 * GEOMETRY.size) / halfDiagonal;
}

function write(path, data) {
  const full = join(WEB, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log(`  ${path}  ${(data.length / 1024).toFixed(1)} kB`);
}

console.log("Generating icons…");

// Vector favicon. Next links this from app/icon.svg automatically.
write("src/app/icon.svg", svg());

// Legacy .ico, still requested at /favicon.ico by feed readers, link
// unfurlers and anything that predates rel="icon" with an SVG.
const ico = [16, 32, 48].map((size) => ({
  size,
  data: encodePng(size, render(size, { cornerRadius: GEOMETRY.radius })),
}));
write("src/app/favicon.ico", encodeIco(ico));

// iOS home screen. Square and opaque: iOS rounds and masks it itself.
write(
  "src/app/apple-icon.png",
  encodePng(180, render(180, { cornerRadius: 0 })),
);

// Manifest icons. `any` keeps its own corners (Android draws it as-is in some
// surfaces); `maskable` is full-bleed with the content pulled into the safe
// circle, which is what makes the installed launcher icon look native.
const scale = maskableScale();
for (const size of [192, 512]) {
  write(
    `public/icons/icon-${size}.png`,
    encodePng(size, render(size, { cornerRadius: GEOMETRY.radius })),
  );
  write(
    `public/icons/icon-maskable-${size}.png`,
    encodePng(size, render(size, { cornerRadius: 0, contentScale: scale })),
  );
}

console.log(`Done. Maskable content scaled to ${(scale * 100).toFixed(0)}%.`);
