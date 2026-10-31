// Build du bundle web — UN point d'entrée pour l'APK (`bun run build:web`,
// appelé par la tâche Gradle `buildWebUi`) et pour le test d'architecture.
//
// Le processus Vite peut MOURIR SANS MESSAGE (binding Rolldown tué) : le gate
// rougit sans que rien ne dise pourquoi. D'où un PLAFOND de durée par essai
// (un build coincé est TUÉ, pas attendu) et UN réessai quand le processus est
// MORT (signal) — jamais quand il a ÉCHOUÉ (code != 0 : c'est déterministe).
//
// Le réessai qui réussit est SIGNALÉ : rien n'est sauté, le crash ne passe pas
// inaperçu.
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const VITE = join(ROOT, "node_modules", ".bin", "vite");
const CONFIG = join(ROOT, "web", "vite.config.ts");

/** Plafond d'un essai, en ms : un build normal prend ~1 s. */
export const BUILD_TIMEOUT_MS = 60_000;

export interface BuildAttempt {
  /** Code de sortie (null si le processus est mort par signal). */
  code: number | null;
  signal: string | null;
  journal: string;
  ms: number;
  /** Tué PAR NOTRE PLAFOND (pas par un crash). */
  timedOut: boolean;
  /** Mort (signal), pas un échec de compilation. */
  dead: boolean;
}

export interface BuildOutcome {
  ok: boolean;
  attempts: BuildAttempt[];
}

/**
 * Lance le build Vite.
 *
 * @param outDir dossier de sortie ; un dossier hors projet est vidé
 *               (`--emptyOutDir`), comme le build de l'APK.
 * @param cmd    commande à lancer — les tests rejouent une mort de processus.
 */
export function buildWeb(opts: {
  outDir?: string;
  cmd?: string[];
  attempts?: number;
  timeoutMs?: number;
} = {}): BuildOutcome {
  const outDir = opts.outDir ? resolve(ROOT, opts.outDir) : null;
  const cmd = opts.cmd ?? [
    VITE,
    "build",
    "--config",
    CONFIG,
    ...(outDir ? ["--outDir", outDir, "--emptyOutDir"] : []),
  ];
  const max = Math.max(1, opts.attempts ?? 2);
  const timeoutMs = opts.timeoutMs ?? BUILD_TIMEOUT_MS;
  const attempts: BuildAttempt[] = [];

  for (let i = 0; i < max; i++) {
    const started = Date.now();
    const p = Bun.spawnSync(cmd, {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    const ms = Date.now() - started;
    const journal = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
    const code = p.exitCode;
    // Bun rend le signal sous forme de NOM ("SIGKILL") ; un code numérique
    // reste lisible tel quel.
    const signalBrut = p.signalCode ?? null;
    const signal =
      signalBrut === null
        ? null
        : typeof signalBrut === "number"
          ? `signal ${signalBrut}`
          : String(signalBrut);
    // Notre plafond : le processus a été tué PAR NOUS (pas par un crash).
    const timedOut = code === null && ms >= timeoutMs;
    // Mort par signal : le signal est renseigné, ou le code suit la convention
    // du shell (128 + n°) quand le processus est un wrapper.
    const dead =
      !timedOut &&
      (signal !== null || (code !== null && code > 128 && code < 165));
    attempts.push({ code, signal, journal, ms, timedOut, dead });
    if (code === 0) {
      if (attempts.length > 1) {
        // BRUYANT : le build n'a pas été propre, mais il EST fait et vérifié.
        console.error(
          `\n  ⚠ build web : le 1er essai est MORT (${attempts[0]!.signal ?? "signal"}) — ` +
            `le réessai a réussi.\n`,
        );
      }
      return { ok: true, attempts };
    }
    // ÉCHEC (code != 0) = déterministe, et PLAFOND atteint = coincé : rejouer
    // ne servirait à rien.
    if (!dead) return { ok: false, attempts };
    // Le journal du mort est gardé : il dit pourquoi.
  }
  return { ok: false, attempts };
}

/**
 * Diagnostic d'une suite d'essais : la CAUSE de chaque essai. Le journal est
 * écrit UNE fois par l'appelant (le recopier l'affichait deux fois).
 */
export function describeOutcome(r: BuildOutcome): string {
  return r.attempts
    .map((a, i) => {
      const cause =
        a.code === 0
          ? "OK"
          : a.timedOut
            ? `TUÉ par le plafond de durée`
            : a.dead
              ? `MORT (${a.signal ?? "code 128+n°"})`
              : `ÉCHEC (code ${a.code})`;
      return `essai ${i + 1}/${r.attempts.length} : ${cause} en ${(a.ms / 1000).toFixed(1)} s`;
    })
    .join("\n");
}

function sansAnsi(s: string): string {
  return process.stdout.isTTY ? s : s.replace(/\u001b\[[0-9;]*m/g, "");
}

// Module importable par les tests sans lancer un build. Un dossier de sortie en
// argument (le build de l'APK n'en donne pas : il suit `web/vite.config.ts`).
if (import.meta.main) {
  const outDir = process.argv[2];
  const r = buildWeb(outDir ? { outDir } : {});
  for (const a of r.attempts) process.stdout.write(sansAnsi(a.journal));
  if (!r.ok) {
    console.error(`\nbuild web ÉCHOUÉ :\n${describeOutcome(r)}`);
    process.exitCode = 1;
  }
}
