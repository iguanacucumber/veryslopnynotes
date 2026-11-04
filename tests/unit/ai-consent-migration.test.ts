// Migration du consentement IA (#860) : la version enregistrée décide seule.
// Un accord d'une autre version, un enregistrement illisible ou une décision
// refusée ne vaut JAMAIS accord ; accepter la version courante est le seul
// chemin qui réactive l'IA. Le Kotlin PUR est exécuté par la parité, et les
// mêmes règles sont vérifiées côté web pour que l'écran redemande l'accord.
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

async function roundtrip(decision: string, version?: number, allowError = false): Promise<any> {
  const op = version === undefined ? { op: "roundtrip", decision } : { op: "roundtrip", decision, version };
  return ask(op, allowError);
}

describe("consentement IA — migration de version (#860)", () => {
  test("la version courante est la seule qui autorise l'IA", async () => {
    const current = await roundtrip("granted");
    expect(current).toEqual({
      encoded: `granted:${AI_CONSENT_VERSION}`,
      decision: "granted",
      version: AI_CONSENT_VERSION,
      allowsAi: true,
      needsReconsent: false,
    });
    expect(aiConsentGranted("granted", AI_CONSENT_VERSION)).toBe(true);
    expect(aiConsentNeedsReconsent("granted", AI_CONSENT_VERSION)).toBe(false);
  });

  test("un ancien accord redemande l'accord et reste inactif jusqu'à l'acceptation", async () => {
    // Version antérieure (0 = enregistrement hérité) et version inconnue :
    // la décision se relit, mais aucun appel IA n'est possible.
    for (const version of [0, AI_CONSENT_VERSION - 1, AI_CONSENT_VERSION + 1, 999]) {
      const stale = await parse(`granted:${version}`);
      expect({ version, allowsAi: stale.allowsAi }).toEqual({ version, allowsAi: false });
      expect({ version, needsReconsent: stale.needsReconsent }).toEqual({
        version,
        needsReconsent: version !== AI_CONSENT_VERSION,
      });
      expect(aiConsentGranted(stale.decision, stale.version)).toBe(false);
      expect(aiConsentNeedsReconsent(stale.decision, stale.version)).toBe(
        version !== AI_CONSENT_VERSION,
      );
    }

    // Refuser ne réutilise pas l'ancien accord ; accepter la version courante
    // est le seul geste qui le remplace.
    const refused = await roundtrip("refused");
    expect(refused).toMatchObject({
      decision: "refused",
      version: AI_CONSENT_VERSION,
      allowsAi: false,
      needsReconsent: false,
    });
    expect(aiConsentGranted(refused.decision, refused.version)).toBe(false);

    const accepted = await roundtrip("granted");
    expect(accepted).toMatchObject({
      decision: "granted",
      version: AI_CONSENT_VERSION,
      allowsAi: true,
    });
  });

  test("un enregistrement mal formé est traité comme absent, jamais comme accord", async () => {
    for (const raw of ["", "granted", ":1", "granted:", "peut-être:1", "none:1", "granted:abc", "granted:1:2"]) {
      const parsed = await parse(raw);
      expect({ raw, decision: parsed.decision, version: parsed.version, allowsAi: parsed.allowsAi }).toEqual({
        raw,
        decision: "none",
        version: 0,
        allowsAi: false,
      });
      expect(aiConsentGranted(parsed.decision, parsed.version)).toBe(false);
      expect(aiConsentNeedsReconsent(parsed.decision, parsed.version)).toBe(false);
    }

    // Champ absent : même verdict que la chaîne vide.
    const missing = await ask({ op: "parse" });
    expect(missing).toMatchObject({ decision: "none", version: 0, allowsAi: false });
  });

  test("un refus ou un retrait garde l'IA désactivée, y compris après un ancien accord", async () => {
    expect((await parse(`granted:${AI_CONSENT_VERSION + 1}`)).allowsAi).toBe(false);
    for (const decision of ["refused", "withdrawn"] as const) {
      const out = await roundtrip(decision);
      expect(out).toMatchObject({ decision, version: AI_CONSENT_VERSION, allowsAi: false });
      expect(aiConsentGranted(out.decision, out.version)).toBe(false);
      expect(aiConsentNeedsReconsent(out.decision, out.version)).toBe(false);
    }
  });

  test("aucune version invalide n'est écrite", async () => {
    for (const version of [0, -1]) {
      const out = await roundtrip("granted", version, true);
      expect(out).toMatchObject({ error: "IllegalArgumentException", decision: "granted" });
    }
  });
});
