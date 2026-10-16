// export.mjs — rend la keynote en mp4 (Playwright + ffmpeg système).
// Usage:
//   bun keynote/export.mjs --shots            # PNG de contrôle par scène (rapide)
//   bun keynote/export.mjs --preview          # vidéo 12 s de fumée
//   bun keynote/export.mjs                    # vidéo complète 210 s → keynote/dist/
// Pas de dépendance runtime : seul le devDep playwright (export local) + ffmpeg.
import { chromium } from "playwright";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
const DECK = "file://" + join(HERE, "index.html");
const W = 1920, H = 1080;

// Durées lues depuis le deck : source unique de vérité (doit matcher le test).
function sceneDurs() {
  const html = readFileSync(join(HERE, "index.html"), "utf8");
  return [...html.matchAll(/data-dur="(\d+)"/g)].map((m) => Number(m[1]));
}
const DURS = sceneDurs();
const TOTAL = DURS.reduce((a, b) => a + b, 0);
const starts = DURS.reduce((a, d, i) => (a.push((a[i - 1] ?? 0) + (DURS[i - 1] ?? 0)), a), []);

const args = new Set(process.argv.slice(2));
mkdirSync(DIST, { recursive: true });

function ffmpeg(...a) {
  execFileSync("ffmpeg", ["-y", ...a], { stdio: "inherit" });
}

// Nappe épique 100 % générée (aucun mp3 tiers) : accord + montée + pulsation.
function audioBed(path, dur) {
  const f = (fr) => `sine=frequency=${fr}:duration=${dur}:sample_rate=48000`;
  ffmpeg(
    "-f", "lavfi", "-i", f(55), "-f", "lavfi", "-i", f(82.41),
    "-f", "lavfi", "-i", f(110), "-f", "lavfi", "-i", f(164.81),
    "-filter_complex",
    "[0][1][2][3]amix=inputs=4:normalize=0," +
      `tremolo=f=0.5:d=0.6,volume='0.10+0.22*t/${dur}':eval=frame,` +
      "lowpass=f=2400," +
      "afade=t=in:st=0:d=6,afade=t=out:st=" + (dur - 8) + ":d=8,aecho=0.8:0.7:60:0.25",
    "-t", String(dur), "-c:a", "pcm_s16le", path,
  );
}

if (args.has("--shots")) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H } });
  for (let i = 0; i < DURS.length; i++) {
    const mid = starts[i] + Math.min(4, DURS[i] / 2);
    await p.goto(`${DECK}?autoplay=0&export=1&t=${mid}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1400);
    await p.screenshot({ path: join(DIST, `shot-s${i + 1}.png`) });
    console.log(`shot-s${i + 1}.png @${mid}s OK`);
  }
  await b.close();
  process.exit(0);
}

const preview = args.has("--preview");
const DUR = preview ? 12 : TOTAL;
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: DIST, size: { width: W, height: H } },
});
const p = await ctx.newPage();
await p.goto(`${DECK}?autoplay=1&export=1`, { waitUntil: "networkidle" });
await p.waitForTimeout(DUR * 1000 + 1500);
await ctx.close();
await b.close();

const webm = readdirSync(DIST).filter((f) => f.endsWith(".webm"));
const src = webm
  .map((f) => join(DIST, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!src) throw new Error("aucune vidéo Playwright capturée");
const bed = join(DIST, preview ? "bed-preview.wav" : "bed.wav");
audioBed(bed, DUR);
const out = join(DIST, preview ? "keynote-preview.mp4" : "keynote-1080p60.mp4");
ffmpeg(
  "-i", src, "-i", bed,
  "-map", "0:v:0", "-map", "1:a:0",
  "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-r", "60", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-shortest", out,
);
console.log("OK →", out, `(${DUR}s, ${W}x${H})`);
