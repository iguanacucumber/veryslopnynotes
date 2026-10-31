// Sortie de gate BORNÉE, log à chemin STABLE (uploadable par la CI). On borne
// l'AFFICHAGE seulement : le verdict garde TOUS les items (I5).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const MAX_ITEMS = 10;

export function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Log de l'étape sous le cache du dépôt : nom STABLE, poste et CI identiques. */
export function logPath(root: string, step: string): string {
  const dir = join(root, "node_modules", ".cache", "gate-logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${step}.log`);
}

/** Logs déjà écrits par CE processus : une même étape peut borner plusieurs
 *  blocs, ils s'AJOUTENT. La première écriture tronque le log du run précédent. */
const ecrits = new Set<string>();

/** Les `max` premiers items, puis `… reste: N` et le chemin du log complet. */
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
