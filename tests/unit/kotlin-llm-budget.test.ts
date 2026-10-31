// Le plafond de TOKENS et le plafond de CARACTÈRES (garde I5) doivent tenir
// ensemble : sinon une réponse valide est payée puis jetée.
// `core/LlmGuard.kt`, `Homework.kt` et `HomeworkAi.kt` sont EXÉCUTÉS via le
// harnais ; seul le câblage de `data` se lit dans sa source (org.json).
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
    // Le budget de tokens vient de la garde.
    expect(b.maxOutputTokens).toBe(Math.floor(b.maxOutputChars / b.charsPerToken));
    // L'arrondi se fait EN BAS : le budget ne peut pas dépasser la garde.
    expect(b.maxOutputTokens * b.charsPerToken).toBeLessThanOrEqual(b.maxOutputChars);
    // La sortie du fournisseur tient dans la garde.
    expect(b.maxOutputTokens * b.charsPerToken).toBeGreaterThanOrEqual(
      b.maxOutputChars - b.charsPerToken,
    );
    // ~3 caractères/token en français, 4 pour le texte dense.
    expect(b.charsPerToken).toBeGreaterThanOrEqual(3);
    expect(b.charsPerToken).toBeLessThanOrEqual(4);
  });

  test.skipIf(skip)("le corrigé maximal est atteignable, pas mort-né", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    // Corrigé + enveloppe JSON tiennent dans la garde, sinon la borne est inatteignable.
    expect(b.maxAnswerChars + b.envelopeReserveChars).toBe(b.maxOutputChars);
    // La borne Kotlin reste celle du contrat partagé : pas de dérive possible.
    expect(b.maxAnswerChars).toBe(HOMEWORK_MAX_ANSWER_CHARS);
  });
});

describe("la garde de sortie : la limite RÉELLE (#411)", () => {
  test.skipIf(skip)("une réponse de 9 000 caractères est ACCEPTÉE", async () => {
    // 9 000 caractères, `finish_reason=stop` : réponse VALIDE, plus jetée par la garde.
    const r = await ask({ op: "output", text: texte(9_000) });
    expect(r.ok).toBe(true);
    expect(r.chars).toBe(9_000);
  });

  test.skipIf(skip)("une sortie trop longue est refusée en nommant la limite", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    const r = await ask({ op: "output", text: texte(b.maxOutputChars + 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("OutputTooLongException");
    // Le message dit la VRAIE limite, pas un « I5 » muet.
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
    expect(raw.length).toBeLessThanOrEqual(b.maxOutputChars);
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
    // Pas un « schéma invalide » trompeur : la limite du corrigé est nommée.
    expect(r.error).toBe("OutputTooLongException");
    expect(r.message).toContain(String(b.maxAnswerChars));
  });

  test.skipIf(skip)("un JSON trop long est refusé par la garde, avant le schéma", async () => {
    const b = (await ask({ op: "budget" })) as unknown as Budget;
    // C'est la GARDE qui refuse (longueur totale), et elle dit la limite de sortie.
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
    // Aucune copie locale : une constante dupliquée dérive en silence.
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
    // Une réponse trop longue ne doit pas lire « hors format ».
    expect(data).toContain("catch (e: OutputTooLongException)");
    expect(data.indexOf("catch (e: OutputTooLongException)")).toBeLessThan(
      data.indexOf("catch (_: AiError)"),
    );
    const bridge = codeOnly(readBridgeSource());
    expect(bridge).toContain("catch (e: OutputTooLongException)");
  });
});

// Recette LIVE du chemin IA : le prompt ne doit pas fabriquer une fausse citation
// (`Source : …`), et le raisonnement ne doit pas consommer les tokens de sortie.

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
    // Aucun préfixe qui ressemble à une citation : le modèle le recopiait.
    expect(body).not.toMatch(/Source\s*:\s*Consigne/);
    expect(body).not.toMatch(/Source\s*:/);
    // La question reste une DONNÉE distincte (elle n'est pas citable).
    expect(body).toContain("Question eleve (DONNEE) :");
  });

  test.skipIf(skip)("une citation préfixée reste rejetée (le validateur n'a pas bougé)", async () => {
    // Le correctif est dans le PROMPT : une réponse qui invente `Source : Consigne` reste jetée.
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

describe("les deux consignes devoirs portent la règle de citation (#701)", () => {
  // Sans la règle partagée, le modèle citait les blocs DONNEE eux-mêmes
  // (« Question eleve (DONNEE) », « Photo de l'énoncé ci-jointe ») : la liste
  // fermée les refusait et jetait une réponse valide.
  const RULE = "Seuls les blocs precedes de « Libelle citable : » sont des sources";

  test.skipIf(skip)("texte et photo reçoivent la MÊME règle (constante partagée)", async () => {
    const r = (await ask({ op: "homeworkSystem" })) as unknown as { text: string; photo: string };
    for (const system of [r.text, r.photo]) {
      expect(system).toContain(RULE);
      expect(system).toContain("Ne fabrique jamais une source.");
      // La règle n'est écrite qu'une fois : c'est la constante, pas un copie.
      expect(system.split(RULE).length - 1).toBe(1);
    }
  });

  test.skipIf(skip)("« Procéder quand même » interdit le refus et la source inventée", async () => {
    const r = (await ask({ op: "homeworkSystem" })) as unknown as { proceed: string };
    expect(r.proceed).toContain("demande explicitement une reponse meme si des documents manquent");
    expect(r.proceed).toContain("Ne reponds JAMAIS refused");
    expect(r.proceed).toContain("Ne fabrique jamais une source");
    expect(r.proceed).toContain(RULE);
  });
});

describe("le raisonnement ne mange plus le budget de sortie (#604)", () => {
  const data = codeOnly(readFileSync(join(DATA, "OpenRouterLlm.kt"), "utf8"));

  test("les DEUX chemins (texte et vision) désactivent le raisonnement", () => {
    // Un `reasoning` par requête, après `max_tokens` dans le même corps.
    const paired = [...data.matchAll(/\.put\("max_tokens", MAX_OUTPUT_TOKENS\)[\s\S]{0,600}?\.put\("reasoning", JSONObject\(\)\.put\("enabled", false\)\)/g)];
    expect(paired.length).toBe(2);
    // Aucun autre endroit n'active le raisonnement.
    expect(data).not.toMatch(/"enabled", true/);
  });

  test("l'analyse ne se fie pas au raisonnement pour produire la réponse", () => {
    // Une réponse vide ou tronquée reste une ERREUR nommée, jamais un succès.
    // Les messages vivent dans la règle PURE de complétion (`LlmCompletion.kt`),
    // pas dans le client : c'est elle qu'il faut lire.
    const completion = codeOnly(readFileSync(join(DATA, "LlmCompletion.kt"), "utf8"));
    expect(completion).toContain("Réponse LLM tronquée");
    expect(completion).toContain("Réponse LLM vide.");
  });

  test("les DEUX payloads imposent une sortie JSON au fournisseur (#708)", () => {
    // Sans ce champ, le modèle rendait un backslash LaTeX ou deux objets concaténés.
    const forced = [...data.matchAll(/\.put\("response_format", JSONObject\(\)\.put\("type", "json_object"\)\)/g)];
    expect(forced.length).toBe(2);
    // Le champ suit la coupure du raisonnement dans le même corps.
    const ordered = [...data.matchAll(/\.put\("reasoning", JSONObject\(\)\.put\("enabled", false\)\)[\s\S]{0,300}?\.put\("response_format"/g)];
    expect(ordered.length).toBe(2);
  });
});
