import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { codeOnly } from "../../agents/runtime/source-guards";
import {
  AI_COST_REMINDER,
  AI_COST_REMINDER_SHORT,
  AI_MODEL_NOTE,
  AI_NOTICE_MAX_CHARS,
  AiCostReminder,
  MODEL_UNAVAILABLE_MESSAGE,
  ModelUnavailableNotice,
  VISION_MODEL_UNAVAILABLE_MESSAGE,
  aiFailureNotice,
  boundedNotice,
} from "../../web/src/features/assistant/notices";
import { AI_VISION_RETENTION_NOTE } from "../../web/src/features/assistant/consent";

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const WEB = join(ROOT, "web", "src");

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("IA — modèle indisponible dit clairement, sans repli", () => {
  test("un 404 ou un refus d'allowlist devient un message de modèle", () => {
    for (const notice of [
      aiFailureNotice("model", ""),
      aiFailureNotice(undefined, "Modèle LLM introuvable (404) : le catalogue a changé."),
      aiFailureNotice(undefined, "Modèle LLM non autorisé : configuration refusée."),
    ]) {
      expect(notice.kind).toBe("model");
      expect(notice.message).toContain("Modèle LLM");
      expect(notice.message).not.toContain(":free");
      expect(notice.message).not.toContain("gratuit");
    }
  });

  test("le message de modèle est BORNÉ, jamais une réponse vide ou un autre modèle", () => {
    const long = aiFailureNotice("model", "x".repeat(500));
    expect(long.message).toHaveLength(AI_NOTICE_MAX_CHARS);
    const empty = aiFailureNotice("model", "   ");
    expect(empty.message).toBe(MODEL_UNAVAILABLE_MESSAGE);
  });

  test("l'écran rend le message indisponible, pas un diagnostic réseau", () => {
    const html = renderToStaticMarkup(createElement(ModelUnavailableNotice, {}));
    expect(html).toContain("Modèle LLM indisponible");
    expect(html).toContain("Mets à jour");
  });

  test("le client natif refuse un modèle hors allowlist et ne bascule jamais", () => {
    const policy = codeOnly(source(join(DATA, "LlmPolicy.kt")));
    const llm = codeOnly(source(join(DATA, "OpenRouterLlm.kt")));
    const init = llm.slice(llm.indexOf("init {"), llm.indexOf("fun cancel()"));
    expect(policy).toContain("val LLM_ALLOWED_MODELS: Set<String>");
    expect(policy).toContain("setOf(PINNED_TEXT_MODEL, PINNED_VISION_MODEL)");
    expect(policy).toContain("fun isAllowedModel(model: String): Boolean = model in LLM_ALLOWED_MODELS");
    expect(llm).toMatch(/private val model: String = PINNED_TEXT_MODEL/);
    expect(llm).toMatch(/private val visionModel: String = PINNED_VISION_MODEL/);
    expect(init).toContain("!isAllowedModel(model) || !isAllowedModel(visionModel)");
    expect(init).toContain("throw LlmError(MODEL_REFUSED_MESSAGE)");
    // Aucun `?:` ni `takeIf` ne remplace le modèle refusé par un défaut.
    expect(init).not.toMatch(/\?:|takeIf/);
    expect(llm).toMatch(/404 -> MODEL_UNAVAILABLE_MESSAGE/);
  });

  test("le repli vision est explicite : aucun autre modèle appelé", () => {
    expect(VISION_MODEL_UNAVAILABLE_MESSAGE).toContain("Modèle vision indisponible");
    expect(VISION_MODEL_UNAVAILABLE_MESSAGE).toContain("aucun autre modèle");
    expect(aiFailureNotice(undefined, VISION_MODEL_UNAVAILABLE_MESSAGE).kind).toBe("model");
  });

  test("un consentement manquant n'est pas une panne réseau", () => {
    expect(aiFailureNotice("consent", "").kind).toBe("consent");
    expect(aiFailureNotice(undefined, "Consentement IA requis : ouvre Réglages.").kind).toBe("consent");
  });

  test("le modèle vision livré est payant et la requête impose ZDR", () => {
    const policy = codeOnly(source(join(DATA, "LlmPolicy.kt")));
    const llm = codeOnly(source(join(DATA, "OpenRouterLlm.kt")));
    expect(policy).toContain('const val PINNED_VISION_MODEL = "qwen/qwen3-vl-30b-a3b-instruct"');
    expect(policy).not.toMatch(/PINNED_VISION_MODEL\s*=\s*"[^"]*:free"/);
    const vision = llm.slice(llm.indexOf("override fun generateVisionSafe"), llm.indexOf("private fun send"));
    expect(vision).toContain('.put("zdr", true)');
    expect(vision).toContain('.put("data_collection", "deny")');
    expect(vision).toContain("VISION_MODEL_UNAVAILABLE_MESSAGE");
  });

  test("le pont nomme la cause modèle au lieu de la classer « réseau »", () => {
    const teacher = codeOnly(source(join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridgeTeacher.kt")));
    expect(teacher).toContain("e.isModelUnavailable -> \"model\"");
    expect(teacher).toContain("e.status == 401 || e.status == 403 -> \"key\"");
  });
});

describe("IA — rappel de coût avant l'usage", () => {
  test("le rappel nomme les crédits OpenRouter et la facturation", () => {
    expect(AI_COST_REMINDER).toContain("crédits OpenRouter");
    expect(AI_COST_REMINDER).toContain("facturée");
    expect(AI_COST_REMINDER_SHORT).toContain("OpenRouter");
    expect(AI_COST_REMINDER_SHORT.length).toBeLessThan(AI_COST_REMINDER.length);
    expect(AI_MODEL_NOTE).toContain("sans basculer vers un modèle gratuit");
  });

  test("le composant affiche le rappel avant le geste", () => {
    const long = renderToStaticMarkup(createElement(AiCostReminder, {}));
    const short = renderToStaticMarkup(createElement(AiCostReminder, { short: true }));
    expect(long).toContain("crédits OpenRouter");
    expect(short).toContain("1 appel");
    expect(short).toContain("OpenRouter");
  });

  test("Réglages et les deux fils IA portent le rappel", () => {
    expect(source(join(WEB, "features/settings/AssistantOverviewCard.tsx"))).toContain("<AiCostReminder />");
    expect(source(join(WEB, "features/settings/AssistantCards.tsx"))).toContain("AI_MODEL_NOTE");
    expect(source(join(WEB, "features/tasks/HomeworkChat.tsx"))).toContain("<AiCostReminder short");
    expect(source(join(WEB, "features/teacher/TeacherScreen.tsx"))).toContain("<AiCostReminder short");
    expect(source(join(WEB, "features/tasks/TasksScreen.tsx"))).toContain("<AiCostReminder />");
  });

  test("la rétention des photos est divulguée sans promesse absolue", () => {
    expect(AI_VISION_RETENTION_NOTE).toContain("ZDR");
    expect(AI_VISION_RETENTION_NOTE).toContain("CSAM");
    expect(AI_VISION_RETENTION_NOTE).toContain("entraînement");
    expect(AI_VISION_RETENTION_NOTE).toContain("Selon la politique d’OpenRouter");
    expect(AI_VISION_RETENTION_NOTE).toContain("ne peut pas garantir");
    expect(AI_VISION_RETENTION_NOTE).not.toMatch(/zéro rétention|zéro conservation|jamais conserv/i);
    expect(source(join(WEB, "features/tasks/TasksScreen.tsx"))).toContain("AI_VISION_RETENTION_NOTE");
    expect(source(join(WEB, "features/help/HelpScreen.tsx"))).toContain("AI_VISION_RETENTION_NOTE");
  });

  test("la copie d'erreur reste bornée et sur une seule ligne", () => {
    expect(boundedNotice("ligne1\nligne2\tfin")).toBe("ligne1 ligne2 fin");
    expect(boundedNotice("a".repeat(400))).toHaveLength(AI_NOTICE_MAX_CHARS);
  });
});
