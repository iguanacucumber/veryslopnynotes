import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../agents/runtime/source-guards";

// #359 : le modèle LLM par défaut était absent du catalogue public OpenRouter
// — chaque appel partait en HTTP 404, avalé en `null` : l'assistant était mort
// (« Échec de l'assistant. » pour TOUT, clé invalide comprise).
//
// Ces tests lisent le code Kotlin livré (le vrai `android-compile` de
// `make check` en vérifie la compilation) : pas de réseau, pas de doublon.

const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const APP = join(import.meta.dir, "..", "..", "android/app/src/main/java/fr/veryslopnynotes/app");

const src = (dir: string, file: string) => codeOnly(readFileSync(join(dir, file), "utf8"));

// Catalogue de RÉFÉRENCE : identifiants relevés dans le catalogue public
// (`GET https://openrouter.ai/api/v1/models`, 469 modèles, relevé du
// 2026-10-19). Liste EN DUR : un test unitaire n'appelle jamais le réseau, et
// le catalogue bouge plus vite que la suite de tests.
// Pour la rafraîchir : curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id'
const KNOWN_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it",
  "minimax/minimax-m3.1-flash:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "liquid/lfm-2.5-2.6b:free",
  "google/gemini-3.8-flash",
];

/** Messages du `when (status)` de `LlmError.messageForStatus`, lus dans le Kotlin. */
function statusMessages(kotlin: string): Map<string, string> {
  const block = /fun messageForStatus[\s\S]*?when \(status\) \{([\s\S]*?)\n\s*\}/.exec(kotlin)?.[1] ?? "";
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(\d{3})\s*->\s*"([^"]*)"/g)) out.set(m[1]!, m[2]!);
  return out;
}

describe("android LLM — modèle par défaut au catalogue (#359)", () => {
  test("l'identifiant livré est un modèle connu du catalogue de référence", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    const model = /const val LLM_DEFAULT_MODEL = "([^"]+)"/.exec(kotlin)?.[1];
    expect(model).toBeTruthy();
    // Le filet : le modèle par défaut existe VRAIMENT chez le fournisseur.
    expect(KNOWN_MODELS).toContain(model!);
    // Un id OpenRouter = namespace/modèle : un id sans namespace est inventé.
    expect(model!).toMatch(/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.:-]*$/);
  });

  test("le modèle vision est lui aussi au catalogue, et DISTINCT du texte", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    const text = /const val LLM_DEFAULT_MODEL = "([^"]+)"/.exec(kotlin)?.[1];
    const vision = /const val LLM_VISION_MODEL = "([^"]+)"/.exec(kotlin)?.[1];
    expect(vision).toBeTruthy();
    expect(KNOWN_MODELS).toContain(vision!);
    // Le modèle texte demandé (Nemotron Lightning) n'accepte pas les images :
    // les deux constantes ne doivent pas être confondues.
    expect(vision).not.toBe(text);
    expect(vision).toMatch(/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.:-]*$/);
  });

  test("la liste de référence est elle-même plausible (tripwire)", () => {
    expect(KNOWN_MODELS.length).toBeGreaterThan(0);
    for (const id of KNOWN_MODELS) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.:-]*$/);
    }
    // Pas de doublon : la liste reste une liste de modèles, pas un catalogue aplati.
    expect(new Set(KNOWN_MODELS).size).toBe(KNOWN_MODELS.length);
  });

  test("le modèle par défaut n'est pas un identifiant retiré du catalogue", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    // L'ancien identifiant (#359) : ni dans le code, ni dans la liste de référence.
    expect(kotlin).not.toContain("space-bunny-alpha");
    expect(KNOWN_MODELS).not.toContain("stealth/space-bunny-alpha");
  });
});

describe("android LLM — une cause par message (#359)", () => {
  test("404 et 401 donnent deux messages distincts", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    const messages = statusMessages(kotlin);
    expect(messages.has("401")).toBe(true);
    expect(messages.has("404")).toBe(true);
    // L'exigence : 404 (modèle indisponible) ≠ 401 (clé refusée).
    expect(messages.get("404")).not.toBe(messages.get("401"));
    // Crédits (402) et quota (429) ont eux aussi leur propre message.
    expect(new Set(messages.values()).size).toBe(messages.size);
    expect(messages.get("402")).not.toBe(messages.get("429"));
  });

  test("messages bornés, sans secret ni URL", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    const max = Number(/const val MAX_ERROR_CHARS = (\d+)/.exec(kotlin)?.[1] ?? "0");
    expect(max).toBeGreaterThan(0);
    const messages = statusMessages(kotlin);
    const fallback = /else\s*->\s*"([^"]*)"/.exec(kotlin)?.[1] ?? "";
    expect(fallback).not.toBe("");
    for (const msg of [...messages.values(), fallback]) {
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.length).toBeLessThanOrEqual(max);
      // Jamais la clé, jamais l'URL, jamais un en-tête d'autorisation.
      expect(msg).not.toMatch(/sk-or|Bearer|Authorization/i);
      expect(msg).not.toMatch(/https?:\/\//i);
    }
  });

  test("le repli HTTP générique reste un message, pas un code nu", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    expect(kotlin).not.toContain('"llm http "');
    // La cause est portée par l'erreur, pas par un texte unique « llm http NNN ».
    expect(kotlin).toMatch(/throw LlmError\.forStatus\(res\.code\)/);
  });
});

describe("android LLM — l'erreur remonte à l'appelant (#359)", () => {
  test("plus de `catch (_: Exception) { null }` : la cause est gardée", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    expect(kotlin).not.toMatch(/catch \(_: Exception\) \{\s*null\s*\}/);
    // La branche LlmError porte le message d'erreur, pas un null muet.
    expect(kotlin).toMatch(/catch \(e: LlmError\) \{\s*HomeworkResult\(null, e\.userMessage\)/);
    // Le modèle a répondu mais hors format : cause distincte de l'appel raté.
    expect(kotlin).toMatch(/catch \(_: AiError\) \{\s*HomeworkResult\(null, INVALID_ANSWER_MESSAGE\)/);
    // Le repli (cause inconnue) reste un message, pas un null.
    expect(kotlin).toMatch(/HomeworkResult\(null, GENERIC_ERROR_MESSAGE\)/);
  });

  test("le pont affiche la cause de l'échec LLM (devoirs et fiches)", () => {
    const bridge = src(APP, "VsnBridge.kt");
    // Devoirs : le message de l'erreur (clé/crédits/modèle/quota) passe au web.
    expect(bridge).toMatch(/result\.error \?: OpenRouterHomework\.GENERIC_ERROR_MESSAGE/);
    // Fiches : idem, au lieu du « Fiche non générée. » unique.
    expect(bridge).toMatch(/catch \(e: LlmError\) \{\s*JSONObject\(\)\.put\("ok", false\)\.put\("message", e\.userMessage\)/);
    // Repli : la cause est déduite, pas un message unique en dur (#367 : le
    // repli vient de core, `revisionFailureMessage`, plus « Fiche non
    // générée. » unique).
    expect(bridge).toMatch(/revisionFailureMessage\(revisionFailure\(e\)\)/);
  });

  test("le message affiché ne fuit ni la clé ni l'URL de l'appel", () => {
    const kotlin = src(DATA, "OpenRouterLlm.kt");
    // La seule interpolation de la clé reste l'en-tête Bearer.
    expect(kotlin).toMatch(/\.header\("Authorization", "Bearer \$key"\)/);
    // Aucun log, aucune trace : le message d'erreur est la seule trace.
    expect(kotlin).not.toMatch(/Log\.|println|printStackTrace/);
  });
});
