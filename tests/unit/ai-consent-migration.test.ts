// Migration du consentement IA (#860) et de l'attestation d'âge (#849) : la
// version ET l'attestation enregistrées décident seules. Un accord d'une autre
// version, sans attestation, illisible ou refusé ne vaut JAMAIS accord ;
// accepter la version courante AVEC l'attestation est le seul chemin qui
// réactive l'IA. Le Kotlin PUR est exécuté par la parité, et les mêmes règles
// sont vérifiées côté web pour que l'écran redemande l'accord.
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  AI_CONSENT_VERSION,
  aiConsentGranted,
  aiConsentNeedsReconsent,
} from "../../web/src/features/assistant/consent";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "AiConsentMain.kt");
const skip = parityToolchain.skipReason !== null;

let consentLink: ParityLink | null = null;
if (!skip) consentLink = await parityToolchain.openParityLink(DRIVER);

afterAll(() => {
  consentLink?.close();
});

async function ask(op: unknown, allowError = false): Promise<any> {
  return JSON.parse(await consentLink!.ask(op, { allowError }));
}

async function parse(raw: string | null): Promise<any> {
  return ask({ op: "parse", raw });
}

async function roundtrip(
  decision: string,
  version?: number,
  ageAttested = false,
  allowError = false,
): Promise<any> {
  const op = { op: "roundtrip", decision, ageAttested } as Record<string, unknown>;
  if (version !== undefined) op.version = version;
  return ask(op, allowError);
}

describe("consentement IA — version et attestation (#860, #849)", () => {
  test("la version courante et l'attestation sont les deux seules conditions", async () => {
    const current = await roundtrip("granted", AI_CONSENT_VERSION, true);
    expect(current).toEqual({
      encoded: `granted:${AI_CONSENT_VERSION}:attested`,
      decision: "granted",
      version: AI_CONSENT_VERSION,
      allowsAi: true,
      needsReconsent: false,
      ageAttested: true,
    });
    expect(aiConsentGranted("granted", AI_CONSENT_VERSION, true)).toBe(true);
    expect(aiConsentNeedsReconsent("granted", AI_CONSENT_VERSION, true)).toBe(false);
    expect(aiConsentGranted("granted", AI_CONSENT_VERSION, false)).toBe(false);
    expect(aiConsentNeedsReconsent("granted", AI_CONSENT_VERSION, false)).toBe(true);
  });

  test("un accord sans attestation ne s'écrit pas et n'autorise rien", async () => {
    const refusedWrite = await roundtrip("granted", AI_CONSENT_VERSION, false, true);
    expect(refusedWrite).toMatchObject({ error: "IllegalArgumentException", decision: "granted" });

    // Un enregistrement forgé, bien formé mais sans attestation, reste inactif.
    const forged = await parse(`granted:${AI_CONSENT_VERSION}:none`);
    expect(forged).toMatchObject({
      decision: "granted",
      version: AI_CONSENT_VERSION,
      ageAttested: false,
      allowsAi: false,
      needsReconsent: true,
    });
    expect(aiConsentGranted(forged.decision, forged.version, forged.ageAttested)).toBe(false);
    expect(aiConsentNeedsReconsent(forged.decision, forged.version, forged.ageAttested)).toBe(true);
  });

  test("un ancien accord, avec ou sans attestation, redemande l'accord", async () => {
    // Version antérieure, ancien format à deux champs : lisible, jamais actif.
    for (const raw of [
      `granted:${AI_CONSENT_VERSION - 1}`,
      `granted:${AI_CONSENT_VERSION - 1}:attested`,
      `granted:${AI_CONSENT_VERSION + 1}:attested`,
      "granted:999:attested",
    ]) {
      const stale = await parse(raw);
      expect({ raw, decision: stale.decision, allowsAi: stale.allowsAi }).toEqual({
        raw,
        decision: "granted",
        allowsAi: false,
      });
      expect({ raw, needsReconsent: stale.needsReconsent }).toEqual({ raw, needsReconsent: true });
      expect(aiConsentGranted(stale.decision, stale.version, stale.ageAttested)).toBe(false);
      expect(aiConsentNeedsReconsent(stale.decision, stale.version, stale.ageAttested)).toBe(true);
    }

    // Refuser ne réutilise pas l'ancien accord ; accepter la version courante
    // avec l'attestation est le seul geste qui le remplace.
    const refused = await roundtrip("refused");
    expect(refused).toMatchObject({
      decision: "refused",
      version: AI_CONSENT_VERSION,
      ageAttested: false,
      allowsAi: false,
      needsReconsent: false,
    });
    expect(aiConsentGranted(refused.decision, refused.version, refused.ageAttested)).toBe(false);

    const accepted = await roundtrip("granted", AI_CONSENT_VERSION, true);
    expect(accepted).toMatchObject({
      decision: "granted",
      version: AI_CONSENT_VERSION,
      ageAttested: true,
      allowsAi: true,
    });
  });

  test("un enregistrement mal formé est traité comme absent, jamais comme accord", async () => {
    for (const raw of [
      "",
      "granted",
      ":1",
      "granted:",
      "peut-être:1",
      "none:1",
      "granted:abc",
      "granted:0:attested",
      "granted:-1:attested",
      "granted:1:2",
      "granted:2:maybe",
      "granted:2:attested:extra",
    ]) {
      const parsed = await parse(raw);
      expect({ raw, decision: parsed.decision, version: parsed.version, allowsAi: parsed.allowsAi }).toEqual({
        raw,
        decision: "none",
        version: 0,
        allowsAi: false,
      });
      expect(aiConsentGranted(parsed.decision, parsed.version, parsed.ageAttested)).toBe(false);
      expect(aiConsentNeedsReconsent(parsed.decision, parsed.version, parsed.ageAttested)).toBe(false);
    }

    // Champ absent : même verdict que la chaîne vide.
    const missing = await ask({ op: "parse" });
    expect(missing).toMatchObject({ decision: "none", version: 0, allowsAi: false, ageAttested: false });
  });

  test("un refus ou un retrait garde l'IA désactivée, y compris après un ancien accord", async () => {
    expect((await parse(`granted:${AI_CONSENT_VERSION + 1}:attested`)).allowsAi).toBe(false);
    for (const decision of ["refused", "withdrawn"] as const) {
      const out = await roundtrip(decision, AI_CONSENT_VERSION, true);
      expect(out).toMatchObject({
        decision,
        version: AI_CONSENT_VERSION,
        ageAttested: false,
        allowsAi: false,
      });
      expect(aiConsentGranted(out.decision, out.version, out.ageAttested)).toBe(false);
      expect(aiConsentNeedsReconsent(out.decision, out.version, out.ageAttested)).toBe(false);
    }
  });

  test("aucune version invalide n'est écrite", async () => {
    for (const version of [0, -1]) {
      const out = await roundtrip("granted", version, true, true);
      expect(out).toMatchObject({ error: "IllegalArgumentException", decision: "granted" });
    }
  });
});
