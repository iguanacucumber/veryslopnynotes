// #411 : le plafond de TOKENS et le plafond de CARACTÈRES doivent tenir
// ensemble.
//
// LE DÉFAUT. `data/OpenRouterLlm.kt` demandait `max_tokens = 4000` en
// justifiant « ~2 caractères/token » — une hypothèse FAUSSE pour le français
// et le JSON (~3-4 caractères/token). Le fournisseur produisait donc ~12-16 k
// caractères pour une garde I5 à 8 000 : une réponse VALIDE de 9 000
// caractères (`finish_reason=stop`) était payée au fournisseur puis JETÉE par
// `validateTextOutput` (« sortie LLM trop longue (I5) »), et l'élève lisait
// « Échec de l'assistant. ». Les deux plafonds étaient incohérents : le
// budget de tokens était INATTEIGNABLE sans dépasser le budget de caractères.
//
// CE QUI EST TESTÉ ICI, sur du VRAI Kotlin exécuté : `core/LlmGuard.kt`
// (la garde), `core/Homework.kt` (le corrigé) et `core/HomeworkAi.kt` (le
// schéma) sont compilés par le harnais puis pilotés par
// `agents/runtime/kotlin-parity/LlmBudgetMain.kt`. Aucune assertion ne repose
// sur un miroir TypeScript — sauf le câblage du module `data`, qui se lit
// dans sa source (le module tire `org.json` : il ne compile pas hors Gradle).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { HOMEWORK_MAX_ANSWER_CHARS } from "../../shared/contracts/api";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LlmBudgetMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Budget {
  maxOutputChars: number;
  charsPerToken: number;
  maxOutputTokens: number;
  maxAnswerChars: number;
  envelopeReserveChars: number;
}

interface Verdict {
  ok?: boolean;
  chars?: number;
  status?: string;
  answerChars?: number;
  steps?: number;
  sources?: number;
  error?: string;
  message?: string;
}

async function ask(op: unknown): Promise<Verdict> {
  return JSON.parse(await link!.ask(op, { allowError: true })) as Verdict;
}

/** Un texte français plausible, sans forme de secret et sans `:` en ligne. */
const PHRASE = "La derivee de x^2 vaut 2x, donc f(3) egale 6. ";

/** Un texte de `n` caractères (une phrase française répétée, puis coupée). */
function texte(n: number): string {
  return PHRASE.repeat(Math.ceil(n / PHRASE.length)).slice(0, n);
}

/** Le JSON du fournisseur pour un corrigé de `n` caractères. */
function homeworkJson(answer: string): string {
  return JSON.stringify({
    status: "ok",
    answer,
    steps: ["On derivee la fonction", "On evalue en 3"],
    sources: ["Consigne"],
  });
}

describe("plafond de sortie I5 : tokens et caractères tiennent ensemble (#411)", () => {
  test.skipIf(skip)("le budget de tokens est DÉDUIT du plafond de caractères", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    // La règle, en une ligne : le budget de tokens vient de la garde.
    expect(b.maxOutputTokens).toBe(Math.floor(b.maxOutputChars / b.charsPerToken));
    // Et l'arrondi se fait EN BAS : le budget ne peut pas dépasser la garde.
    expect(b.maxOutputTokens * b.charsPerToken).toBeLessThanOrEqual(b.maxOutputChars);
    // La sortie que le fournisseur peut produire tient donc dans la garde :
    // plus de réponse valide jetée pour cause de longueur.
    expect(b.maxOutputTokens * b.charsPerToken).toBeGreaterThanOrEqual(
      b.maxOutputChars - b.charsPerToken,
    );
    // Un ratio realistic : ~3 caractères/token en français, 4 pour le texte dense.
    expect(b.charsPerToken).toBeGreaterThanOrEqual(3);
    expect(b.charsPerToken).toBeLessThanOrEqual(4);
  });

  test.skipIf(skip)("le corrigé maximal est atteignable, pas mort-né", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    // Le corrigé + son enveloppe JSON doivent tenir dans la garde : sinon la
    // borne serait inatteignable PAR CONSTRUCTION (le défaut de #411).
    expect(b.maxAnswerChars + b.envelopeReserveChars).toBe(b.maxOutputChars);
    // Et la borne Kotlin reste celle du contrat partagé (miroir TS) : les deux
    // ne peuvent pas dériver l'une de l'autre.
    expect(b.maxAnswerChars).toBe(HOMEWORK_MAX_ANSWER_CHARS);
  });
});

describe("la garde de sortie : la limite RÉELLE (#411)", () => {
  test.skipIf(skip)("une réponse de 9 000 caractères est ACCEPTÉE", async () => {
    // Le cas de l'issue : 9 000 caractères, `finish_reason=stop`, réponse
    // VALIDE. Avant, `validateTextOutput` la jetait (« sortie LLM trop longue
    // (I5) ») et l'élève lisait « Échec de l'assistant. ».
    const r = await ask({ op: "output", text: texte(9_000) });
    expect(r.ok).toBe(true);
    expect(r.chars).toBe(9_000);
  });

  test.skipIf(skip)("une sortie trop longue est refusée en nommant la limite", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    const r = await ask({ op: "output", text: texte(b.maxOutputChars + 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("OutputTooLongException");
    // Le message dit la VRAIE limite (pas un « I5 » muet) : l'élève sait
    // où est la borne.
    expect(r.message).toContain(String(b.maxOutputChars));
    expect(r.message).toContain("I5");
  });
});

describe("la chaîne complète : JSON du fournisseur → garde → schéma (#411)", () => {
  test.skipIf(skip)("un corrigé MAXIMAL est accepté (il reste productible)", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    const answer = texte(b.maxAnswerChars);
    expect(answer.length).toBe(b.maxAnswerChars);
    const raw = homeworkJson(answer);
    // L'enveloppe JSON + le corrigé tiennent dans la garde…
    expect(raw.length).toBeLessThanOrEqual(b.maxOutputChars);
    // …et le port accepte la réponse ENTIÈRE.
    const r = await ask({ op: "homework", raw, labels: ["Consigne"] });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ok");
    expect(r.answerChars).toBe(b.maxAnswerChars);
    expect(r.steps).toBe(2);
    expect(r.sources).toBe(1);
  });

  test.skipIf(skip)("un corrigé trop long est refusé en nommant SA limite", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    const raw = homeworkJson(texte(b.maxAnswerChars + 1));
    const r = await ask({ op: "homework", raw, labels: ["Consigne"] });
    expect(r.ok).toBe(false);
    // Pas un « schéma invalide » trompeur : la limite du corrigé, nommée.
    expect(r.error).toBe("OutputTooLongException");
    expect(r.message).toContain(String(b.maxAnswerChars));
  });

  test.skipIf(skip)("un JSON trop long est refusé par la garde, avant le schéma", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    // Un corrigé à sa borne + une enveloppe qui déborde : c'est la GARDE
    // qui refuse (longueur totale), et elle dit la limite de sortie.
    const raw = homeworkJson(texte(b.maxOutputChars));
    const r = await ask({ op: "homework", raw, labels: ["Consigne"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("OutputTooLongException");
    expect(r.message).toContain(String(b.maxOutputChars));
  });
});

describe("câblage : un seul endroit pour le budget (#411)", () => {
  const data = codeOnly(readFileSync(join(DATA, "OpenRouterLlm.kt"), "utf8"));
  const core = codeOnly(readFileSync(join(CORE, "LlmGuard.kt"), "utf8"));
  const homework = codeOnly(readFileSync(join(CORE, "Homework.kt"), "utf8"));

  test("le module data IMPORTE le budget du core, il ne le recopie pas", () => {
    expect(data).toContain("import fr.veryslopnynotes.core.MAX_OUTPUT_TOKENS");
    // Aucune copie locale : une constante dupliquée dériverait en silence.
    expect(data).not.toMatch(/const val MAX_OUTPUT_TOKENS\s*=/);
    // Et c'est bien ce budget qui part dans la requête.
    expect(data).toContain('.put("max_tokens", MAX_OUTPUT_TOKENS)');
  });

  test("le core déduit le budget et le corrigé de la garde", () => {
    expect(core).toMatch(/const val MAX_OUTPUT_TOKENS = MAX_OUTPUT_CHARS \/ CHARS_PER_TOKEN/);
    expect(core).toMatch(/const val CHARS_PER_TOKEN = \d+/);
    // Le corrigé : le plafond de sortie moins l'enveloppe JSON.
    expect(homework).toMatch(
      /const val MAX_ANSWER_CHARS = MAX_OUTPUT_CHARS - JSON_ENVELOPE_RESERVE_CHARS/,
    );
  });

  test("le refus nomme la limite, dans les deux chemins (devoirs et fiche)", () => {
    // L'élève ne doit pas lire « hors format » pour une réponse trop longue.
    expect(data).toContain("catch (e: OutputTooLongException)");
    expect(data.indexOf("catch (e: OutputTooLongException)")).toBeLessThan(
      data.indexOf("catch (_: AiError)"),
    );
    const bridge = codeOnly(readBridgeSource());
    expect(bridge).toContain("catch (e: OutputTooLongException)");
  });
});

// #604 — recette LIVE du chemin IA. Trois défauts vus sur de vrais appels
// (`nvidia/nemotron-3.5-lightning:free`, clé réelle), dont deux réparés ici.
//
// 1. Le bloc source s'appelait `Source : <libellé>`. La consigne exige que
//    chaque citation « reprenne exactement un libellé fourni » ; le modèle
//    recopiait donc `Source : Cours : chapitre 4`, et `parseHomeworkResponse`
//    jetait la réponse (« source non fournie »). Une citation fabriquée par le
//    prompt lui-même.
// 2. Le raisonnement du modèle consommait les 3 000 tokens
//    (`content=null`, `finish_reason=length`, 10 214 caractères de réflexion) :
//    l'élève lisait « Réponse LLM tronquée ».
//
// (3. le modèle vision livré répondait 429 en permanence : voir
// `android-llm-catalogue.test.ts`.)

describe("les libellés citables sont envoyés TELS QUELS (#604)", () => {
  const LABELS = ["Consigne", "Cours : Chapitre 4"];

  test.skipIf(skip)("le VRAI prompt porte le libellé brut, sans préfixe de citation", async () => {
    const r = (await ask({
      op: "homeworkData",
      question: "Résous 3x + 2 = 8.",
      labels: LABELS,
      texts: ["Résous et justifie.", "On isole x."],
    })) as unknown as { blocks: string[] };
    const body = r.blocks.join("\n\n");
    // Le libellé exact est là, une fois…
    for (const label of LABELS) {
      expect(body.split(label).length - 1).toBe(1);
      expect(body).toContain("Libelle citable : " + label);
    }
    // …et AUCUN préfixe qui ressemble à une citation : c'est ce que le modèle
    // recopiait, et ce que le validateur refusait ensuite.
    expect(body).not.toMatch(/Source\s*:\s*Consigne/);
    expect(body).not.toMatch(/Source\s*:/);
    // La question reste une DONNÉE distincte (elle n'est pas citable).
    expect(body).toContain("Question eleve (DONNEE) :");
  });

  test.skipIf(skip)("une citation préfixée reste rejetée (le validateur n'a pas bougé)", async () => {
    // Le correctif est dans le PROMPT, pas dans la validation : une réponse qui
    // invente `Source : Consigne` doit toujours être jetée.
    const raw = JSON.stringify({
      status: "ok",
      answer: "x = 2",
      steps: ["isoler"],
      sources: ["Source : Consigne"],
    });
    const r = await ask({ op: "homework", raw, labels: LABELS });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("source non fournie");
  });
});

describe("le raisonnement ne mange plus le budget de sortie (#604)", () => {
  const data = codeOnly(readFileSync(join(DATA, "OpenRouterLlm.kt"), "utf8"));

  test("les DEUX chemins (texte et vision) désactivent le raisonnement", () => {
    // Un `reasoning` par requête, et il SUIT `max_tokens` dans le même corps :
    // sinon le réglage pourrait vivre dans le mauvais payload.
    const paired = [...data.matchAll(/\.put\("max_tokens", MAX_OUTPUT_TOKENS\)[\s\S]{0,600}?\.put\("reasoning", JSONObject\(\)\.put\("enabled", false\)\)/g)];
    expect(paired.length).toBe(2);
    // Aucun autre endroit n'active le raisonnement.
    expect(data).not.toMatch(/"enabled", true/);
  });

  test("l'analyse ne se fie pas au raisonnement pour produire la réponse", () => {
    // Une réponse vide ou tronquée reste une ERREUR nommée, jamais un succès.
    expect(data).toContain("Réponse LLM tronquée");
    expect(data).toContain("Réponse LLM vide.");
  });
});
