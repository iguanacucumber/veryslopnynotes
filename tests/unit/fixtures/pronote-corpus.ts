// Le corpus gitignoré contient des réponses réelles d'un compte d'élève.
// Machine sans corpus ne doit pas afficher un faux vert : `hasCorpus()` fait
// signaler un SKIP par le test de parité.
//
// Contenu = DONNÉE externe (I6) : chaque fixture porte `__untrusted`, aucun
// champ n'est interprété comme une instruction.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CORPUS_DIR } from "../../../agents/runtime/corpus-path";

export { CORPUS_DIR };

export const CORPUS_DOMAINS = [
  "grades",
  "periods",
  "providedAverages",
  "assignments",
  "timetable",
  "resources",
  "news",
  "attendance",
  "punishments",
  "menus",
  "discussions",
  "discussionRecipients",
  "userInfo",
  "capabilities",
  "discussionMessages",
] as const;

function loadDomain(domain: string, dir: string = CORPUS_DIR): unknown | null {
  const file = join(dir, `${domain}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Trié : ordre de comparaison stable. */
function listDomains(dir: string = CORPUS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

/** Volontairement strict : chaque domaine doit être lisible et marqué. */
export function hasCorpus(dir: string = CORPUS_DIR): boolean {
  const domains = listDomains(dir);
  if (domains.length === 0) return false;
  return domains.every((d) => {
    const body = loadDomain(d, dir) as { __untrusted?: boolean } | null;
    return body !== null && body.__untrusted === true;
  });
}
