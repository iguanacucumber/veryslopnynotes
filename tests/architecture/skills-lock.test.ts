// Le contenu vendorisé (`.agents/`) est contrôlé par une empreinte recalculable :
// sha256 de l'ARBRE de chaque skill (chemins relatifs triés + contenu), comparé
// à une table ci-dessous. Une édition manuelle d'une skill vendorisée échoue le
// test. Une mise à jour (`npx skills update`) le fait échouer aussi : la table
// est alors mise à jour dans la MÊME PR que le lock amont — le changement tiers
// devient VISIBLE dans la PR, au lieu d'être silencieux.
//
// La provenance du lock (`source`, `sourceType`, `skillPath`, `computedHash`)
// n'est PAS vérifiée ici : le hash amont n'est pas recalculable (algorithme de
// `npx skills` non documenté), et recopier ces champs dans le test ne prouverait
// rien de plus que le fichier est égal à sa propre copie. Vérifier la provenance
// demanderait d'interroger l'amont (réseau), hors du gate. Le test vérifie
// seulement que le lock et le disque portent les MÊMES skills.
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
 * Empreintes attendues des skills vendorisées, par nom de dossier.
 *
 * À mettre à jour SEULEMENT avec le lock amont (`npx skills update`), dans la
 * même PR : la PR montre alors le contenu tiers qui change.
 */
const ATTENDU: Record<string, string> = {
  "code-review": "5c784252646f78647d682f1ed3a2f0a87e836723869d07b2587ef52d6fec6a91",
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
    // Une skill éditée, ajoutée ou retirée sur le disque casse l'égalité.
    expect(vues).toEqual(ATTENDU);
  });

  test("le lock amont et le dépôt vendorisé portent les MÊMES skills", () => {
    expect(Object.keys(LOCK.skills).sort()).toEqual(readdirSync(SKILLS).sort());
  });

  test("une skill vendorisée reste petite", () => {
    // Un `npx skills add <source>` sans `@skill` a déjà ramené 3,3 Mo de
    // collection (#718). Son arbre part en contexte dès l'invocation : le
    // plafond rend l'ajout visible dans le diff au lieu de la facture.
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
      walk(join(SKILLS, skill));
      expect({ skill, sousBudget: total <= 24_576 }).toEqual({ skill, sousBudget: true });
    }
  });
});
