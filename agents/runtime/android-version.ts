// Version Android dérivée du tag git : UN calcul pur, une seule lecture git.
// Un tag `vX.Y.Z` posé sur HEAD fixe `versionName` et `versionCode` ; sans tag,
// le repli est déterministe (jamais le nombre de commits, qui dépend de la
// branche et du checkout). Les pré-releases sont REFUSÉES : aucun `versionCode`
// strictement croissant ne peut être garanti entre `v1.2.3-beta.1` et `v1.2.3`.
export interface AndroidVersion {
  name: string;
  code: number;
}

/** Repli de développement : même valeur sur toute machine, tag présent ou non. */
export const FALLBACK_VERSION: AndroidVersion = { name: "0.1.0", code: 1 };

/** Plafond Android / Play : un `versionCode` au-delà n'est pas publiable. */
export const MAX_VERSION_CODE = 2_100_000_000;

const SCALE = 1_000;
const MAX_COMPONENT = SCALE - 1;
// SemVer interdit les zéros de tête : `v01.2.3` ne doit pas devenir `1.2.3`.
const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Un tag qui COMMENCE comme une version est une tentative de version : il est
// refusé, pas ignoré (contrairement à `backup-2024` ou `nightly`).
const VERSION_LIKE = /^v\d/;
const PRE_RELEASE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-/;

/**
 * Traduit UN tag en version Android. Un tag hors format de version rend `null` ;
 * un tag qui ressemble à une version mais est invalide lève une erreur nommée.
 */
export function versionFromTag(tag: string): AndroidVersion | null {
  if (!VERSION_LIKE.test(tag)) return null;
  if (PRE_RELEASE.test(tag)) {
    throw new Error(
      `tag de pré-release « ${tag} » refusé : le versionCode ne peut pas rester ` +
        `croissant entre une pré-release et sa version finale.`,
    );
  }
  const match = VERSION_TAG.exec(tag);
  if (match === null) {
    throw new Error(
      `tag « ${tag} » invalide : attendu vX.Y.Z (X, Y, Z sans zéro de tête, Y et Z < ${SCALE}).`,
    );
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (minor > MAX_COMPONENT || patch > MAX_COMPONENT) {
    throw new Error(
      `tag « ${tag} » invalide : les composantes mineure et corrective doivent être < ${SCALE}.`,
    );
  }
  const code = major * SCALE * SCALE + minor * SCALE + patch;
  if (code > MAX_VERSION_CODE) {
    throw new Error(
      `tag « ${tag} » invalide : versionCode ${code} > plafond Android ${MAX_VERSION_CODE}.`,
    );
  }
  return { name: `${major}.${minor}.${patch}`, code };
}

/**
 * Version du commit : le plus haut tag `vX.Y.Z` de HEAD, sinon le repli.
 * Plusieurs tags valides sur HEAD (alias) sont départagés par le code.
 */
export function versionFromTags(tags: readonly string[]): AndroidVersion {
  const versions = tags
    .map((tag) => versionFromTag(tag))
    .filter((version): version is AndroidVersion => version !== null);
  if (versions.length === 0) return { ...FALLBACK_VERSION };
  return versions.reduce((best, version) => (version.code > best.code ? version : best));
}

interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

function git(cwd: string, args: string[]): GitResult {
  try {
    const process = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const decoder = new TextDecoder();
    return {
      ok: process.exitCode === 0,
      out: decoder.decode(process.stdout).trim(),
      err: decoder.decode(process.stderr).trim(),
    };
  } catch {
    return { ok: false, out: "", err: "git introuvable" };
  }
}

/**
 * Tags posés sur HEAD. Une source sans dépôt git (archive) rend `[]` : le repli
 * s'applique. Un dépôt lisible mais une commande git en échec LÈVE : en release,
 * un repli silencieux publierait `0.1.0` sous un tag `vX.Y.Z`.
 */
export function tagsAtHead(cwd = process.cwd()): string[] {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) return [];
  const tags = git(cwd, ["tag", "--points-at", "HEAD"]);
  if (!tags.ok) {
    throw new Error(`git tag --points-at HEAD a échoué : ${tags.err || "code non nul"}`);
  }
  return tags.out.split("\n").filter((tag) => tag.length > 0);
}

if (import.meta.main) {
  try {
    const version = versionFromTags(tagsAtHead());
    console.log(`${version.name} ${version.code}`);
  } catch (error) {
    console.error(`android-version : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
