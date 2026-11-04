// PRV-05 (#849) : l'IA exige une attestation d'âge ou d'autorisation
// parentale, visible et explicite, AVANT l'accord et la clé. Le test rend la
// case réellement affichée et vérifie les gardes de l'écran et du pont.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AI_AGE_ATTESTATION_REQUIRED,
  AI_CONSENT_VERSION,
  aiConsentGranted,
  aiConsentNeedsReconsent,
} from "../../web/src/features/assistant/consent";
import { AgeAttestation } from "../../web/src/features/settings/AgeAttestation";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

function render(checked: boolean, error = ""): string {
  return renderToStaticMarkup(
    createElement(AgeAttestation, { checked, error, onChange: () => undefined }),
  );
}

describe("assistant IA — attestation d'âge ou d'autorisation parentale (#849)", () => {
  test("un accord sans attestation n'autorise pas l'IA", () => {
    expect(aiConsentGranted("granted", AI_CONSENT_VERSION, false)).toBe(false);
    expect(aiConsentGranted("granted", AI_CONSENT_VERSION, true)).toBe(true);
    expect(aiConsentGranted("refused", AI_CONSENT_VERSION, true)).toBe(false);
    expect(aiConsentGranted("withdrawn", AI_CONSENT_VERSION, true)).toBe(false);
    expect(aiConsentNeedsReconsent("granted", AI_CONSENT_VERSION, false)).toBe(true);
    expect(aiConsentNeedsReconsent("granted", AI_CONSENT_VERSION, true)).toBe(false);
  });

  test("la copie rendue nomme 18 ans, le représentant légal et OpenRouter", () => {
    const html = render(false);
    expect(html).toContain("18 ans");
    expect(html).toContain("représentant légal");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("ne vérifie pas ton âge");
    expect(html).toContain("pas encore fait l’objet d’une validation juridique");
    // Jamais une promesse d'approbation juridique.
    expect(html).not.toMatch(/approuv|conforme|validé juridiquement/i);
  });

  test("la case est étiquetée, décrite, requise et décochée par défaut", () => {
    const html = render(false);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('id="ai-age-attestation"');
    expect(html).toContain('for="ai-age-attestation"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-describedby="ai-age-attestation-help"');
    expect(html).toContain('id="ai-age-attestation-help"');
    expect(html).not.toContain("checked");
  });

  test("une erreur décrit la case et s'annonce", () => {
    const html = render(false, AI_AGE_ATTESTATION_REQUIRED);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("ai-age-attestation-error");
    expect(html).toContain("Coche l’attestation");
    expect(html).toContain('role="alert"');
  });

  test("l'écran ne sauvegarde pas la clé et n'accepte pas sans attestation", () => {
    const card = source("features/settings/AssistantCards.tsx");
    expect(card).toContain("<AgeAttestation");
    expect(card).toContain("ageAttested");
    expect(card).toContain("!attestationChecked");
    expect(card).toContain('decision === "granted" && attestationChecked');
    expect(card.indexOf("<AgeAttestation")).toBeLessThan(card.indexOf('id="llm-key"'));

    const client = source("bridge/client.ts");
    expect(client).toContain('call<AiConsentResult>("llm.setConsent", { decision, ageAttested })');

    // Le natif refuse l'accord sans attestation avant d'écrire le moindre état.
    const bridge = readFileSync(
      join(
        WEB,
        "..",
        "..",
        "android",
        "app",
        "src",
        "main",
        "java",
        "fr",
        "veryslopnynotes",
        "app",
        "VsnBridgeSettings.kt",
      ),
      "utf8",
    );
    const guard = bridge.indexOf("AI_AGE_ATTESTATION_REQUIRED_MESSAGE");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(bridge.indexOf("aiConsent.decide("));
  });
});
