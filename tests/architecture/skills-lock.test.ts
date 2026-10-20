// Le lock vendorisé (`skills-lock.json`) est DÉCORATIF : son `computedHash`
// vient de l'outil `npx skills`, dont l'algorithme n'est pas documenté dans le
// dépôt — il n'est donc pas recalculable ici (vérifié : aucune combinaison
// simple de fichier/contenu ne redonne le hash). Sans contrôle, une skill
// vendorisée pouvait être ÉDITÉE à la main : c'est le dossier le moins
// contrôlé du dépôt, et le seul dont le contenu imite des secrets (I11).
//
// Ce test est le VERROU vérifiable du dépôt : sha256 de chaque arbre de skill
// (chemins relatifs triés + contenu), comparé à une table ci-dessous. Une
// mise à jour (`npx skills update`) fait échouer le test : la table est alors
// mise à jour au même moment que le lock amont — le changement devient
// VISIBLE dans la PR, au lieu d'être silencieux.
//
// ponytail: une table dans le test, pas un nouveau fichier de lock : le dépôt
// n'a pas de format de lock maison, et un fichier de plus serait une source
// de vérité de plus à garder en sync.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "../unit/fixtures/kotlin-harness";

const AGENTS = join(ROOT, ".agents");
const SKILLS = join(AGENTS, "skills");

/** sha256 de l'ARBRE d'une skill : chemins relatifs triés + contenu. */
function treeHash(dir: string): string {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(dir, file));
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/**
 * Empreintes attendues des skills vendorisées.
 *
 * À mettre à jour SEULEMENT avec le lock amont (`npx skills update`), dans la
 * même PR : la PR montre alors le contenu tiers qui change.
 */
const ATTENDU: Record<string, string> = {
  "code-review": "5c784252646f78647d682f1ed3a2f0a87e836723869d07b2587ef52d6fec6a91",
  "impeccable": "5b6976fc7757938909a89e203015dd32f2d63e170253a956a3043e7bc362e635",
  "kotlin-specialist": "413b67a01ad985a94baa5137c12c8c0d3e1ca47fcc5915625597c78bdc4afcf2",
  "playwright-best-practices": "68fa97dd4ff0cb6829ecd5198814a2d4c23e039d24f1d13d840ca2d2fc2beb0e",
  "security-review": "db4c7df72d5a14fbf7fa8051a95177f7192b3eeb8c593f3012bc4ba71586604e",
  "systematic-debugging": "cf38cce969d8c7f156d5919356d4a6a31a3ac943d3da6d25c021ad5a472a21b2",
  "vercel-react-best-practices": "06c92a29e848b85ceb9b0367d4384f67c51c20b0013dd29679a3d5163e8a34b7",
  "web-design-guidelines": "d5cb29ea15d5ceeb4ef0802e75c17ef4287c6f60ff8aa05e46c6080f615178bc",
};

describe("skills vendorisées : le lock est vérifiable", () => {
  test("chaque skill vendorisée a l'empreinte attendue", () => {
    const vues: Record<string, string> = {};
    for (const skill of Object.keys(ATTENDU).sort()) {
      vues[skill] = treeHash(join(SKILLS, skill));
    }
    expect(vues).toEqual(ATTENDU);
  });

  test("le lock amont et le dépôt vendorisé portent les MÊMES skills", () => {
    const lock = JSON.parse(readFileSync(join(AGENTS, "..", "skills-lock.json"), "utf8")) as {
      skills: Record<string, unknown>;
    };
    expect(Object.keys(lock.skills).sort()).toEqual(Object.keys(ATTENDU).sort());
    // Une skill présente sur le disque mais absente du lock amont (ou
    // l'inverse) = une copie non tracée.
    const surDisque = readdirSync(SKILLS).sort();
    expect(surDisque).toEqual(Object.keys(ATTENDU).sort());
  });
});
