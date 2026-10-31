// Deux validations confondaient « invalide » et « vide » : une source mal formée
// devenait une liste vide validée, et un contrat de capabilities invalide masquait
// toute la navigation. Fail-closed : refus ou `null`, jamais une liste vide.
// Les VRAIES sources sont compilées et pilotées ; outillage absent = SKIP BRUYANT.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { payloadsSource } from "./fixtures/payload-sources";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CoreValidationParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface HumanizeResult {
  ok?: boolean;
  answer?: string;
  sources?: string[];
  error?: string;
  message?: string;
}

interface CapabilitiesResult {
  caps: { accountId: string; tabs: string[]; fetchedAt: string } | null;
  disabled: string[];
}

async function validate(answerKey: unknown): Promise<HumanizeResult> {
  return JSON.parse(
    await link!.ask({ op: "humanize", answerKey: JSON.stringify(answerKey) }, { allowError: true }),
  ) as HumanizeResult;
}

async function askDriver(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op, { allowError: true }));
}

async function probe(
  accountId: string,
  tabs: Record<string, boolean>,
  at: string,
): Promise<CapabilitiesResult> {
  return JSON.parse(
    await link!.ask({ op: "capabilities", accountId, probe: tabs, at }, { allowError: true }),
  ) as CapabilitiesResult;
}

const AT = "2026-10-19T18:04:05.123+02:00";

describe("validation du corrigé (#413) — un `sources` mal formé est REFUSÉ", () => {
  test.skipIf(skip)("`sources: \"abc\"` est refusé, pas transformé en liste vide", async () => {
    const r = await validate({ answer: "Une réponse", sources: "abc" });
    expect(r.ok).toBeUndefined();
    expect(r.error).toBe("AiError");
    expect(r.message).toContain("sources");
    // La source invalide ne doit JAMAIS ressembler à « aucune source ».
    expect(r.sources).toBeUndefined();
  });

  test.skipIf(skip)("toute source mal formée est refusée (objet, nombre, null)", async () => {
    for (const sources of [{}, 42, true, null, ["ok", 12]]) {
      const r = await validate({ answer: "Une réponse", sources });
      expect({ sources, error: r.error }).toEqual({ sources, error: "AiError" });
      expect(r.sources).toBeUndefined();
    }
  });

  test.skipIf(skip)("un champ `sources` ABSENT reste autorisé (corpus vide)", async () => {
    const r = await validate({ answer: "Une réponse" });
    expect(r.ok).toBe(true);
    expect(r.sources).toEqual([]);
    expect(r.answer).toBe("Une réponse");
  });

  test.skipIf(skip)("une liste `sources: []` reste autorisée (corpus vide)", async () => {
    const r = await validate({ answer: "Une réponse", sources: [] });
    expect(r.ok).toBe(true);
    expect(r.sources).toEqual([]);
  });

  test.skipIf(skip)("une liste de sources VALIDES passe (inchangé)", async () => {
    const r = await validate({ answer: "Une réponse", sources: ["Cours 1", " Cours 2 "] });
    expect(r.ok).toBe(true);
    expect(r.sources).toEqual(["Cours 1", "Cours 2"]);
  });

  test.skipIf(skip)("les refus déjà en place tiennent (source vide, trop longue, trop de sources)", async () => {
    expect((await validate({ answer: "x", sources: [""] })).error).toBe("AiError");
    expect((await validate({ answer: "x", sources: ["s".repeat(501)] })).error).toBe("AiError");
    const many = Array.from({ length: 21 }, (_, i) => `source ${i}`);
    expect((await validate({ answer: "x", sources: many })).error).toBe("AiError");
  });
});

describe("capabilities (#413) — un contrat invalide vaut « inconnu », pas « tout désactivé »", () => {
  test.skipIf(skip)("un contrat VALIDE donne la liste des onglets observés", async () => {
    const r = await probe("e-1", { grades: true, news: true }, AT);
    expect(r.caps).not.toBeNull();
    expect(r.caps?.tabs).toEqual(["grades", "news"]);
    expect(r.caps?.accountId).toBe("e-1");
    // Les onglets non observés sont les seuls masqués.
    expect(r.disabled).toContain("homework");
    expect(r.disabled).not.toContain("grades");
  });

  test.skipIf(skip)("un compte VIDE n'affirme AUCUNE capacité (pas de liste vide)", async () => {
    const r = await probe("", { grades: true, news: true }, AT);
    // Le contrat invalide vaut `null`, JAMAIS une liste d'onglets vide.
    expect(r.caps).toBeNull();
    // Et donc RIEN n'est masqué : l'app garde tous les onglets.
    expect(r.disabled).toEqual([]);
  });

  test.skipIf(skip)("un compte trop long n'affirme AUCUNE capacité", async () => {
    const r = await probe("e".repeat(65), { grades: true }, AT);
    expect(r.caps).toBeNull();
    expect(r.disabled).toEqual([]);
  });

  test.skipIf(skip)("une date illisible n'affirme AUCUNE capacité", async () => {
    for (const at of ["", "pas une date", "19/10/2026"]) {
      const r = await probe("e-1", { grades: true }, at);
      expect({ at, caps: r.caps }).toEqual({ at, caps: null });
      expect(r.disabled).toEqual([]);
    }
  });

  test.skipIf(skip)("une observation VIDE reste un contrat AFFIRMÉ (tout désactivé)", async () => {
    // Un contrat valide qui n'affirme aucun onglet les désactive tous ; l'inconnu est `null`.
    const r = await probe("e-1", { grades: false, news: false }, AT);
    expect(r.caps).not.toBeNull();
    expect(r.caps?.tabs).toEqual([]);
    expect(r.disabled.length).toBeGreaterThan(0);
  });

  // La charge utile publie l'inconnu comme `capabilities: null`, jamais une liste vide.
  test("l'inconnu est publié comme `capabilities: null`, jamais `tabs: []`", () => {
    const src = payloadsSource();
    const start = src.indexOf("internal fun capabilitiesPayload");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("\n}", start));
    // Le contrat invalide (`fromProbe` → `null`) devient `JSONObject.NULL`.
    expect(block).toContain("?: JSONObject.NULL");
    // Et aucune liste d'onglets vide n'est publiée (elle=blackouterait).
    expect(block).not.toMatch(/put\(\s*"tabs"\s*,\s*JSONArray\(\s*emptyList\(\)/);
  });
});

describe("answer-key storage migration", () => {
  test.skipIf(skip)("new writes use homework:answer-key, not the old prefix", async () => {
    const first = await askDriver({ op: "saveAnswerKey", id: "hw-1", answerKey: JSON.stringify({ answer: "Une réponse" }) });
    expect(first.key).toBe("homework:answer-key:hw-1");
    // Re-saving an existing id must report THAT id, not the last inserted key.
    await askDriver({ op: "saveAnswerKey", id: "hw-9", answerKey: JSON.stringify({ answer: "Autre" }) });
    const again = await askDriver({ op: "saveAnswerKey", id: "hw-1", answerKey: JSON.stringify({ answer: "Encore" }) });
    expect(again.key).toBe("homework:answer-key:hw-1");
  });

  test.skipIf(skip)("legacy homework:corrige refs stay readable", async () => {
    await askDriver({ op: "seedLegacyAnswerKey", id: "hw-2" });
    const r = await askDriver({ op: "loadAnswerKey", id: "hw-2" });
    expect(r.found).toBe(true);
    expect(r.text).toContain("legacy rendered");
  });
});
