// Harnais partagé de la parité TS <-> Kotlin (#202) — PROTOCOLE et HELPERS.
//
// Pilote le binaire compilé en JSON ligne à ligne (une opération par ligne sur
// stdin, une réponse par ligne sur stdout). La comparaison se fait sur du
// canonique (clés triées) côté test. La compilation et le cache du jar vivent
// dans `kotlin-harness-build.ts` ; ce fichier ré-exporte ses symboles publics
// (`ROOT`, `JVM_FLAGS`, `killGroup`) pour que les tests n'aient qu'un import.
//
// Chaîne requise : `kotlinc` + `java`. Absente = `SKIP_REASON` renseigné + SKIP
// BRUYANT (jamais un faux vert, même philosophie que `make android-compile`).
// En revanche un ÉCHEC DE COMPILATION est un défaut : `ensureJar` lève (le code
// commité doit compiler).
//
// (Le détail du geste des processus — groupes, plafond, sémaphore — est dans
// `kotlin-harness-build.ts` : c'est la compilation qui tient ces ressources.)
import { afterAll } from "bun:test";
import { delimiter } from "node:path";
import { computeSkipReason, ensureJar, ensureParityJars, JVM_FLAGS, resolveJava } from "./kotlin-harness-build";
import { mainClassOf } from "./parity-sources";

export { JVM_FLAGS, killGroup, ROOT } from "./kotlin-harness-build";
// La clé de cache du jar se calcule dans `kotlin-harness-build.ts` (via
// `digestOf`) ; on ré-exporte le calcul pour que le harnais reste le seul
// point d'entrée des tests et que l'empreinte n'ait qu'une définition.
export { digestOf } from "./parity-sources";

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
  ensureParityJars(): Promise<{ port: string; drivers: string; overlay?: string }>;
  openLink(
    jar: string | string[],
    opts?: { timezone?: string; mainClass?: string },
  ): Promise<ParityLink>;
  /**
   * Ouvre le pilote `driverPath` depuis le port compilé et ses pilotes (ou
   * leur overlay). Raccourci des tests de parité : une ligne.
   */
  openParityLink(driverPath: string, opts?: { timezone?: string }): Promise<ParityLink>;
}

function toolchain(): ParityToolchain {
  const skipReason = computeSkipReason();
  if (skipReason) {
    // #491 : le GATE exige la chaîne Kotlin (`REQUIRE_KOTLIN_TOOLCHAIN=1`) :
    // sans elle, toute la parité saute et le gate est vert sans une ligne de
    // production Kotlin exécutée (I4/I5/I6/I12/I14/I16/I18/I19/I20/I21 non
    // vérifiées) — un faux vert. L'itération (`make check-fast`, `make watch`)
    // garde le SKIP bruyant.
    if (process.env.REQUIRE_KOTLIN_TOOLCHAIN === "1") {
      throw new Error(
        `outillage Kotlin ABSENT — la parité TS <-> Kotlin n'est PAS vérifiée : ${skipReason} ` +
          "(installez `kotlinc`, ou pointez KOTLINC_BIN/KOTLIN_JAVA_BIN ; le gate l'exige).",
      );
    }
    console.warn(
      "\n" +
        "  SKIP BRUYANT — parité TS <-> Kotlin non vérifiée.\n" +
        `  ${skipReason}\n` +
        "  `make check` reste vert, mais il n'a PAS prouvé que le port calcule comme la référence.\n",
    );
  }

  async function openLink(
    jar: string | string[],
    opts?: { timezone?: string; mainClass?: string },
  ): Promise<ParityLink> {
    const java = resolveJava();
    if (!java) throw new Error("`java` absent : le pilote Kotlin ne peut pas démarrer");
    // Même fuseau des deux côtés : `bun test` fige UTC, la JVM prend le
    // système — sans ça les `LocalDateTime` muraux divergent d'autant d'heures.
    const timezone = opts?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Les pilotes portent 17 `main()` : `java -jar` ne peut pas choisir.
    // Avec une classe, on la lance par son nom (`-cp` + classe).
    const jars = Array.isArray(jar) ? jar : [jar];
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
    if (opts?.mainClass) args.push("-cp", jars.join(delimiter), opts.mainClass);
    else if (jars.length === 1) args.push("-jar", jars[0]!);
    else throw new Error("un classpath multiple exige la classe principale du pilote");
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
    //
    // L'arrêt est IDEMPOTENT et PARTAGEABLE : `close()` (appelé en cours de
    // test) et `afterAll` (la récolte finale) obtiennent la MÊME promesse.
    // Avant, `close()` lancait l'arrêt en fond et `afterAll` repartait
    // aussitôt : la récolte pouvait ne jamais.aboutir. Ici, `afterAll`
    // attend toujours la mort effective du fils — pas de `[java] <defunct>`.
    let stopping: Promise<void> | null = null;
    const stop = (): Promise<void> => {
      if (stopping) return stopping;
      stopping = (async (): Promise<void> => {
        try {
          sink.end(); // EOF : le pilote sort de sa boucle de lecture.
        } catch {
          // tube déjà fermé (le pilote était mort)
        }
        // Course : si le pilote sort sur EOF, c'est gagné en ~2 ms. Le délai
        // n'est JAMAIS attendu quand le pilote est sage.
        //
        // Le minuteur est ANNULÉ dans les deux cas : un `Bun.sleep` laissé en
        // vol retiendrait le worker de test vivant jusqu'à son terme (100 ms
        // × 30 fichiers de parité : exactement le temps qu'on cherche à
        // gagner).
        let timer: ReturnType<typeof setTimeout> | undefined;
        const exited = await Promise.race([
          proc.exited.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 100);
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
      })();
      return stopping;
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
        // L'arrêt est lancé mais pas attendu : `close()` est synchrone par
        // contrat. `afterAll` attend la MÊME promesse (voir `stop`), donc la
        // récolte aboutit quand même.
        void stop();
      },
    };
  }

  /**
   * Compile/reutilise le port de parité et ouvre le pilote `driverPath`.
   *
   * Le port et les pilotes de base sont partagés par tous les tests ; seuls
   * les pilotes modifiés passent par un overlay (verrou par artefact). Le
   * verrou de `ensureSingleJar` fait compiler chacun UNE fois, les autres
   * attendent le même binaire.
   */
  async function openParityLink(
    driverPath: string,
    opts?: { timezone?: string },
  ): Promise<ParityLink> {
    const jars = await ensureParityJars();
    return openLink(
      [jars.overlay, jars.drivers, jars.port].filter((p): p is string => p !== undefined),
      { ...opts, mainClass: mainClassOf(driverPath) },
    );
  }

  return {
    // Getter : la raison du SKIP est re-résolue à chaque lecture (l'outillage
    // peut apparaître, ou être pointé par `KOTLINC_BIN`, après le chargement).
    get skipReason() {
      return computeSkipReason();
    },
    ensureJar,
    ensureParityJars,
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
