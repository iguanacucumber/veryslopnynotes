// DEC-03 (#828) : la custody ne se prouve pas depuis la CI. Ce test verrouille
// la DÉCISION écrite et sépare les faits vérifiables (workflow, protection de
// l'environnement) des engagements du détenteur (sauvegardes, coffre).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const SIGNING = read("docs/SIGNING.md");
const BRANCH_PROTECTION = read("docs/BRANCH-PROTECTION.md");
const RELEASE_WORKFLOW = read(".github/workflows/release.yml");

/** Corps d'une section `## …` jusqu'au prochain titre de même niveau. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`${heading}\n`);
  if (start === -1) return "";
  const end = md.indexOf("\n## ", start + heading.length + 1);
  return md.slice(start, end === -1 ? undefined : end);
}

const CUSTODY = section(SIGNING, "## Custody et sauvegarde (DEC-03, #828)");
const PROOF = section(SIGNING, "### Ce que la CI peut prouver, et ce qu'elle ne peut pas");

describe("custody de la clé de signature (DEC-03, #828)", () => {
  test("la section de décision nomme le détenteur et ses engagements", () => {
    expect(CUSTODY.length).toBeGreaterThan(0);
    expect(CUSTODY).toContain("iguanacucumber");
    expect(CUSTODY).toContain("hors ligne");
    expect(CUSTODY).toContain("deux copies chiffrées hors ligne");
    expect(CUSTODY).toContain("deux supports distincts");
    expect(CUSTODY).toContain("non consignés dans le dépôt");
    expect(CUSTODY).toContain("gestionnaire de mots de passe");
    expect(CUSTODY).toContain("séparé des supports");
  });

  test("l'environnement et la rotation sont écrits, pas seulement sous-entendus", () => {
    expect(CUSTODY).toContain("release");
    expect(CUSTODY).toContain("relecteur obligatoire");
    expect(CUSTODY).toContain("iguanacucumber");
    expect(CUSTODY).toContain("`v*`");
    expect(CUSTODY).toContain("rotation");
    expect(CUSTODY).toContain("réinstallation obligatoire");
    expect(CUSTODY).toContain("nouvelle empreinte");
  });

  test("le document distingue ce que la CI prouve de ce qu'elle ne peut pas prouver", () => {
    expect(PROOF).toContain("ne peut pas prouver");
    expect(PROOF).toContain("génération hors ligne");
    expect(PROOF).toContain("emplacement");
    expect(PROOF).toContain("gestionnaire de mots de passe");
    expect(PROOF).toContain("engagements du détenteur");
  });

  test("aucun emplacement, nom civil ou secret ne reste en placeholder", () => {
    expect(SIGNING).not.toMatch(/<détenteur|<lieu [AB]>|<registre privé/);
    expect(SIGNING).not.toMatch(/<[^>]*(?:password|passphrase|keystore)[^>]*>/i);
  });

  test("le workflow et la doc de protection décrivent le même environnement", () => {
    expect(RELEASE_WORKFLOW).toMatch(/^ {4}environment: release$/m);
    expect(BRANCH_PROTECTION).toMatch(/relecteur obligatoire/i);
    expect(BRANCH_PROTECTION).toContain("iguanacucumber");
    expect(BRANCH_PROTECTION).toContain("`v*`");
  });
});
