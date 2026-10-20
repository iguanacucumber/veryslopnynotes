// Build du bundle web — UN point d'entrée pour l'APK (`bun run build:web`,
// appelé par la tâche Gradle `buildWebUi`) et pour le test d'architecture qui
// rejoue un build jetable.
//
// #516 : le processus Vite peut MOURIR SANS MESSAGE (le binding natif
// Rolldown se fait tuer, ou le runner le tue) : le journal s'arrête sur
// « ✓ 87 modules transformed. », le gate rougit, et RIEN ne dit pourquoi.
// Deux filets, ici, pour que le gate ne rougisse pas POUR RIEN :
//
//   1. un PLAFOND de durée par essai : un build coincé est TUÉ (et nommé),
//      pas attendu jusqu'à la fin du job ;
//   2. UN RÉESSAI quand le processus est MORT (signal) — JAMAIS quand il a
//      ÉCHOUÉ (code de sortie != 0 : une erreur de compilation est
//      déterministe, la rejouer ne servirait à rien).
//
// Le réessai qui réussit est SIGNALÉ (bruyant) : rien n'est sauté — le bundle
// rejoué EST vérifié — mais le crash ne passe pas inaperçu.
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const VITE = join(ROOT, "node_modules", ".bin", "vite");
const CONFIG = join(ROOT, "web", "vite.config.ts");

/**
 * Plafond d'un essai, en ms. Un build Vite normal prend ~1 s ; 60 s est
 * large (le runner le plus chargé l'a fait en quelques secondes).
 */
export const BUILD_TIMEOUT_MS = 60_000;

/** Un essai de build. */
export interface BuildAttempt {
  /** Code de sortie (null si le processus est mort par signal). */
  code: number | null;
  /** Signal qui a tué le processus (null si le processus a fini tout seul). */
  signal: string | null;
  /** Journal du processus (stdout + stderr). */
  journal: string;
  /** Durée de l'essai, en ms. */
  ms: number;
  /** Le processus a été tué PAR NOTRE PLAFOND (pas par un crash). */
  timedOut: boolean;
  /** Le processus est MORT (signal) — pas un échec de compilation. */
  dead: boolean;
}

/** Le résultat d'une suite d'essais. */
export interface BuildOutcome {
  /** Le bundle a été produit (au moins un essai a réussi). */
  ok: boolean;
  /** Les essais, dans l'ordre. */
  attempts: BuildAttempt[];
}

/**
 * Lance le build Vite.
 *
 * @param outDir dossier de sortie (défaut : celui de `web/vite.config.ts`) ;
 *               un dossier hors du projet est vidé (`--emptyOutDir`), comme
 *               le fait le build de l'APK.
 * @param cmd    commande à lancer (défaut : le Vite du dépôt) — pour les
 *               tests, qui rejouent une mort de processus sans payer un build.
 * @param attempts nombre d'essais (défaut : 2, donc UN réessai).
 * @param timeoutMs plafond par essai, en ms.
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
    // Mort par signal : le signal est renseigné, ou le code suit la
    // convention du shell (128 + n°) quand le processus est un wrapper.
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
    // ÉCHEC de compilation (code != 0) : déterministe, on ne rejoue pas.
    // PLAFOND atteint : le build est coincé, rejouer ne servirait à rien.
    if (!dead) return { ok: false, attempts };
    // Mort par signal : le process Crash ou le runner l'a tué — on rejoue une
    // fois. Le journal du mort est gardé : il dit pourquoi.
  }
  return { ok: false, attempts };
}

/**
 * Le diagnostic d'une suite d'essais : la CAUSE de chaque essai (pas un
 * code nu), puis le journal. Un échec qui ne dit pas pourquoi est un échec
 * qu'on ne peut pas corriger (#516).
 */
export function describeOutcome(r: BuildOutcome): string {
  const lignes = r.attempts.map((a, i) => {
    const cause =
      a.code === 0
        ? "OK"
        : a.timedOut
          ? `TUÉ par le plafond de durée`
          : a.dead
            ? `MORT (${a.signal ?? "code 128+n°"})`
            : `ÉCHEC (code ${a.code})`;
    return `essai ${i + 1}/${r.attempts.length} : ${cause} en ${(a.ms / 1000).toFixed(1)} s`;
  });
  const journaux = r.attempts
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.journal.trim() !== "")
    .map(({ a, i }) => `--- journal (essai ${i + 1}) ---\n${a.journal}`);
  return [...lignes, ...journaux].join("\n");
}

// Point d'entrée seulement : le module reste importable (tests) SANS lancer
// un build. Un dossier de sortie en argument (le build de l'APK n'en donne
// pas : il suit `web/vite.config.ts`).
if (import.meta.main) {
  const outDir = process.argv[2];
  const r = buildWeb(outDir ? { outDir } : {});
  for (const a of r.attempts) process.stdout.write(a.journal);
  if (!r.ok) {
    console.error(`\nbuild web ÉCHOUÉ :\n${describeOutcome(r)}`);
    process.exitCode = 1;
  }
}
