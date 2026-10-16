// motion-proof.mjs — prouve qu'aucune portion >5 s n'est statique.
// Échantillonne la vidéo toutes les 2 s (signalstats) et exige un delta de
// luminosité/saturation entre chaque paire de frames consécutives.
// Usage : bun keynote/motion-proof.mjs keynote/dist/keynote-1080p60.mp4
import { execSync } from "node:child_process";

const mp4 = process.argv[2];
if (!mp4) {
  console.error("usage: bun keynote/motion-proof.mjs <video.mp4>");
  process.exit(2);
}
const STEP = 2; // s — seuil : statique >5 s interdit ⇒ pas de 2 pas plats d'affilée
const EPS = 0.02; // 3x le bruit x264 mesuré (0.006 sur vidéo figée témoin)

let out;
try {
  // signalstats écrit sur stderr ⇒ niveau info + redirection 2>&1.
  out = execSync(
    `ffmpeg -v info -i "${mp4}" -vf fps=1/${STEP},signalstats,metadata=print -f null - 2>&1`,
    { encoding: "utf8" },
  );
} catch (e) {
  out = String(e.stdout ?? e.message ?? "");
}
const ys = [...out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
const ss = [...out.matchAll(/lavfi\.signalstats\.SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
const frames = ys.map((y, i) => ({ y, s: ss[i] ?? 0 }));
if (frames.length < 10) throw new Error(`trop peu de frames échantillonnées (${frames.length})`);

let flats = 0;
for (let i = 1; i < frames.length; i++) {
  const d = Math.max(Math.abs(frames[i].y - frames[i - 1].y), Math.abs(frames[i].s - frames[i - 1].s));
  if (d < EPS) {
    flats++;
    if (flats * STEP >= 5) throw new Error(`statique ≥5 s autour de t=${i * STEP}s (delta=${d.toFixed(3)})`);
  } else flats = 0;
}
console.log(`motion-proof OK : ${frames.length} frames / ${STEP}s, mouvement partout`);
