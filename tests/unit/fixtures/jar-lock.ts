// Le VERROU À JAR de la parité Kotlin (#444).
//
// POURQUOI UN VERROU. `bun test --parallel` lance un worker par fichier, et
// les 17 tests de parité visent le MÊME jar (un seul port, une seule
// compilation). Sans verrou, chaque worker compilerait le port POUR SON
// COMPTE : 17 JVM `kotlinc` d'un coup sur 16 cœurs, ~400 s de CPU.
//
// COMMENT. Un verrou = un fichier créé en O_EXCL (création atomique) qui
// porte le pid du détenteur. Le premier qui le prend compile ; les autres
// ATTENDENT le jar (au lieu de compiler aussi). Un worker mort en laisse un
// verrou périmé : le pid mort le signale, on le récupère.
//
// Le verrou est un FICHIER, pas une promesse en mémoire : les workers de
// `bun test --parallel` sont des PROCESSUS distincts, un sémaphore en
// mémoire ne servirait à rien.
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";

/** Plafond d'attente par défaut (10 min) : au-delà, c'est un défaut bruyant. */
const WAIT_MS = 600_000;
/** Pas de scrutation : 100 ms suffit (le jar paraît en une seule fois). */
const POLL_MS = 100;

/** Le verrou est-il périmé (le détenteur est mort) ? */
export function lockIsStale(lock: string): boolean {
  let raw = "";
  try {
    raw = readFileSync(lock, "utf8").trim();
  } catch {
    return false; // déjà libéré : le prochain tour le reprendra
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    // Verrou vide : le détenteur vient de le créer (il n'a pas encore écrit
    // son pid). On ne le vole pas — sauf s'il est vieux, donc orphelin.
    try {
      return Date.now() - statSync(lock).mtimeMs > 30_000;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return false; // le détenteur vit
  } catch (e) {
    // ESRCH = mort (périmé) ; EPERM = vivant mais pas à nous.
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Produce `jar` UNE SEULE FOIS, même quand plusieurs workers le demandent.
 *
 * `compile` n'est appelé que par le détenteur du verrou ; les autres
 * attendent le fichier. Si le jar existe déjà, `compile` n'est pas appelé du
 * tout (cache chaud).
 *
 * ÉCHEC DE COMPILATION. Le détenteur qui échoue écrit le message dans
 * `<jar>.error` puis relâche le verrou. Les workers en ATTENTE lisent ce
 * message et échouent eux aussi, au lieu de compiler à leur tour : sans ça,
 * un port cassé coûtait 17 compilations SÉQUENTIELLES (17 × 4 s). Un run
 * ULTÉRIEUR, lui, retente : le marqueur d'échec n'est pas collé au cache
 * (seule la compilation est ratée, pas les runs suivants).
 */
export async function ensureSingleJar(
  jar: string,
  compile: () => void | Promise<void>,
  opts?: { waitMs?: number; pollMs?: number },
): Promise<string> {
  // Les fichiers voisins s'appellent `parity.lock` / `parity.error`, PAS
  // `parity.jar.lock` : un glob `*.jar*` (le test du harnais qui exige
  // qu'aucun binaire ne reste après un échec) ne doit pas les prendre pour
  // des binaires.
  const base = jar.replace(/\.jar$/, "");
  const lock = `${base}.lock`;
  const errorFile = `${base}.error`;
  const waitMs = opts?.waitMs ?? WAIT_MS;
  const pollMs = opts?.pollMs ?? POLL_MS;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (existsSync(jar)) return jar; // déjà produit (cache chaud, ou un autre worker)
    // Le détenteur a relâché le verrou SANS produire de jar : il a échoué.
    // On regarde ce marqueur AVANT de tenter le verrou — sinon le worker
    // suivant reprend la compilation, et l'échec se répète en série.
    if (!existsSync(lock) && existsSync(errorFile)) {
      // Un autre worker a pu reprendre la compilation entre-temps : on lui
      // laisse une scrutation avant de conclure à l'échec.
      await Bun.sleep(pollMs);
      if (existsSync(jar)) return jar;
      const message = readFileSync(errorFile, "utf8");
      try {
        unlinkSync(errorFile);
      } catch {
        // déjà repris par un autre worker
      }
      throw new Error(message);
    }
    let fd: number | null = null;
    try {
      fd = openSync(lock, "wx"); // O_EXCL : création atomique
    } catch {
      fd = null; // verrou pris par un autre worker
    }
    if (fd !== null) {
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      try {
        if (!existsSync(jar)) {
          // Un marqueur d'échec périmé ne doit pas masquer la nouvelle tentative.
          try {
            unlinkSync(errorFile);
          } catch {
            // pas de marqueur
          }
          try {
            await compile();
          } catch (err) {
            try {
              writeFileSync(errorFile, err instanceof Error ? err.message : String(err));
            } catch {
              // le marqueur est un confort, pas une obligation
            }
            throw err;
          }
        }
        return jar;
      } finally {
        try {
          unlinkSync(lock);
        } catch {
          // déjà libéré
        }
      }
    }
    // Un autre worker compile : on ATTEND son jar au lieu de compiler aussi.
    if (lockIsStale(lock)) {
      try {
        unlinkSync(lock);
      } catch {
        // course avec un autre worker : on retente au tour suivant
      }
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `le jar ${jar} n'a pas été produit dans les ${waitMs} ms (verrou : ${lock}) — ` +
          `un worker précédent a peut-être laissé un verrou périmé`,
      );
    }
    await Bun.sleep(pollMs);
  }
}
