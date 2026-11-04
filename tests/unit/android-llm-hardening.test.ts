// Durcissement du client OpenRouter : ce que le gate doit tenir sans réseau.
//
// Quatre défauts d'un même appel :
//   1. Un modèle passé au constructeur pouvait être ARBITRAIRE : aucune
//      allowlist, donc la clé de l'élève payait un modèle non choisi.
//   2. L'enveloppe `choices` était lue en tolérant (`optJSONArray`,
//      `optJSONObject`) : un schéma inattendu devenait « vide » (I14).
//   3. Rien ne coupait un appel en vol : l'abandon du pont attendait le délai
//      réseau complet, et OkHttp relançait même l'appel annulé.
//   4. Un message d'erreur n'était borné QUE pour l'UI : `LlmError.message`
//      partait entier, retours à la ligne compris.
//
// Les RÈGLES (allowlist, schéma, bornage, retrait de clé) vivent dans des
// sources PURES (`LlmPolicy.kt`, `LlmCompletion.kt`, `LlmTransport.kt`) :
// ce test les COMPILE et les EXÉCUTE via
// `agents/runtime/kotlin-parity/LlmTransportParityMain.kt`, sans réseau. Le
// CÂBLAGE OkHttp/`org.json` reste un pin de source explicite et court.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

setDefaultTimeout(30_000);

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "LlmTransportParityMain.kt");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const LLM = join(DATA, "OpenRouterLlm.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) link = await parityToolchain.openParityLink(DRIVER);

interface ModelResult {
  allowed: boolean;
  message: string;
}

interface Constants {
  maxErrorChars: number;
  textModel: string;
  visionModel: string;
  allowedModels: string[];
}

interface EnvelopeResult {
  fault: string | null;
}

async function constants(): Promise<Constants> {
  return JSON.parse(await link!.ask({ op: "constants" })) as Constants;
}

async function model(id: string): Promise<ModelResult> {
  return JSON.parse(await link!.ask({ op: "model", model: id })) as ModelResult;
}

async function envelope(shape: Record<string, boolean | number>): Promise<EnvelopeResult> {
  return JSON.parse(await link!.ask({ op: "envelope", ...shape })) as EnvelopeResult;
}

async function redact(text: string, key: string): Promise<string> {
  const r = JSON.parse(await link!.ask({ op: "redact", text, key })) as { text: string };
  return r.text;
}

async function bounded(text: string, max?: number): Promise<string> {
  const r = JSON.parse(await link!.ask({ op: "bounded", text, max })) as { text: string };
  return r.text;
}

async function retry(bytes: number, consumed = false, cancelled = false): Promise<boolean> {
  const r = JSON.parse(await link!.ask({ op: "retry", bytes, consumed, cancelled })) as {
    allowed: boolean;
  };
  return r.allowed;
}

/** Forme ACCEPTÉE : `choices` non vide, message objet, champs texte ou nuls. */
const VALID_SHAPE = {
  choicesIsArray: true,
  choiceCount: 1,
  messageIsObject: true,
  finishReasonIsText: true,
  contentIsText: true,
};

describe("allowlist : modèle ÉPINGLÉ, aucun repli silencieux", () => {
  test.skipIf(skip)("les deux modèles livrés sont autorisés, et eux seuls", async () => {
    const c = await constants();
    expect(c.allowedModels).toEqual([c.textModel, c.visionModel].sort());
    expect((await model(c.textModel)).allowed).toBe(true);
    expect((await model(c.visionModel)).allowed).toBe(true);
    // La vision est PAYANTE : un modèle gratuit peut entraîner ou retenir.
    expect(c.visionModel).not.toContain(":free");
  });

  test.skipIf(skip)("un modèle inconnu, vide ou déguisé est REFUSÉ", async () => {
    const c = await constants();
    const refused = [
      "",
      " ",
      "openai/gpt-4o",
      "dots-studio/dots-3-note-preview:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      `${c.textModel} `,
      c.textModel.toUpperCase(),
      `${c.textModel}:free`,
      `${c.textModel}\n`,
    ];
    for (const id of refused) {
      expect({ id, allowed: (await model(id)).allowed }).toEqual({ id, allowed: false });
    }
  });

  test.skipIf(skip)("le refus est nommé, borné, sans identifiant ni secret", async () => {
    const c = await constants();
    const r = await model("openai/gpt-4o");
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.message.length).toBeLessThanOrEqual(c.maxErrorChars);
    expect(r.message).toContain("Modèle LLM non autorisé");
    expect(r.message).not.toContain("openai/gpt-4o");
    expect(r.message).not.toMatch(/https?:\/\//i);
    expect(r.message).not.toMatch(/sk-or|Bearer|Authorization/i);
  });

  // Le contrôle est dans le CONSTRUCTEUR : une instance ne peut pas exister
  // avec un modèle hors allowlist, même si l'appelant en fournit un.
  const src = codeOnly(readFileSync(LLM, "utf8"));
  const init = src.slice(src.indexOf("init {"), src.indexOf("fun cancel()"));

  test("le constructeur refuse un modèle hors allowlist, jamais un défaut", () => {
    expect(src).toMatch(/private val model: String = PINNED_TEXT_MODEL/);
    expect(src).toMatch(/private val visionModel: String = PINNED_VISION_MODEL/);
    expect(init).toMatch(/!isAllowedModel\(model\) \|\| !isAllowedModel\(visionModel\)/);
    expect(init).toContain("throw LlmError(MODEL_REFUSED_MESSAGE)");
    // Aucun repli : pas de `?:` ni de `takeIf` qui ramènerait au défaut.
    expect(init).not.toMatch(/\?:|takeIf/);
  });
});

describe("vision : payant, ZDR et repli explicite", () => {
  const src = codeOnly(readFileSync(LLM, "utf8"));
  const policy = codeOnly(readFileSync(join(DATA, "LlmPolicy.kt"), "utf8"));
  const vision = src.slice(
    src.indexOf("override fun generateVisionSafe"),
    src.indexOf("private fun send"),
  );

  test("la requête vision impose un endpoint ZDR sans collecte", () => {
    expect(vision).toContain('"provider"');
    expect(vision).toContain('.put("zdr", true)');
    expect(vision).toContain('.put("data_collection", "deny")');
    // Le modèle reste épinglé : aucune liste de modèles de repli.
    expect(vision).toContain('.put("model", visionModel)');
    expect(vision).not.toMatch(/\.put\("models"/);
  });

  test("un modèle vision retiré s'arrête, jamais un autre modèle", () => {
    expect(policy).toContain("const val VISION_MODEL_UNAVAILABLE_MESSAGE");
    expect(policy).toContain("aucun autre modèle n'a été appelé");
    expect(vision).toContain("if (e.isModelUnavailable) throw LlmError(VISION_MODEL_UNAVAILABLE_MESSAGE, 404)");
  });
});

describe("schéma de réponse : STRICT, jamais « vide » par tolérance", () => {
  test.skipIf(skip)("l'enveloppe conforme passe sans faute", async () => {
    expect((await envelope(VALID_SHAPE)).fault).toBeNull();
  });

  test.skipIf(skip)("choices absent/non-tableau/vide = illisible", async () => {
    for (const shape of [
      { choicesIsArray: false },
      { choiceCount: 0 },
      { choiceCount: -1 },
    ]) {
      expect({ shape, fault: (await envelope({ ...VALID_SHAPE, ...shape })).fault }).toEqual({
        shape,
        fault: "UNREADABLE",
      });
    }
  });

  test.skipIf(skip)("message non-objet, content non-texte ou finish_reason non-texte = illisible", async () => {
    for (const shape of [
      { messageIsObject: false },
      { contentIsText: false },
      { finishReasonIsText: false },
    ]) {
      expect({ shape, fault: (await envelope({ ...VALID_SHAPE, ...shape })).fault }).toEqual({
        shape,
        fault: "UNREADABLE",
      });
    }
  });

  const src = codeOnly(readFileSync(LLM, "utf8"));
  const parse = src.slice(src.indexOf("private fun parseCompletion"), src.indexOf("private fun isTextOrAbsent"));

  test("l'adaptateur valide le schéma AVANT d'interpréter le contenu", () => {
    // `optJSONArray`/`optJSONObject` masquaient un type inattendu : on lit brut.
    expect(parse).toContain("val choices = root.opt(\"choices\")");
    expect(parse).toContain("CompletionEnvelope(");
    expect(parse).toContain("readCompletionSchema(envelope)");
    expect(parse).toMatch(/readCompletionSchema\(envelope\)\?\.let \{ throw LlmError\(it\.message\) \}/);
    expect(parse).toContain("val content = contentRaw as? String");
    // Le schéma est jugé AVANT le verdict métier.
    expect(parse.indexOf("readCompletionSchema(envelope)")).toBeLessThan(
      parse.indexOf("readCompletion(if (choice == null)"),
    );
    // Le message de schéma reste borné par la règle pure.
    expect(src).toContain("throw LlmError(LlmCompletionFault.UNREADABLE.message)");
  });
});

describe("clé : jamais dans un message, un journal ou un crash", () => {
  // Assemblé : un littéral `sk-or-v1-…` complet déclencherait le scan anti-secrets.
  const KEY = ["sk-or", "v1", "0123456789abcdef0123456789abcdef"].join("-");

  test.skipIf(skip)("la clé est retirée de tout texte, même au milieu", async () => {
    const text = `Bearer ${KEY} refusé par https://openrouter.ai (${KEY})`;
    const out = await redact(text, KEY);
    expect(out).not.toContain(KEY);
    expect(out).toContain("[clé]");
    // Le reste du message survit : on ne jette pas la cause avec la clé.
    expect(out).toContain("refusé par");
    expect(out).toContain("https://openrouter.ai");
  });

  test.skipIf(skip)("une chaîne sans clé reste intacte, une fausse clé courte aussi", async () => {
    expect(await redact("Erreur réseau", KEY)).toBe("Erreur réseau");
    expect(await redact("abc", "abc")).toBe("abc");
  });

  test.skipIf(skip)("boundedMessage borne et supprime les retours à la ligne", async () => {
    const c = await constants();
    const long = "a".repeat(c.maxErrorChars + 50);
    expect((await bounded(long)).length).toBe(c.maxErrorChars);
    // Pas d'injection de fausses lignes de journal.
    const injected = await bounded("ligne1\nligne2\rligne3\tligne4");
    expect(injected).not.toMatch(/[\r\n\t]/);
    expect(injected).toBe("ligne1 ligne2 ligne3 ligne4");
  });

  const src = codeOnly(readFileSync(LLM, "utf8"));
  const policy = codeOnly(readFileSync(join(DATA, "LlmPolicy.kt"), "utf8"));

  test("l'erreur elle-même est bornée, pas seulement `userMessage`", () => {
    expect(src).toMatch(/class LlmError\(message: String, val status: Int\? = null\) : Exception\(boundedMessage\(message\)\)/);
    expect(src).toMatch(/val userMessage: String = boundedMessage\(message\)/);
    expect(policy).toContain("const val MAX_ERROR_CHARS = 120");
  });

  test("aucun journal, et la clé ne s'interpole que dans Authorization", () => {
    expect(src).not.toMatch(/Log\.|println|printStackTrace|System\.err/);
    // Une seule interpolation de `$key` : l'en-tête Bearer.
    expect(src.match(/\$key/g)?.length ?? 0).toBe(1);
    expect(src).toContain('.header("Authorization", "Bearer $key")');
    // Défense en profondeur : le seul message dynamique passe par `redactKey`.
    expect(src).toContain("transportError(e, key)");
    expect(src).toContain("redactKey(transportFaultMessage(classifyTransportError(e)), key)");
    expect(src).not.toContain("e.message");
    expect(src).not.toContain("e.stackTrace");
  });
});

describe("annulation : un abandon ne se rejoue pas et ne paie pas un second appel", () => {
  test.skipIf(skip)("une annulation ferme la reprise, même sur un petit corps", async () => {
    // Sans annulation, le même appel serait rejoué (petit corps, rien consommé).
    expect(await retry(1_000, false, false)).toBe(true);
    expect(await retry(1_000, false, true)).toBe(false);
    // Et un corps déjà consommé reste non rejouable, annulé ou non.
    expect(await retry(1_000, true, true)).toBe(false);
  });

  const src = codeOnly(readFileSync(LLM, "utf8"));
  const send = src.slice(src.indexOf("private fun send"), src.indexOf("private fun transportError"));

  test("les appels en vol sont suivis puis coupés par `cancel()`", () => {
    expect(src).toContain("private val inFlight: MutableSet<Call> = Collections.synchronizedSet(mutableSetOf<Call>())");
    expect(src).toMatch(/fun cancel\(\)/);
    expect(src).toContain("inFlight.toList()");
    expect(src).toContain("call.cancel()");
    // L'appel est enregistré puis TOUJOURS retiré, même en erreur.
    const added = send.indexOf("inFlight.add(call)");
    const removed = send.indexOf("inFlight.remove(call)");
    expect(added).toBeGreaterThan(-1);
    expect(removed).toBeGreaterThan(added);
    expect(send).toContain("} finally {");
  });

  test("un appel annulé n'est ni envoyé ni rejoué", () => {
    // Avant tout réseau : aucun envoi.
    expect(send.indexOf("if (cancelled) throw LlmError(CANCELLED_MESSAGE)")).toBeGreaterThan(-1);
    // Après l'attente : la réponse n'est pas lue.
    expect(send.indexOf("if (cancelled) throw LlmError(CANCELLED_MESSAGE)")).toBeLessThan(
      send.indexOf("if (!res.isSuccessful)"),
    );
    // Une panne OkHttp due à l'annulation ne passe pas par la reprise.
    const cancelledBranch = send.indexOf("if (cancelled) throw LlmError(CANCELLED_MESSAGE)", 100);
    expect(cancelledBranch).toBeGreaterThan(-1);
    expect(cancelledBranch).toBeLessThan(send.indexOf("attempt >= MAX_ATTEMPTS"));
    expect(send).toContain("retryAllowed(bodyBytes.size, responseConsumed, cancelled)");
  });
});
