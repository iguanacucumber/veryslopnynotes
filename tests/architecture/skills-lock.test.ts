// Le contenu vendorisé (`.agents/`) est contrôlé par une empreinte recalculable :
// sha256 de l'ARBRE de chaque skill, comparé à la table ci-dessous. Une édition
// manuelle échoue ; `npx skills update` aussi, la table se met alors à jour dans
// la MÊME PR — le changement tiers devient visible.
//
// La provenance du lock (`computedHash` amont) n'est pas vérifiable ici :
// l'algorithme de `npx skills` n'est pas documenté, et l'interroger demanderait
// le réseau, hors du gate.
//
// ponytail: une table dans le test, pas un nouveau fichier de lock : un fichier
// de plus serait une source de vérité de plus à garder en sync.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "../unit/fixtures/kotlin-harness";

const AGENTS = join(ROOT, ".agents");
const SKILLS = join(AGENTS, "skills");

/** sha256 de l'arbre : chemins relatifs triés + contenu, séparés par `\0`. */
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
 * À mettre à jour SEULEMENT avec le lock amont (`npx skills update`), dans la
 * même PR.
 */
const ATTENDU: Record<string, string> = {
  "code-review": "5c784252646f78647d682f1ed3a2f0a87e836723869d07b2587ef52d6fec6a91",
  impeccable: "b2e58e101de25ac171189f29b9c79fd41c3ccb3d60330e660970b0a9dfb9b8e3",
};

/** Plafond PAR skill : le dépassement doit être un choix visible en PR. */
const PLAFOND: Record<string, number> = {
  "code-review": 24_576,
  // Détecteur autonome + index de polices embarqués par la skill amont.
  impeccable: 2_400_000,
};

const LOCK = JSON.parse(readFileSync(join(AGENTS, "..", "skills-lock.json"), "utf8")) as {
  skills: Record<string, unknown>;
};

describe("skills vendorisées : le contenu est verrouillé", () => {
  test("chaque skill vendorisée a l'empreinte attendue", () => {
    const vues = Object.fromEntries(
      readdirSync(SKILLS)
        .sort()
        .map((skill) => [skill, treeHash(join(SKILLS, skill))]),
    );
    expect(vues).toEqual(ATTENDU);
  });

  test("le lock amont et le dépôt vendorisé portent les MÊMES skills", () => {
    expect(Object.keys(LOCK.skills).sort()).toEqual(readdirSync(SKILLS).sort());
  });

  test("une skill vendorisée reste petite", () => {
    // Un `npx skills add <source>` sans `@skill` a déjà ramené 3,3 Mo de
    // collection : le plafond rend l'ajout visible dans le diff.
    for (const skill of readdirSync(SKILLS)) {
      let total = 0;
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) walk(full);
          else total += stat.size;
        }
      };
      const plafond = PLAFOND[skill] ?? 0;
      walk(join(SKILLS, skill));
      expect({ skill, plafond, sousBudget: total <= plafond }).toEqual({
        skill,
        plafond,
        sousBudget: true,
      });
    }
  });
});
