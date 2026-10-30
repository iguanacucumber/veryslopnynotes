// #629 — l'aide devoirs rend un corrigé en TROIS parties (réponse, étapes,
// sources) et un refus avec des CTA contextuels.
//
// Le pont natif (`VsnBridge.homeworkAnswerJson`) publie `answer`/`steps`/
// `sources` ; l'UI ne lit plus un `body` opaque. Les parsers sont purs : on
// teste ici leurs bornes et les clés d'action, puis la source du panneau pour
// prouver que les trois parties et les CTA sont rendus.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import {
  parseHomeworkActions,
  parseHomeworkAnswer,
} from "../../web/src/features/tasks/assignments";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("aide devoirs — corrigé en trois parties (#629)", () => {
  test("garde l'ordre des étapes et des sources, sans doublon de source", () => {
    const parsed = parseHomeworkAnswer({
      answer: "  Relie chaque régime à deux caractéristiques.  ",
      steps: ["Repère les régimes.", " Relie les caractéristiques. ", "Repère les régimes."],
      sources: ["Consigne", "Cours : chapitre 4", "Consigne"],
    });
    expect(parsed).toEqual({
      answer: "Relie chaque régime à deux caractéristiques.",
      steps: ["Repère les régimes.", "Relie les caractéristiques.", "Repère les régimes."],
      sources: ["Consigne", "Cours : chapitre 4"],
    });
  });

  test("borne les étapes et les sources pour le rendu, sans jeter le corrigé", () => {
    const parsed = parseHomeworkAnswer({
      answer: "a".repeat(20_000),
      steps: Array.from({ length: 40 }, (_, index) => `étape ${index} ${"x".repeat(1_000)}`),
      sources: Array.from({ length: 20 }, (_, index) => `source ${index}`),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.answer.length).toBe(8_000);
    expect(parsed!.steps).toHaveLength(12);
    expect(parsed!.steps[0]!.length).toBe(400);
    expect(parsed!.sources).toHaveLength(8);
  });

  test("une réponse absente ou vide n'est pas un corrigé", () => {
    expect(parseHomeworkAnswer(null)).toBeNull();
    expect(parseHomeworkAnswer({})).toBeNull();
    expect(parseHomeworkAnswer({ answer: "   ", steps: ["x"] })).toBeNull();
    expect(parseHomeworkAnswer("texte nu")).toBeNull();
  });

  test("les étapes non textuelles sont écartées, pas rendues « [object Object] »", () => {
    const parsed = parseHomeworkAnswer({
      answer: "Réponse",
      steps: ["ok", 42, { text: "non" }, "", "  "],
      sources: ["Consigne", 3, null],
    });
    expect(parsed?.steps).toEqual(["ok"]);
    expect(parsed?.sources).toEqual(["Consigne"]);
  });

  test("un corrigé sans étapes ni sources reste affichable", () => {
    expect(parseHomeworkAnswer({ answer: "Réponse seule." })).toEqual({
      answer: "Réponse seule.",
      steps: [],
      sources: [],
    });
  });
});

describe("aide devoirs — CTA de refus (#629)", () => {
  test("seules les clés connues passent, sans doublon", () => {
    expect(parseHomeworkActions(["add_course", "enable_manual", "core", 3, "add_course"])).toEqual([
      "add_course",
      "enable_manual",
    ]);
    expect(parseHomeworkActions("add_course")).toEqual([]);
    expect(parseHomeworkActions(undefined)).toEqual([]);
  });
});

describe("aide devoirs — pont et panneau (#629)", () => {
  test("le pont factice publie answer, steps et sources, jamais un body opaque", async () => {
    const result = await mockCall<{
      ok: boolean;
      answer?: string;
      steps?: string[];
      sources?: string[];
      body?: string;
    }>("llm.askHomework", { assignmentId: "a1", weekStart: "2026-10-19" });
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("corrigé");
    expect(result.steps?.length).toBeGreaterThan(0);
    expect(result.sources).toContain("Cours : Chapitre 4");
    expect(result.body).toBeUndefined();
  });

  test("le natif borne le corrigé et propose les CTA du refus", () => {
    const bridge = readBridgeSource();
    expect(bridge).toContain("homeworkAnswerJson(outcome)");
    expect(bridge).toContain('put("answer", outcome.answer.trim().take(Homework.MAX_ANSWER_CHARS))');
    expect(bridge).toContain("outcome.steps.take(Homework.MAX_STEPS)");
    expect(bridge).toContain("Homework.MAX_STEP_CHARS");
    expect(bridge).toContain('json.put("actions", JSONArray(AiContext.REFUSAL_ACTIONS))');
  });

  test("le panneau rend la réponse, les étapes, les sources et les CTA contextuels", () => {
    const tasks = source("features/tasks/TasksScreen.tsx");
    expect(tasks).toContain('className="task-help__panel-answer"');
    expect(tasks).toContain("help.steps.map");
    expect(tasks).toContain('className="task-help__steps"');
    expect(tasks).toContain("help.sources.map");
    expect(tasks).toContain('className="task-help__sources"');
    expect(tasks).toContain('help.actions.includes("add_course")');
    expect(tasks).toContain('help.actions.includes("enable_manual")');
    expect(tasks).toContain('help.actions.includes("open_attachment")');
    expect(tasks).toContain("parseHomeworkAnswer(result)");
    expect(tasks).toContain("parseHomeworkActions(result.actions)");
    expect(tasks).not.toContain("result.body");
  });
});
