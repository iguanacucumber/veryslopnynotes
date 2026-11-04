// Décision #829 : la règle d'éligibilité IA et sa copie ont une source écrite.
// Une promesse d'approbation juridique ou un retrait qui n'efface pas la clé
// rougit ici avant la PR.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_AGE_ATTESTATION, AI_AGE_ATTESTATION_DETAIL } from "../../web/src/features/assistant/consent";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/[>\s]+/g, " ");

const ADR = read("docs/adr/009-ai-eligibility.md");
const PRODUCT = read("docs/PRODUCT.md");
const PRIVACY = read("PRIVACY.md");
const TERMS = read("TERMS.md");

describe("ADR-009 — éligibilité de l'assistant IA (#829)", () => {
  test("l'ADR est accepté et ne revendique aucune validation juridique", () => {
    expect(ADR).toMatch(/^- Statut : accepté/m);
    expect(ADR).toMatch(/validation\s+juridique en attente/i);
    expect(ADR).not.toMatch(/approuvée? par un conseil|validé juridiquement|conforme au RGPD/i);
  });

  test("la décision exige consentement, attestation et clé, et désactive l'IA sinon", () => {
    expect(ADR).toMatch(/consentement explicite et versionné/i);
    expect(ADR).toMatch(/attestation d'âge ou d'autorisation parentale/i);
    expect(ADR).toMatch(/clé OpenRouter fournie par l'utilisateur/i);
    expect(ADR).toMatch(/aucune condition ne remplace les autres/i);
    expect(ADR).toMatch(/IA est désactivée|IA désactivée/i);
    expect(ADR).toMatch(/aucun appel/i);
    expect(ADR).toMatch(/champ de clé n'est pas exposé/i);
  });

  test("le retrait persiste avant d'effacer la clé et le fil", () => {
    expect(flat(ADR)).toMatch(/retrait persiste d'abord/i);
    expect(flat(ADR)).toMatch(/efface la clé OpenRouter et le fil du professeur/i);
    expect(flat(ADR)).toMatch(/échec d'effacement est signalé/i);
  });

  test("un changement matériel redemande l'accord et l'attestation", () => {
    expect(ADR).toMatch(/incrémente\s+la version/i);
    expect(ADR).toMatch(/redemande l'accord ET l'attestation/i);
  });

  test("la copie de l'ADR est celle rendue par l'écran", () => {
    expect(flat(ADR)).toContain(flat(AI_AGE_ATTESTATION));
    expect(flat(ADR)).toContain(flat(AI_AGE_ATTESTATION_DETAIL));
  });

  test("le point ouvert nomme l'arbitrage 18 ans stricts ou autorisation parentale", () => {
    expect(ADR).toMatch(/18 ans stricts/i);
    expect(ADR).toMatch(/autorisation parentale/i);
    expect(ADR).toMatch(/revue de conseil encore requise/i);
  });

  test("PRODUCT, PRIVACY et TERMS renvoient à l'ADR", () => {
    expect(PRODUCT).toContain("adr/009-ai-eligibility.md");
    expect(PRIVACY).toContain("docs/adr/009-ai-eligibility.md");
    expect(TERMS).toContain("docs/adr/009-ai-eligibility.md");
  });
});
