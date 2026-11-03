// Persistance du jar de session du serveur : répertoire 0700, jar 0600,
// écriture atomique, une seule sauvegarde, temporaires nettoyés au démarrage.
// Aucun log ne contient le contenu du jar : modes et compteurs seulement.
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { chmod, copyFile, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const JAR_DIR_MODE = 0o700;
export const JAR_FILE_MODE = 0o600;
const BACKUP_SUFFIX = ".bak";

export type JarLogger = (message: string) => void;

/** Contexte Playwright réduit à la persistance du jar. */
export interface JarContext {
  storageState: (options: { path: string }) => Promise<unknown>;
}

let jarWriteChain: Promise<void> = Promise.resolve();
let jarTempSeq = 0;

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

function isJarTemp(base: string, entry: string): boolean {
  return entry.startsWith(`${base}.tmp-`) || entry.startsWith(`${base}.bak.tmp-`);
}

/** Crée le répertoire du jar en 0700, ou resserre ses permissions. */
function ensureJarDir(path: string, log: JarLogger): void {
  const dir = dirname(path);
  let existed = false;
  try {
    statSync(dir);
    existed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  mkdirSync(dir, { recursive: true, mode: JAR_DIR_MODE });
  const before = modeOf(dir);
  if (before !== JAR_DIR_MODE) chmodSync(dir, JAR_DIR_MODE);
  if (!existed) log("jar -> repertoire cree (0700)");
  else if (before !== JAR_DIR_MODE) log("jar -> permissions du repertoire durcies (0700)");
}

/** Supprime les temporaires laissés par une écriture interrompue. */
export function cleanupJarTemps(path: string, log: JarLogger = () => {}): void {
  const dir = dirname(path);
  const base = basename(path);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    log("jar -> nettoyage des temporaires impossible");
    return;
  }
  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!isJarTemp(base, entry)) continue;
    try {
      unlinkSync(join(dir, entry));
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  if (removed > 0) log(`jar -> ${removed} temporaire(s) obsolete(s) supprime(s)`);
  if (failed > 0) log(`jar -> ${failed} temporaire(s) obsolete(s) non supprime(s)`);
}

/** Resserre le jar et sa sauvegarde existants : jamais groupe/monde lisible. */
function hardenExistingJar(path: string, log: JarLogger): void {
  for (const file of [path, `${path}${BACKUP_SUFFIX}`]) {
    try {
      if (!statSync(file).isFile()) continue;
      if (modeOf(file) === JAR_FILE_MODE) continue;
      chmodSync(file, JAR_FILE_MODE);
      log("jar -> permissions du fichier durcies (0600)");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
}

/**
 * Prépare le stockage au démarrage : répertoire 0700, temporaires périmés
 * supprimés, jar existant resserré en 0600. Un échec de permission arrête le
 * démarrage : écrire une session lisible par tous serait pire que ne pas servir.
 */
export function prepareJarStore(path: string, log: JarLogger = () => {}): void {
  try {
    ensureJarDir(path, log);
  } catch (err) {
    log("jar -> preparation du repertoire impossible");
    throw err;
  }
  cleanupJarTemps(path, log);
  try {
    hardenExistingJar(path, log);
  } catch (err) {
    log("jar -> permissions du fichier non appliquees");
    throw err;
  }
}

/**
 * Écrit le jar par temporaire + `rename`, le temporaire étant créé en 0600
 * AVANT que Playwright n'y écrive : aucune fenêtre groupe/monde lisible.
 * La version précédente est copiée dans un unique `.bak` avant le `rename`
 * final ; un échec laisse donc le jar précédent intact.
 */
async function persistJar(context: JarContext, path: string, log: JarLogger): Promise<void> {
  jarTempSeq += 1;
  const tmp = `${path}.tmp-${process.pid}-${jarTempSeq}`;
  const backup = `${path}${BACKUP_SUFFIX}`;
  let backupTmp: string | null = null;
  let rotating = false;
  try {
    ensureJarDir(path, log);
    const handle = await open(tmp, "wx", JAR_FILE_MODE);
    await handle.close();
    await context.storageState({ path: tmp });
    await chmod(tmp, JAR_FILE_MODE);
    if (existsSync(path)) {
      rotating = true;
      backupTmp = `${backup}.tmp-${process.pid}-${jarTempSeq}`;
      await copyFile(path, backupTmp);
      await chmod(backupTmp, JAR_FILE_MODE);
      await rename(backupTmp, backup);
      backupTmp = null;
    }
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    if (backupTmp !== null) await unlink(backupTmp).catch(() => {});
    log(rotating ? "jar -> rotation de sauvegarde impossible" : "jar -> ecriture du jar impossible");
    throw err;
  }
}

/** Sérialise les écritures : deux scrapes ne touchent jamais le jar ensemble. */
export function saveJar(context: JarContext, path: string, log: JarLogger = () => {}): Promise<void> {
  // `then(run, run)` : une écriture précédente ratée ne bloque pas la suivante.
  const next = jarWriteChain.then(
    () => persistJar(context, path, log),
    () => persistJar(context, path, log),
  );
  jarWriteChain = next.catch(() => {});
  return next;
}
