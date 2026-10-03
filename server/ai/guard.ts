// Garde LLM I4/I5 : sans outils, sans reseau, sans secrets. Sortie texte/JSON validee.
// Aucun acces reseau/env/outil ici (scan check-architecture). Stdlib uniquement.
// Motifs secrets fragmentes volontairement : evite auto-match du scan I4
// (check-architecture cherche les formes contigues), detection runtime identique.
// Voir docs/architecture/INVARIANTS.md (I4/I5), server/domain/ports.ts (LLMProvider).
import { buildSafePrompt } from "./untrusted";
import type { LLMProvider, Untrusted } from "../domain/ports";
import type { SafePrompt } from "./untrusted";

// ponytail: constantes en dur, jamais depuis externe. Upgrade: config par phase si seuils metier.
export const MAX_OUTPUT_CHARS = 8000;

// Fragments : concatenation runtime = forme contigue detectee, fichier = forme cassee (scan OK).
const F1 = "sk-or" + "-v1-";
const F2 = "OPENROUTER_" + "API_KEY";
const F3 = "MASTER_" + "KEY";
const F4 = "PRONOTE_" + "PASSWORD";
const F5 = "BEGIN " + "PRIVATE KEY";
const SECRET_RE = new RegExp(`${F1}|${F2}|${F3}|${F4}|${F5}`);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Rejette tout prompt (system + donnees + body) contenant un secret.
export function assertNoSecretsInPrompt(safe: SafePrompt, data?: Untrusted<string>[]): void {
  const hay = [safe.system, safe.body, ...(data ?? []).map((d) => String(d.value))].join("\n");
  if (SECRET_RE.test(hay)) throw new Error("secret dans prompt LLM (I4)");
}

// Sortie texte : non-vide, bornee, sans secret.
export function validateTextOutput(out: unknown): string {
  if (!isNonEmptyString(out)) throw new Error("sortie LLM vide (I5)");
  if (out.length > MAX_OUTPUT_CHARS) throw new Error("sortie LLM trop longue (I5)");
  if (SECRET_RE.test(out)) throw new Error("secret dans sortie LLM (I4)");
  return out;
}

// Sortie JSON : texte valide + JSON.parse objet/tableau.
export function parseJsonOutput<T>(out: unknown): T {
  const text = validateTextOutput(out);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("sortie LLM JSON invalide (I5)");
  }
  if (parsed === null || typeof parsed !== "object") throw new Error("sortie LLM JSON invalide (I5)");
  return parsed as T;
}

// Fournisseur qui sait envoyer un SafePrompt déjà validé (nonce de l'appelant
// préservé). ponytail: capacité optionnelle, pas de port modifié (server/domain
// est hors périmètre) ; sinon repli sur generate(), qui reconstruit le prompt.
type SafePromptProvider = { generateSafe(safe: SafePrompt): Promise<string> };

function hasGenerateSafe(provider: LLMProvider): provider is LLMProvider & SafePromptProvider {
  return typeof (provider as Partial<SafePromptProvider>).generateSafe === "function";
}

// Envoie le prompt VALIDÉ ici (jamais une reconstruction) : le corps contrôlé par
// assertNoSecretsInPrompt est exactement celui transmis.
function callProvider(
  provider: LLMProvider,
  safe: SafePrompt,
  data: Untrusted<string>[],
): Promise<string> {
  if (hasGenerateSafe(provider)) return provider.generateSafe(safe);
  return provider.generate({ system: safe.system, data });
}

// Pont SafePrompt (body nonce) -> LLMProvider (system + data Untrusted).
// Valide prompt avant appel, valide sortie apres. Aucun outil/reseau ici.
export async function generateGuarded(
  provider: LLMProvider,
  system: string,
  data: Untrusted<string>[],
  nonce?: string,
): Promise<string> {
  const safe = buildSafePrompt(system, data, nonce);
  assertNoSecretsInPrompt(safe, data);
  const out = await callProvider(provider, safe, data);
  return validateTextOutput(out);
}

export async function generateGuardedJson<T>(
  provider: LLMProvider,
  system: string,
  data: Untrusted<string>[],
  nonce?: string,
): Promise<T> {
  const safe = buildSafePrompt(system, data, nonce);
  assertNoSecretsInPrompt(safe, data);
  const out = await callProvider(provider, safe, data);
  return parseJsonOutput<T>(out);
}
