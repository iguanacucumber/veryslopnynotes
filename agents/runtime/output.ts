// Sortie de gate BORNÉE : 10 items par défaut, une ligne par item, chemins
// relatifs au dépôt, le reste dans un log à chemin STABLE (lisible après le
// runner, uploadable par la CI). On borne l'AFFICHAGE seulement : le verdict et
// le code de sortie gardent TOUS les items (I5, pas de vert par filtrage).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Items affichés avant `… reste: N`. */
export const MAX_ITEMS = 10;

/** Chemin d'affichage : relatif au dépôt, séparateurs POSIX. */
export function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Log complet de l'étape, sous le cache du dépôt (gitignoré). Nom STABLE :
 *  le poste et la CI écrivent le même fichier, uploadable en artefact. */
export function logPath(root: string, step: string): string {
  const dir = join(root, "node_modules", ".cache", "gate-logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${step}.log`);
}

/** Logs déjà écrits par CE processus : une même étape peut borner plusieurs
 *  blocs (un par invariant), ils s'AJOUTENT. La première écriture tronque le
 *  log du run précédent (sinon un vieux log passerait pour le courant). */
const ecrits = new Set<string>();

/** Lignes bornées : les `max` premiers items (déjà formatés, un item = une
 *  ligne), puis `… reste: N` et le chemin du log complet si la liste déborde. */
export function bound(
  root: string,
  step: string,
  items: readonly string[],
  max: number = MAX_ITEMS,
): string[] {
  if (items.length <= max) return [...items];
  const file = logPath(root, step);
  const flag = ecrits.has(file) ? "a" : "w";
  writeFileSync(file, items.join("\n") + "\n", { mode: 0o600, flag });
  ecrits.add(file);
  const reste = items.length - max;
  return [...items.slice(0, max), `… reste: ${reste} — log complet : ${repoPath(root, file)}`];
}
