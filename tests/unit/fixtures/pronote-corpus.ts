// Chargement du corpus Pronote capturé (#199).
//
// Le corpus n'est PAS dans le dépôt : ce sont les réponses réelles d'un compte
// d'élève (données personnelles, règle Public). Une machine sans capture n'a
// donc rien à rejouer — mais elle ne doit surtout pas announce un vert de
// parité : `hasCorpus()` + un avertissement bruyant, et les tests de parité
// s'annoncent SKIP (cf. tests/unit/pronote-corpus.test.ts).
//
// Contenu = DONNÉE externe (I6) : chaque fixture porte `__untrusted`, aucun
// champ n'est interprété comme une instruction.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIR } from "../../../agents/runtime/capture-pronote";

export { CORPUS_DIR };

/** Un domaine absent = capture incomplète ou établissement qui n'a pas l'onglet. */
export function loadDomain(domain: string, dir: string = CORPUS_DIR): unknown | null {
  const file = join(dir, `${domain}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Tous les domaines présents sur la machine, triés (ordre de comparaison stable). */
export function listDomains(dir: string = CORPUS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/**
 * Le corpus est-il rejouable ? Volontairement STRCICT : la présence du
 * répertoire ne suffit pas, chaque domaine doit être lisible et marqué. Un
 * corpus à moitié écrit fait échouer le harnais de parité, pas son contrôle
 * d'amorçage.
 */
export function hasCorpus(dir: string = CORPUS_DIR): boolean {
  const domains = listDomains(dir);
  if (domains.length === 0) return false;
  return domains.every((d) => {
    const body = loadDomain(d, dir) as { __untrusted?: boolean } | null;
    return body !== null && body.__untrusted === true;
  });
}
