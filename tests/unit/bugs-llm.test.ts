// Chasse aux bugs — client LLM OpenRouter (server/infrastructure/llm-openrouter.ts)
// + frontière garde/prompt (server/ai/guard.ts).
//
// Zéro réseau : globalThis.fetch stubé, restauré en afterEach. Zéro sleep/horloge :
// on observe soit le câblage (signal, corps de requête), soit les effets directs
// (corps de réponse drainé, type d'erreur). Clé toujours factice "sk-fake-test",
// motif de secret fragmenté comme dans le repo (jamais contigu sur disque).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LlmError, OpenRouterProvider } from "../../server/infrastructure/llm-openrouter";
import { generateGuarded } from "../../server/ai/guard";
import { SYSTEM_REVISION } from "../../server/ai/prompt";
import { markExternal } from "../../server/ai/untrusted";

const FAKE_KEY = "sk-fake-test";
const FAKE_MODEL = "fake-model-test";
/** Fragment de secret construit à l'exécution : jamais contigu dans le fichier. */
const SECRET_FRAGMENT = "sk-or" + "-v1-";

interface SentRequest {
  readonly url: string;
  readonly body: string;
  readonly signal: AbortSignal | null | undefined;
}

let sent: SentRequest[] = [];
/** Réponse renvoyée au N-ième appel (construit à la demande : body lazy). */
let responder: (index: number) => Response;
const realFetch = globalThis.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Réponse chat/completions conforme : choices[0].message.content + finish_reason. */
function completion(content: string, finishReason = "stop"): Response {
  return jsonResponse({
    id: "gen-fake-test",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
  });
}

/** Provider construit APRÈS le stub : le constructeur capture globalThis.fetch. */
function provider(opts?: { timeoutMs?: number }): OpenRouterProvider {
  return new OpenRouterProvider({ apiKey: FAKE_KEY, model: FAKE_MODEL }, opts ?? {});
}

function sentBody(index = 0): Record<string, unknown> {
  return JSON.parse(sent[index].body) as Record<string, unknown>;
}

describe("bugs llm-openrouter", () => {
  beforeEach(() => {
    sent = [];
    responder = () => completion("réponse synthétique");
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      const i = init ?? {};
      sent.push({
        url: String(input),
        body: typeof i.body === "string" ? i.body : "",
        signal: i.signal,
      });
      return Promise.resolve(responder(sent.length - 1));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // --- 1. fuite de secret (I4) : la frontière réseau ne contrôle rien ---------

  test("BUG: aucun contrôle I4 avant le fetch — un secret dans system/data part en clair chez le fournisseur", async () => {
    // Le secret contamine la DONNEE externe (chemin réel : cours Pronote injecté).
    const leaked = `${SECRET_FRAGMENT}abcdefgh1234`;
    responder = () => completion("ok");
    const p = provider();

    // On n'exige pas le refus (un scrubber serait acceptable) : l'invariant dur,
    // c'est qu'aucun octet du secret ne parte sur le réseau.
    await p
      .generate({ system: "consigne fixe", data: [markExternal(`cours ${leaked} injecté`)] })
      .catch(() => undefined);

    const onTheWire = sent.map((s) => s.body).join("\n");
    expect(onTheWire).not.toContain(leaked);
    expect(onTheWire).not.toContain(SECRET_FRAGMENT);
  });

  // --- 2. sortie tronquée acceptée comme complète ---------------------------

  test("BUG: finish_reason ignoré — une réponse tronquée par le fournisseur est renvoyée comme une sortie complète", async () => {
    responder = () => completion("Reponse coupee au milieu de la phra", "length");
    const p = provider();

    // finish_reason "length" = sortie INCOMPLÈTE (token budget atteint) : la
    // fiche/corrigé tronqué doit être rejetée, pas pushée telle quelle (I5).
    await expect(
      p.generate({ system: SYSTEM_REVISION, data: [markExternal("cours de synthèse")] }),
    ).rejects.toThrow();
  });

  // --- 3. sortie non bornée côté API ---------------------------------------

  test("BUG: aucun max_tokens envoyé — la génération n'est pas bornée par l'API (coût non plafonné, rejet I5 sur longue réponse)", async () => {
    responder = () => completion("résumé");
    const p = provider();

    await p.generate({ system: SYSTEM_REVISION, data: [markExternal("cours de synthèse")] });

    const body = sentBody();
    // Sans plafond de tokens côté fournisseur, rien n'empêche de dépasser
    // MAX_OUTPUT_CHARS (8000) => validateTextOutput rejette => 500 sur les
    // longues réponses, et le coût par appel est illimité.
    expect(typeof body["max_tokens"]).toBe("number");
    expect(Number(body["max_tokens"])).toBeGreaterThan(0);
  });

  // --- 4. prompt envoyé ≠ prompt validé (nonce de l'appelant perdu) ----------

  test("BUG: le SafePrompt validé par la garde est reconstruit — le nonce de l'appelant n'est jamais celui envoyé sur le fil", async () => {
    responder = () => completion("résumé synthétique");
    const p = provider();
    const nonce = "FixedNonce12345678";

    await generateGuarded(p, SYSTEM_REVISION, [markExternal("cours de synthèse")], nonce);

    // generate() refait buildSafePrompt() avec un nonce aléatoire : le corps
    // contrôlé par assertNoSecretsInPrompt n'est pas celui transmis.
    const messages = sentBody()["messages"] as { role: string; content: string }[];
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.content ?? "").toContain(`nonce="${nonce}"`);
  });

  // --- 5. timeout hors bornes : erreur non typée, hors contrat --------------

  test("BUG: timeoutMs non validé — une valeur hors bornes fait échapper un TypeError brut (hors contrat LlmError, non journalisé)", async () => {
    responder = () => completion("ok");
    // Plombage réaliste : Number(env.LLM_TIMEOUT_MS) => NaN.
    const p = provider({ timeoutMs: Number.NaN });

    // Contrat du module : toute défaillance LLM sort en LlmError (status
    // exploitable par l'appelant). Ici AbortSignal.timeout lève avant le try.
    // Accepté : délai recalé sur le défaut (appel pursued) OU erreur typée.
    await p
      .generate({ system: SYSTEM_REVISION, data: [] })
      .catch((err: unknown) => {
        expect(err).toBeInstanceOf(LlmError);
      });
  });

  // --- 6. corps d'erreur jamais drainé -------------------------------------

  test("BUG: le corps de la réponse HTTP en erreur n'est jamais drainé — la connexion reste retenue à chaque échec", async () => {
    const failed = jsonResponse({ error: { message: "insufficient credits" } }, 401);
    responder = () => failed;
    const p = provider();

    await expect(p.generate({ system: SYSTEM_REVISION, data: [] })).rejects.toThrow();

    // Sans consumption/annulation, le socket reste occupé : une clé invalide
    // (401 sur chaque appel) épuise les connexions du pool.
    expect(failed.bodyUsed).toBe(true);
  });
});