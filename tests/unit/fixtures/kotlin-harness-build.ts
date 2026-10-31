// Harnais partagé de la parité TS <-> Kotlin (#202) — COMPILATION ET CACHE.
//
// Compile des sources Kotlin pour de vrai (`kotlinc -include-runtime`, binaire
// en cache `node_modules/.cache/<nom>/<sha256>/`). Le protocole JSON ligne à
// ligne (`ask()`, `openLink`) vit dans `kotlin-harness.ts`, qui ré-exporte ce
// module : les 56 tests n'importent que `kotlin-harness.ts`.
//
// Chaîne requise : `kotlinc` + `java`. Absente = `SKIP_REASON` renseigné + SKIP
// BRUYANT (jamais un faux vert, même philosophie que `make android-compile`).
// En revanche un ÉCHEC DE COMPILATION est un défaut : `ensureJar` lève (le code
// commité doit compiler).
//
// UNE UNION À FROID, DEUX JARS À CHAUD (#444, #754). Les tests de parité
// visent le même port : avant, chacun compilait son propre programme Kotlin.
// L'union est encore compilée d'un bloc à froid, puis découpée en `port.jar`
// (production) et `drivers.jar` ; un pilote modifié ne recompile qu'un
// overlay contre le port. Le port porte un `main()` par pilote : le pilote est
// lancé par sa CLASSE (`openLink(jars, { mainClass })`), pas par `java -jar`.
//
// GESTE DES PROCESSUS — le sujet de ce fichier. Une compilation Kotlin, c'est
// une JVM qui prend un cœur et 512 Mo de tas. Quatre fuites, toutes
// reproduites, toutes corrigées :
//
//   1. ORPHELIN. `kotlinc` est un script bash qui lance `java` comme ENFANT.
//      Tuer le script seul laissait le `java` compiler à 100 % CPU EN
//      ARRIÈRE-PLAN, sans parent pour le surveiller. Le compilateur est donc
//      lancé dans son PROPRE groupe de processus (`detached`) et on tue le
//      GROUPE : le `java` meurt avec le script.
//   2. BLOCAGE. `Bun.spawnSync` bloquait le worker : impossible à interrompre,
//      et un `kotlinc` qui coinçait figeait le test jusqu'à la fin des temps.
//      La compilation est désormais ASYNCHRONE, avec un plafond de durée, et
//      elle est tuée dès que le worker ou le lanceur de tests meurt — sinon
//      le `java` continuait de compiler tout seul, dans le vide, après le
//      retour du terminal.
//   3. SATURATION. `bun test --parallel` lance un worker par fichier et il y a
//      une douzaine de fichiers de parité : autant de JVM `kotlinc` d'un coup,
//      la machine à 100 % CPU. Un sémaphore borne les compilations simultanées.
//      (Depuis #444, il n'y a plus qu'une compilation d'union à froid : le
//      sémaphore est un filet de sécurité, le VERROU À JAR de `jar-lock.ts`
//      fait déjà qu'une seule compilation a lieu par artefact.)
//   4. ZOMBIS. Le pilote `java` était tué sans être récolté — `[java] <defunct>`
//      empilé dans `ps` après chaque run. On attend désormais sa mort.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, delimiter, join } from "node:path";
import { ensureSingleJar, lockIsStale } from "./jar-lock";
import { splitParityJar } from "./kotlin-jar-split";
import { digestOf, driverSources, PARITY_SOURCES, productionDigest } from "./parity-sources";

export const ROOT = join(import.meta.dir, "..", "..", "..");

/** Compilations Kotlin simultanées. `bun test --parallel` lance un worker par
 *  fichier et il y a une douzaine de fichiers de parité : sans plafond, une
 *  JVM `kotlinc` par fichier démarre d'un coup et la machine passe à 100 % CPU.
 *  Variable d'environnement pour un poste plus modeste. */
function maxParallelCompiles(): number {
  const n = Number(process.env.KOTLIN_COMPILE_JOBS ?? 4);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

/** Plafond de durée d'une compilation. Un `kotlinc` bloqué ne doit pas figer
 *  le worker de test pour toujours : au-delà, on tue le groupe de processus
 *  et l'échec est bruyant. */
function compileTimeoutMs(): number {
  const n = Number(process.env.KOTLIN_COMPILE_TIMEOUT_MS ?? 180_000);
  return Number.isInteger(n) && n > 0 ? n : 180_000;
}

/** Répertoire des verrous de compilation, partagé par tous les workers.
 *  Surchargable pour un test qui veut son propre sémaphore isolé. */
function slotDir(): string {
  return process.env.KOTLIN_COMPILE_SLOTS_DIR ?? join(ROOT, "node_modules", ".cache", "kotlin-parity-slots");
}

/**
 * Tue un processus ET son groupe de processus.
 *
 * `kotlinc` est un script bash qui lance `java` comme enfant : kill du script
 * seul = `java` orphelin qui compile à 100 % CPU sans surveillance. Le
 * compilateur est lancé `detached` (donc leader de son groupe, pgid == pid) :
 * `kill(-pgid)` emmène le `java` avec.
 */
export function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Groupe déjà mort : rien à faire.
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Déjà mort.
  }
}

/** Le pid existe-t-il encore ? `process.ppid` ne convient PAS : Bun le fige
 *  au démarrage et ne voit pas le re-parentage (un worker de `bun test`
 *  orphelin garde l'ancien pid). On interroge donc le système. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // vivant, pas à nous
  }
}

/** Pid du lanceur de tests, relevé UNE fois au chargement du module. S'il
 *  disparaît, le lanceur est mort (`bun test` tué par Ctrl-C laisse ses
 *  workers orphelins) : toute compilation en cours est alors inutile et doit
 *  être tuée. Relevé au chargement — et non à chaque compilation — pour que la
 *  comparaison reste valable même si la compilation commence APRÈS la mort du
 *  lanceur. */
const LAUNCHER_PID = process.ppid;

/** Compilations vivantes dans CE worker : elles doivent mourir avec lui.
 *  `bun test` ne propage PAS le SIGINT à ses workers en mode `--parallel`
 *  (il les SIGKILL), cette garde sert donc aux runs mono-fichier et à un
 *  SIGTERM/SIGHUP envoyé au worker ; le cas du SIGKILL est couvert par le
 *  superviseur (kotlin-compile.sh), qui survit au worker.
 *  On garde le PROCESSU entier (pas seulement son pid) : c'est lui qui tient
 *  l'extrémité d'écriture du tube dont le superviseur se sert de témoin —
 *  un sous-processus récolté par le GC fermerait ce tube et tuerait la
 *  compilation en cours. */
const liveCompiles = new Set<{ pid: number }>();

function killAllCompiles(): void {
  for (const proc of liveCompiles) killGroup(proc.pid);
  liveCompiles.clear();
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    killAllCompiles();
    process.removeAllListeners(sig);
    process.kill(process.pid, sig); // comportement par défaut
    setTimeout(() => process.exit(130), 250); // filet si la ré-émission rate
  });
}

/**
 * Prend un slot de compilation. Sémaphore à base de fichiers : les workers de
 * `bun test --parallel` sont des PROCESSUS distincts, un sémaphore en mémoire
 * ne servirait à rien.
 */
async function acquireSlot(deadline: number): Promise<() => void> {
  const dir = slotDir();
  mkdirSync(dir, { recursive: true });
  const slots = maxParallelCompiles();
  for (;;) {
    for (let i = 0; i < slots; i++) {
      const lock = join(dir, `slot-${i}.lock`);
      let fd: number;
      try {
        fd = openSync(lock, "wx"); // O_EXCL : création atomique
      } catch {
        if (lockIsStale(lock)) {
          try {
            unlinkSync(lock);
          } catch {
            // course avec un autre worker : on retente au tour suivant
          }
        }
        continue; // slot pris
      }
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          unlinkSync(lock);
        } catch {
          // déjà libéré
        }
      };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `aucun slot de compilation Kotlin libre (${slots} en parallèle, verrous dans ${dir}) — ` +
          `un worker précédent a peut-être laissé un verrou périmé`,
      );
    }
    await Bun.sleep(120);
  }
}

/** Supprime un fichier (jar temporaire d'une compilation avortée), best-effort. */
function discard(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // déjà absent
  }
}

/** Compilateur Kotlin à utiliser. `KOTLINC_BIN` permet de pointer un
 *  compilateur précis — c'est ce que fait `kotlin-harness-process.test.ts`
 *  avec un faux compilateur qui bloque, pour prouver que le harnais le tue. */
function resolveKotlinc(): string | null {
  return process.env.KOTLINC_BIN ?? Bun.which("kotlinc");
}

/** JVM à utiliser pour le pilote. `KOTLIN_JAVA_BIN` permet d'en pointer une
 *  précise — c'est ce que fait `kotlin-harness-process.test.ts` avec un faux
 *  `java` qui ne rend jamais la main, pour prouver que le harnais l'arrête. */
export function resolveJava(): string | null {
  return process.env.KOTLIN_JAVA_BIN ?? Bun.which("java");
}

/**
 * Drapeaux de la JVM du pilote : C1 seul + GC sériel.
 *
 * Le pilote est un processus COURT : quelques opérations, puis il meurt. Le
 * compilateur C2 et le GC parallèle coûtent cher à démarrer et ne servent à
 * rien sur une charge minuscule. Ces drapeaux ne changent AUCUNE sémantique
 * (mêmes classes, mêmes résultats) — seulement la stratégie de compilation et
 * de GC. Mesuré : ~40 ms → ~34 ms de démarrage, et les 30 fichiers de
 * parité le paient 30 fois.
 *
 * Exporté : `kotlin-parity-union.test.ts` lance lui-même des JVM (pour
 * vérifier que chaque pilote se lance) et doit porter les mêmes drapeaux.
 */
export const JVM_FLAGS = ["-XX:TieredStopAtLevel=1", "-XX:+UseSerialGC"];

/** Shell du superviseur de compilation. */
function bash(): string {
  return Bun.which("bash") ?? "/bin/bash";
}

/** Superviseur de compilation : il tient le témoin (tube) du worker et tue le
 *  groupe de processus quand le worker meurt. */
const SUPERVISOR = join(import.meta.dir, "kotlin-compile.sh");

/** Raison du SKIP, ou null si la chaîne est complète. Résolu À CHAQUE APPEL :
 *  l'outillage peut apparaître (ou être pointé par une variable
 *  d'environnement) après le chargement du module. */
export function computeSkipReason(): string | null {
  if (!resolveKotlinc()) {
    return "`kotlinc` absent : installez le compilateur Kotlin (ou lancez `make android-compile` pour le diagnostic).";
  }
  if (!resolveJava()) {
    return "`java` absent : la parité a besoin d'une JVM pour exécuter le port compilé.";
  }
  return null;
}

/**
 * Compile les sources dans `jar`.
 *
 * - ASYNCHRONE : le worker de test reste interruptible.
 * - GROUPE DE PROCESSUS : le `java` du `kotlinc` meurt avec lui.
 * - PLAFOND DE DURÉE : un compilateur coincé est tué, pas attendu.
 * - ABANDON SI LE LANCEUR MEURT : `bun test` tué (Ctrl-C) laisse ses
 *   workers orphelins ; sans cette garde, leur `kotlinc` continuait de
 *   compiler en arrière-plan après le retour du terminal.
 * - JAR TEMPORAIRE : le binaire n'est renommé en place qu'une fois la
 *   compilation réussie — une compilation interrompue ne laisse pas un jar
 *   tronqué que le run suivant réutiliserait comme s'il était valide.
 */
async function compile(
  sources: string[],
  jar: string,
  timeoutMs: number,
  opts?: { includeRuntime?: boolean; classpath?: string[]; friendPaths?: string[]; label?: string },
): Promise<void> {
  const kotlinc = resolveKotlinc();
  if (!kotlinc) throw new Error("`kotlinc` absent : la compilation Kotlin est impossible");
  // Le nom temporaire DOIT finir en `.jar` : `kotlinc -d X` n'écrit un JAR
  // que si X se termine par `.jar` — sinon il écrit un RÉPERTOIRE de
  // classes, que `java -jar` refuse ensuite.
  const tmp = `${jar.replace(/\.jar$/, "")}.${process.pid}.partial.jar`;
  const flags = [
    ...(opts?.includeRuntime === false ? [] : ["-include-runtime"]),
    ...(opts?.classpath?.length ? ["-cp", opts.classpath.join(delimiter)] : []),
    ...(opts?.friendPaths?.length ? [`-Xfriend-paths=${opts.friendPaths.join(delimiter)}`] : []),
    "-d",
    tmp,
  ];
  // Le compilateur passe par le SUPERVISEUR (kotlin-compile.sh) : le worker
  // de test peut être tué SANS signal par `bun test --parallel` (SIGKILL au
  // Ctrl-C) et aucun code ne tourne alors pour tuer la compilation. Le
  // superviseur, lui, survit à son parent et tue le groupe quand le tube
  // du worker se ferme.
  const proc = Bun.spawn([bash(), SUPERVISOR, kotlinc, ...sources, ...flags], {
    stdin: "pipe", // le témoin : se ferme quand le worker meurt
    stdout: "pipe",
    stderr: "pipe",
    detached: true, // leader de son groupe : killGroup() l'atteint
    // `Bun.spawn` NE VOIT PAS les `process.env` changés après le démarrage du
    // process (il utilise l'environnement de launch) : on le passe en
    // clair, sinon `JAVA_HOME`, `JAVA_OPTS`, `KOTLIN_OPTS` et les
    // surcharges du harnais seraient ignorés par le compilateur.
    env: { ...process.env },
  });
  liveCompiles.add(proc);

  const parentPid = LAUNCHER_PID;
  let reason: "timeout" | "abandon" | null = null;
  const timer = setTimeout(() => {
    reason = "timeout";
    killGroup(proc.pid);
  }, timeoutMs);
  // Le lanceur de tests est-il encore vivant ? S'il est mort (Ctrl-C), le
  // worker est orphelin : compiler encore ne sert à personne et brûle un
  // cœur en arrière-plan.
  const watchdog = setInterval(() => {
    if (parentPid > 1 && !pidAlive(parentPid)) {
      reason = "abandon";
      killGroup(proc.pid);
    }
  }, 500);

  let stdout = "";
  let stderr = "";
  try {
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
  } finally {
    clearTimeout(timer);
    clearInterval(watchdog);
    liveCompiles.delete(proc);
  }
  const code = await proc.exited; // récolte le fils : pas de zombie

  if (reason === "timeout") {
    discard(tmp);
    throw new Error(
      `la compilation Kotlin a dépassé ${timeoutMs} ms et a été tuée (groupe de processus inclus) — ` +
        `le compilateur ne rend pas la main`,
    );
  }
  if (reason === "abandon") {
    discard(tmp);
    throw new Error(
      `la compilation Kotlin a été abandonnée : le lanceur de tests (pid ${parentPid}) est mort — ` +
        `le compilateur a été tué avec son groupe`,
    );
  }
  if (code !== 0) {
    discard(tmp);
    const hint = opts?.classpath
      ? "seuls les pilotes modifiés sont recompilés, contre port.jar seul"
      : "le port de parité est compilé D'UN SEUL BLOC à froid : le défaut peut être dans n'importe quel fichier du port";
    throw new Error(
      `${opts?.label ?? "le port Kotlin"} ne compile pas (défaut, pas un skip) :\n${stderr}\n${stdout}\n(${hint})`,
    );
  }
  renameSync(tmp, jar);
}

/**
 * Compile les sources dans `jar` — UNE SEULE FOIS, même quand plusieurs
 * workers la demandent en même temps.
 *
 * `bun test --parallel` lance un worker par fichier, et les 17 tests de
 * parité visent le MÊME jar : sans verrou, chaque worker compilerait le
 * port POUR SON COMPTE (17 JVM de compilation d'un coup, sur 16 cœurs).
 * Le verrou à jar règle ça : le premier compile, les autres ATTENDENT son
 * jar (cf. `jar-lock.ts`). Le sémaphore de slots borne, en plus, le nombre
 * de compilations SIMULTANÉES (filet de sécurité pour un harnais qui
 * viserait plusieurs jars distincts).
 */
export async function ensureJar(
  cacheName: string,
  sources: string[],
  opts?: { timeoutMs?: number },
): Promise<string> {
  const dir = join(ROOT, "node_modules", ".cache", cacheName, digestOf(sources));
  const jar = join(dir, "parity.jar");
  if (existsSync(jar)) return jar;
  mkdirSync(dir, { recursive: true });
  const timeoutMs = opts?.timeoutMs ?? compileTimeoutMs();
  return ensureSingleJar(
    jar,
    async () => {
      const deadline = Date.now() + timeoutMs;
      const release = await acquireSlot(deadline);
      try {
        await compile(sources, jar, timeoutMs);
      } finally {
        release();
      }
    },
    // Un worker en attente doit survivre à la compilation qu'il attend :
    // le plafond de la compilation, plus une marge.
    { waitMs: timeoutMs + 60_000 },
  );
}

/** Jars de la parité : le port compilé, ses pilotes, et l'overlay des pilotes
 *  modifiés depuis la compilation du port (absent si rien n'a bougé). */
export interface ParityJars {
  port: string;
  drivers: string;
  overlay?: string;
}

/** Incrémenter si le découpage change : un cache de l'ancien format ne doit
 *  pas être pris pour un port valide. */
const SPLIT_VERSION = 1;

function cacheRoot(): string {
  return join(ROOT, "node_modules", ".cache", "kotlin-parity");
}

function manifestOf(path: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Absent ou corrompu : tous les pilotes seront recompilés dans l'overlay.
  }
  return {};
}

/**
 * Port compilé + pilotes de base, mis en cache par l'empreinte des seules
 * sources de PRODUCTION.
 *
 * À froid, l'union reste compilée d'un bloc (le découpage de l'union est
 * moins cher que deux analyses `kotlinc` séparées) ; le jar est ensuite
 * éclaté par `SourceFile`. Un pilote modifié plus tard ne réutilise que le
 * port, jamais l'ancienne classe du pilote.
 */
async function ensurePort(timeoutMs: number): Promise<{
  dir: string;
  port: string;
  drivers: string;
  manifest: string;
}> {
  const dir = join(cacheRoot(), `${productionDigest()}-port-v${SPLIT_VERSION}`);
  const port = join(dir, "port.jar");
  const drivers = join(dir, "drivers.jar");
  const manifest = join(dir, "drivers.json");
  const ready = join(dir, "ready");
  mkdirSync(dir, { recursive: true });

  const build = async (): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    const release = await acquireSlot(deadline);
    const union = join(dir, "union.jar");
    try {
      await compile(PARITY_SOURCES, union, timeoutMs);
      const names = new Set(driverSources().map((p) => basename(p)));
      splitParityJar(union, port, drivers, names);
      const digests: Record<string, string> = {};
      for (const source of driverSources()) digests[basename(source)] = digestOf([source]);
      writeFileSync(manifest, JSON.stringify(digests));
      writeFileSync(ready, "1");
    } finally {
      try {
        unlinkSync(union);
      } catch {
        // compilation avortée : rien à supprimer
      }
      release();
    }
  };

  // Cache partiel (archivage interrompu) : le marqueur seul ne suffit pas.
  if (existsSync(ready) && (!existsSync(port) || !existsSync(drivers) || !existsSync(manifest))) {
    try {
      unlinkSync(ready);
    } catch {
      // déjà retiré par un autre worker
    }
  }
  if (!existsSync(ready)) {
    await ensureSingleJar(ready, build, { waitMs: timeoutMs + 60_000 });
  }
  if (!existsSync(port) || !existsSync(drivers) || !existsSync(manifest)) {
    throw new Error(`cache de parité incomplet dans ${dir} : port, pilotes ou manifeste absent`);
  }
  return { dir, port, drivers, manifest };
}

/**
 * Port + pilotes prêts pour `java -cp`.
 *
 * Les pilotes modifiés depuis la compilation du port sont compilés dans un
 * overlay à part, contre `port.jar` SEUL : l'ancienne classe du pilote n'est
 * donc pas sur le classpath de compilation (une déclaration supprimée ne peut
 * pas être « retrouvée » dans le cache). À l'exécution, l'overlay passe avant
 * les pilotes de base et masque leurs anciennes classes.
 */
export async function ensureParityJars(): Promise<ParityJars> {
  const timeoutMs = compileTimeoutMs();
  const base = await ensurePort(timeoutMs);
  const known = manifestOf(base.manifest);
  const changed = driverSources().filter((p) => known[basename(p)] !== digestOf([p]));
  if (changed.length === 0) return { port: base.port, drivers: base.drivers };

  const overlayDir = join(cacheRoot(), "overlay", `${productionDigest()}-v${SPLIT_VERSION}`, digestOf(changed));
  const overlay = join(overlayDir, "overlay.jar");
  mkdirSync(overlayDir, { recursive: true });
  await ensureSingleJar(
    overlay,
    async () => {
      const deadline = Date.now() + timeoutMs;
      const release = await acquireSlot(deadline);
      try {
        await compile(changed, overlay, timeoutMs, {
          includeRuntime: false,
          classpath: [base.port],
          friendPaths: [base.port],
          label: "les pilotes de parité modifiés",
        });
      } finally {
        release();
      }
    },
    { waitMs: timeoutMs + 60_000 },
  );
  return { port: base.port, drivers: base.drivers, overlay };
}
