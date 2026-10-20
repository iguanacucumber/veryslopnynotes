// Harnais partagé de la parité TS <-> Kotlin (#202).
//
// Compile des sources Kotlin pour de vrai (`kotlinc -include-runtime`, binaire
// en cache `node_modules/.cache/<nom>/<sha256>/`) puis pilote le binaire en
// JSON ligne à ligne (une opération par ligne sur stdin, une réponse par ligne
// sur stdout). La comparaison se fait sur du canonique (clés triées) côté test.
//
// Chaîne requise : `kotlinc` + `java`. Absente = `SKIP_REASON` renseigné + SKIP
// BRUYANT (jamais un faux vert, même philosophie que `make android-compile`).
// En revanche un ÉCHEC DE COMPILATION est un défaut : `ensureJar` lève (le code
// commité doit compiler).
//
// UN JAR POUR TOUT LE PORT (#444). Les 17 tests de parité visent le MÊME jar
// (cf. `parity-sources.ts`) : avant, chacun compilait son propre programme
// Kotlin, donc 15 `kotlinc` — 15 JVM neuves, ~400 s de CPU — pour un seul
// port. Le jar porte 17 `main()` : le pilote est lancé par sa CLASSE
// (`openLink(jar, { mainClass })`), pas par `java -jar`.
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
//      (Depuis #444, il n'y a plus qu'UN jar à compiler : le sémaphore est
//      devenu un filet de sécurité, le VERROU À JAR de `jar-lock.ts` fait
//      déjà qu'une seule compilation a lieu pour le port.)
//   4. ZOMBIS. Le pilote `java` était tué sans être récolté — `[java] <defunct>`
//      empilé dans `ps` après chaque run. On attend désormais sa mort.
import { afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { ensureSingleJar, lockIsStale } from "./jar-lock";
import { mainClassOf, PARITY_SOURCES } from "./parity-sources";

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
function resolveJava(): string | null {
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
 */
const JVM_FLAGS = ["-XX:TieredStopAtLevel=1", "-XX:+UseSerialGC"];

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
function computeSkipReason(): string | null {
  if (!resolveKotlinc()) {
    return "`kotlinc` absent : installez le compilateur Kotlin (ou lancez `make android-compile` pour le diagnostic).";
  }
  if (!resolveJava()) {
    return "`java` absent : la parité a besoin d'une JVM pour exécuter le port compilé.";
  }
  return null;
}

export interface ParityLink {
  /**
   * Une opération JSON → une ligne de réponse. Par défaut une ligne
   * `{"error":…}` lève (entrée malformée, défaut pilote) ; `allowError` la
   * renvoie telle quelle quand l'erreur du PORT est le résultat attendu
   * (parité des refus : nom + message comparés).
   */
  ask(op: unknown, opts?: { allowError?: boolean }): Promise<string>;
  close(): void;
}

export interface ParityToolchain {
  readonly skipReason: string | null;
  ensureJar(cacheName: string, sources: string[], opts?: { timeoutMs?: number }): Promise<string>;
  openLink(jar: string, opts?: { timezone?: string; mainClass?: string }): Promise<ParityLink>;
  /**
   * Compile le port de parité (UNE compilation pour tous les tests) et ouvre
   * le pilote `driverPath`. Raccourci des 17 tests : une ligne.
   */
  openParityLink(driverPath: string, opts?: { timezone?: string }): Promise<ParityLink>;
}

function toolchain(): ParityToolchain {
  const skipReason = computeSkipReason();
  if (skipReason) {
    console.warn(
      "\n" +
        "  SKIP BRUYANT — parité TS <-> Kotlin non vérifiée.\n" +
        `  ${skipReason}\n` +
        "  `make check` reste vert, mais il n'a PAS prouvé que le port calcule comme la référence.\n",
    );
  }

  /** sha256 du CONTENU des sources (une modification = nouveau cache). */
  function fileDigest(sources: string[]): string {
    const h = createHash("sha256");
    for (const f of sources) h.update(readFileSync(f));
    return h.digest("hex").slice(0, 16);
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
  async function compile(sources: string[], jar: string, timeoutMs: number): Promise<void> {
    const kotlinc = resolveKotlinc();
    if (!kotlinc) throw new Error("`kotlinc` absent : la compilation Kotlin est impossible");
    // Le nom temporaire DOIT finir en `.jar` : `kotlinc -d X` n'écrit un JAR
    // que si X se termine par `.jar` — sinon il écrit un RÉPERTOIRE de
    // classes, que `java -jar` refuse ensuite.
    const tmp = `${jar.replace(/\.jar$/, "")}.${process.pid}.partial.jar`;
    // Le compilateur passe par le SUPERVISEUR (kotlin-compile.sh) : le worker
    // de test peut être tué SANS signal par `bun test --parallel` (SIGKILL au
    // Ctrl-C) et aucun code ne tourne alors pour tuer la compilation. Le
    // superviseur, lui, survit à son parent et tue le groupe quand le tube
    // du worker se ferme.
    const proc = Bun.spawn([bash(), SUPERVISOR, kotlinc, ...sources, "-include-runtime", "-d", tmp], {
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
      throw new Error(
        `le port Kotlin ne compile pas (défaut, pas un skip) :\n${stderr}\n${stdout}` +
          `\n(le port de parité est compilé D'UN SEUL BLOC : le défaut ci-dessus peut être dans n'importe ` +
          `quel fichier du port, pas seulement dans celui du test qui échoue)`,
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
  async function ensureJar(
    cacheName: string,
    sources: string[],
    opts?: { timeoutMs?: number },
  ): Promise<string> {
    const dir = join(ROOT, "node_modules", ".cache", cacheName, fileDigest(sources));
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

  async function openLink(
    jar: string,
    opts?: { timezone?: string; mainClass?: string },
  ): Promise<ParityLink> {
    const java = resolveJava();
    if (!java) throw new Error("`java` absent : le pilote Kotlin ne peut pas démarrer");
    // Même fuseau des deux côtés : `bun test` fige UTC, la JVM prend le
    // système — sans ça les `LocalDateTime` muraux divergent d'autant d'heures.
    const timezone = opts?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Le jar de parité porte 17 `main()` : `java -jar` ne peut pas choisir.
    // Avec une classe, on la lance par son nom (`-cp` + classe).
    const args = ["-Dfile.encoding=UTF-8", `-Duser.timezone=${timezone}`];
    // C1 SEUL (`TieredStopAtLevel=1`) : le pilote est un processus COURT qui
    // fait quelques opérations puis meurt. Le compilateur C2 (le-optimisant)
    // coûte cher à démarrer et ne sert à rien sur une charge si petite — le
    // pilote y passe 20 ms. `-XX:+UseSerialGC` va de pair : un GC parallèle
    // lance des fils de GC pour une heap minuscule.
    // Ces drapeaux ne CHANGENT AUCUNE sémantique (même code, mêmes classes,
    // mêmes résultats) : ils changent la stratégie de compilation et de GC.
    // Mesuré sur ce harnais : le démarrage du pilote passe de ~40 ms à ~34 ms,
    // et les 30 fichiers de parité le paient 30 fois.
    if (opts?.mainClass) args.push("-cp", jar, opts.mainClass);
    else args.push("-jar", jar);
    const proc = Bun.spawn([java, ...JVM_FLAGS, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env }, // idem : l'environnement de launch ne suffit pas
    });
    const sink = proc.stdin;
    const reader = proc.stdout.getReader();
    let pending = "";
    const decoder = new TextDecoder("utf-8");
    async function readLine(): Promise<string> {
      for (;;) {
        const nl = pending.indexOf("\n");
        if (nl >= 0) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          return line;
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("le pilote Kotlin a fermé stdout au milieu d'une opération");
        pending += decoder.decode(value, { stream: true });
      }
    }
    // Drain stderr : une erreur pilote y est expliquée (jamais un résultat vide).
    const errors: string[] = [];
    (async () => {
      const errReader = proc.stderr.getReader();
      let buf = "";
      for (;;) {
        const { done, value } = await errReader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) errors.push(l.trim());
      }
    })();
    // Le pilote doit MOURIR avec le test ET être RÉCOLTÉ : `kill()` seul
    // laissait un `[java] <defunct>` empilé dans `ps` (le processus mort, jamais
    // attendu). `proc.exited` attend la mort ET ramasse le fils.
    //
    // ARRÊT PAR EOF D'ABORD (mesuré : 358 ms sur SIGTERM contre ~2 ms par
    // fermeture de stdin). Le pilote lit ses opérations ligne à ligne sur
    // stdin (`stdin.readLine() ?: break`) : à la fermeture du tube, `readLine`
    // rend null, la boucle se termine et la JVM sort TOUTE SEULE. Un SIGTERM,
    // lui, laisse la JVM dérouler ses hooks d'arrêt : ~350 ms × 30 fichiers de
    // parité, c'était le poste le plus lourd de la suite.
    //
    // LE FILET EST INDISPENSABLE : un pilote qui ne LIT PAS stdin (le faux
    // `java` de `kotlin-harness-process.test.ts`) ne sort pas par là. SIGTERM
    // puis SIGKILL, donc un pilote coincé ne survit jamais au test.
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      try {
        sink.end(); // EOF : le pilote sort de sa boucle de lecture.
      } catch {
        // tube déjà fermé (le pilote était mort)
      }
      // Course : si le pilote sort sur EOF, c'est gagné en ~2 ms. Le délai
      // n'est JAMAIS attendu quand le pilote est sage.
      //
      // Le minuteur est ANNULÉ dans les deux cas : un `Bun.sleep` laissé en
      // vol retiendrait le worker de test vivant jusqu'à son terme (250 ms
      // × 30 fichiers de parité : exactement le temps qu'on cherche à
      // gagner).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const exited = await Promise.race([
        proc.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 250);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (exited) return;
      try {
        proc.kill("SIGTERM");
      } catch {
        // déjà mort
      }
      let hard: ReturnType<typeof setTimeout> | undefined;
      const killed = await Promise.race([
        proc.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          hard = setTimeout(() => resolve(false), 2000);
        }),
      ]);
      if (hard) clearTimeout(hard);
      if (killed) return;
      try {
        proc.kill("SIGKILL");
      } catch {
        // déjà mort
      }
      await proc.exited; // récolte : pas de zombie.
    };
    afterAll(stop);
    return {
      async ask(op: unknown, opts?: { allowError?: boolean }): Promise<string> {
        sink.write(`${JSON.stringify(op)}\n`);
        await sink.flush();
        const line = await Promise.race([
          readLine(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pilote Kotlin sans réponse (30 s)")), 30000)),
        ]);
        if (line.startsWith('{"error":') && !opts?.allowError) {
          throw new Error(`erreur pilote (entrée malformée ?) : ${line} — stderr: ${errors.join(" | ")}`);
        }
        if (line.startsWith('{"error":')) {
          const parsed = JSON.parse(line) as { message?: string };
          if (typeof parsed.message === "string" && parsed.message.startsWith("pilote: ")) {
            throw new Error(`erreur pilote : ${line} — stderr: ${errors.join(" | ")}`);
          }
        }
        return line;
      },
      close() {
        void stop();
      },
    };
  }

  /**
   * Compile le port de parité (UNE compilation pour tous les tests) et ouvre
   * le pilote `driverPath`.
   *
   * Le jar est partagé : les 17 tests de parité visent le même, donc le
   * verrou de `ensureJar` fait compiler UNE fois (et les autres attendent).
   */
  async function openParityLink(
    driverPath: string,
    opts?: { timezone?: string },
  ): Promise<ParityLink> {
    const jar = await ensureJar("kotlin-parity", PARITY_SOURCES);
    return openLink(jar, { ...opts, mainClass: mainClassOf(driverPath) });
  }

  return {
    // Getter : la raison du SKIP est re-résolue à chaque lecture (l'outillage
    // peut apparaître, ou être pointé par `KOTLINC_BIN`, après le chargement).
    get skipReason() {
      return computeSkipReason();
    },
    ensureJar,
    openLink,
    openParityLink,
  };
}

export const parityToolchain: ParityToolchain = toolchain();

/** Même forme que les pilotes : clés triées, `undefined` = clé omise. */
export function canonTs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonTs).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonTs(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
