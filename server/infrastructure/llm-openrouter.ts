// LLM OpenRouter v1 (issue #27, phase 9) — adapter LLMProvider.
// 0.7.0 : la clé n'est PLUS un secret du serveur. Elle arrive dans le corps de
// la requête de l'app (`HomeworkGenerateRequest.apiKey`), vit le temps de l'appel
// et part dans l'en-tête Authorization. Le serveur n'en détient aucune : ni env,
// ni disque, ni log. Le modèle est une constante de code (pas un credential).
// Corps = SafePrompt nonce-bound (I6) construit par server/ai/untrusted.ts ;
// garde d'entrée/sortie = server/ai/guard.ts (I4/I5), scan secret rejoué ici car
// generate()/generateSafe() SONT la frontière réseau. Aucun secret sur le fil
// sauf Authorization Bearer, jamais dans logs/erreurs.
// ponytail: fetch natif + timeout, pas de SDK. Upgrade: retry/backoff si quotas.
import { assertNoSecretsInPrompt, MAX_OUTPUT_CHARS } from "../ai/guard";
import { buildSafePrompt } from "../ai/untrusted";
import type { SafePrompt } from "../ai/untrusted";
import type { LLMProvider, Untrusted } from "../domain/ports";

export interface LlmConfig {
  readonly model: string;
}

/** Modèle par défaut : choix de code, PAS un credential (donc pas d'env). */
export const LLM_DEFAULT_MODEL = "stealth/space-bunny-alpha";
/** Longueur plausible d'une clé de fournisseur : borne le corps comme le reste. */
const MIN_API_KEY_CHARS = 8;

// URL publique du fournisseur, pas une donnée perso/établissement (règle or : seule l'URL Pronote est proscrite).
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 120_000;
// Plafond API aligné sur la garde I5 (MAX_OUTPUT_CHARS) : ~2 caractères/token
// borne basse pour du français, donc la sortie ne peut pas dépasser ce que
// validateTextOutput accepte, et le coût par appel est fini.
const MAX_OUTPUT_TOKENS = Math.ceil(MAX_OUTPUT_CHARS / 2);

export interface LlmProviderOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly logger?: (message: string) => void;
}

// Env hors bornes (NaN/0/négatif) = délai recalé sur le défaut : jamais de TypeError
// brut hors contrat LlmError.
function normalizeTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return value;
}

export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export class OpenRouterProvider implements LLMProvider {
  private readonly config: LlmConfig;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly logger: (message: string) => void;

  constructor(config: LlmConfig = { model: LLM_DEFAULT_MODEL }, opts: LlmProviderOptions = {}) {
    if (!config.model) throw new LlmError("llm config incomplète");
    this.config = config;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = normalizeTimeoutMs(opts.timeoutMs);
    this.logger = opts.logger ?? (() => {});
  }

  async generate(prompt: { system: string; data: Untrusted<string>[] }, apiKey?: string): Promise<string> {
    return this.generateSafe(buildSafePrompt(prompt.system, prompt.data), apiKey);
  }

  // Envoie le SafePrompt DÉJÀ validé par la garde (nonce de l'appelant préservé
  // au lieu d'un nonce régénéré ici). `apiKey` vient de l'APP : sans elle, aucun
  // appel — le serveur ne possède aucun credential de repli.
  async generateSafe(safe: SafePrompt, apiKey?: string): Promise<string> {
    const key = (apiKey ?? "").trim();
    if (key.length < MIN_API_KEY_CHARS) throw new LlmError("clé LLM absente");
    assertNoSecretsInPrompt(safe);
    let res: Response;
    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      res = await this.fetchFn(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: safe.system },
            { role: "user", content: safe.body },
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal,
      });
    } catch (err) {
      this.logger("llm network error");
      throw new LlmError(`llm network: ${(err as Error)?.message ?? "fetch failed"}`);
    }
    if (!res.ok) {
      this.logger(`llm http ${res.status}`);
      // Corps jamais lu = socket retenu au pool : on l'annule avant de lever.
      await res.body?.cancel().catch(() => {});
      throw new LlmError(`llm http ${res.status}`, res.status);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LlmError("llm réponse JSON invalide");
    }
    const choice = (json as { choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] })
      ?.choices?.[0];
    // finish_reason "length" = token budget atteint => sortie INCOMPLÈTE : jamais
    // renvoyée comme une réponse complète (I5), le truncated push serait faux.
    if (choice?.finish_reason === "length") throw new LlmError("llm sortie tronquée (finish_reason=length)");
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new LlmError("llm sortie vide");
    return content;
  }
}

/** Toujours branché : la clé vient de l'app, le modèle est une constante. */
export function createLlmProvider(opts: LlmProviderOptions = {}): LLMProvider {
  return new OpenRouterProvider({ model: LLM_DEFAULT_MODEL }, opts);
}
