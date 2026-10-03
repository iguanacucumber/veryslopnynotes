// LLM OpenRouter v1 (issue #27, phase 9) — adapter LLMProvider.
// Clé + modèle uniquement via env (.env.local), jamais en dur ni logués.
// Corps = SafePrompt nonce-bound (I6) construit par server/ai/untrusted.ts ;
// garde d'entrée/sortie = server/ai/guard.ts (I4/I5), scan secret rejoué ici car
// generate()/generateSafe() SONT la frontière réseau. Aucun secret sur le fil
// sauf Authorization Bearer, jamais dans logs/erreurs.
// ponytail: fetch natif + timeout, pas de SDK. Upgrade: retry/backoff si quotas.
import { assertNoSecretsInPrompt, MAX_OUTPUT_CHARS } from "../ai/guard";
import { buildSafePrompt } from "../ai/untrusted";
import type { SafePrompt } from "../ai/untrusted";
import type { LLMProvider, Untrusted } from "../domain/ports";
import { cleanEnvValue, loadRequiredEnv } from "./env";

export interface LlmConfig {
  readonly apiKey: string;
  readonly model: string;
}

export const LLM_ENV_KEYS = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"] as const;

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

export function loadLlmConfig(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): LlmConfig | null {
  const got = loadRequiredEnv(env, LLM_ENV_KEYS);
  if (!got) return null;
  return { apiKey: got["OPENROUTER_API_KEY"], model: got["OPENROUTER_MODEL"] };
}

export function isLlmConfigured(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): boolean {
  return loadLlmConfig(env) !== null;
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

  constructor(config: LlmConfig, opts: LlmProviderOptions = {}) {
    if (!cleanEnvValue(config.apiKey) || !cleanEnvValue(config.model)) {
      throw new LlmError("llm config incomplète");
    }
    this.config = config;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = normalizeTimeoutMs(opts.timeoutMs);
    this.logger = opts.logger ?? (() => {});
  }

  async generate(prompt: { system: string; data: Untrusted<string>[] }): Promise<string> {
    return this.generateSafe(buildSafePrompt(prompt.system, prompt.data));
  }

  // Envoie le SafePrompt DÉJÀ validé par la garde (nonce de l'appelant préservé
  // au lieu d'un nonce régénéré ici).
  async generateSafe(safe: SafePrompt): Promise<string> {
    assertNoSecretsInPrompt(safe);
    let res: Response;
    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      res = await this.fetchFn(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
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

export function createLlmProvider(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
  opts: LlmProviderOptions = {},
): LLMProvider | null {
  const config = loadLlmConfig(env);
  if (!config) return null;
  return new OpenRouterProvider(config, opts);
}
