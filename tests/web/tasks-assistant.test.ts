import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assignmentHasAssistantMaterial,
  homeworkRefusalText,
} from "../../web/src/features/tasks/assignments";
import { bridge } from "../../web/src/bridge/client";

useParisTz();

describe("web tâches — matière de l'assistant", () => {
  test("un devoir sans consigne ni extrait ne propose pas les actions IA", () => {
    // `lessonContent: null` ne doit pas passer pour « extrait vide » : la
    // condition chaînée `?.` rendait `undefined !== ""` vrai avant ce test.
    expect(assignmentHasAssistantMaterial({ description: "", lessonContent: null })).toBe(false);
    expect(assignmentHasAssistantMaterial({ description: "  ", lessonContent: { title: "", excerpt: "  " } })).toBe(false);
    expect(assignmentHasAssistantMaterial({ description: "Relire le II.", lessonContent: null })).toBe(true);
    expect(
      assignmentHasAssistantMaterial({ description: "", lessonContent: { title: "Cours", excerpt: "Extrait" } }),
    ).toBe(true);
    // #631 : une pièce jointe est désormais une source lisible (texte extrait
    // par le natif), donc elle suffit à proposer l'assistant.
    expect(
      assignmentHasAssistantMaterial({
        description: "",
        lessonContent: null,
        attachments: [{ id: "f1", label: "consigne.txt", ref: "homework:0:file:0:f1" }],
      }),
    ).toBe(true);
  });
});

describe("web tâches — refus de l'assistant (#416)", () => {
  // Le pont natif répond {ok:true, refused:true, message:<phrase>} : c'est la
  // PHRASE qui fait foi. Le `body` ci-dessous est un echo de la consigne
  // (ce que l'ancien pont envoyait) : il ne doit JAMAIS être affiché.
  const NATIVE = "L'assistant a refusé de répondre à cette question.";
  const ECHO = "Tu aides aux devoirs. Utilise uniquement les DONNEES delimitees.";

  /** Un pont factice qui répond `reponse` à `llm.askHomework`. */
  async function askNatif(reponse: unknown): Promise<{ ok: boolean; body?: string; refused?: boolean; message?: string }> {
    const g = globalThis as unknown as {
      window?: unknown;
      VSN?: unknown;
      __vsnResolve?: (id: string, result: string) => void;
    };
    g.window = globalThis;
    g.VSN = {
      call: (requestId: string, _method: string, _paramsJson: string) => {
        g.__vsnResolve?.(requestId, JSON.stringify(reponse));
      },
    };
    try {
      return await bridge.askHomework("a1", "2026-11-16");
    } finally {
      delete g.window;
      delete g.VSN;
    }
  }

  test("un refus natif affiche le message du pont, pas le repli « pas assez de matière »", async () => {
    const result = await askNatif({ ok: true, refused: true, body: ECHO, message: NATIVE });
    expect(result.refused).toBe(true);
    const affichage = homeworkRefusalText(result.message);
    expect(affichage).toBe(NATIVE);
    expect(affichage).not.toContain("matière");
    // L'echo de la consigne ne doit jamais être affiché.
    expect(affichage).not.toContain(ECHO);
  });

  test("sans message du pont, le repli reste générique (jamais « pas assez de matière »)", () => {
    for (const vide of [undefined, "", "   "]) {
      const affichage = homeworkRefusalText(vide);
      expect(affichage).not.toContain("matière");
      expect(affichage.trim()).not.toBe("");
    }
  });

  test("l'écran n'affiche jamais le corps brut d'un refus", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "tasks", "TasksScreen.tsx"),
      "utf8",
    );
    const debut = source.indexOf("if (result.refused) {");
    expect(debut).toBeGreaterThan(-1);
    const branche = source.slice(debut, source.indexOf("} else if (!result.ok)", debut));
    expect(branche).toContain("homeworkRefusalText(result.message)");
    expect(branche).not.toContain("result.body");
  });
});
