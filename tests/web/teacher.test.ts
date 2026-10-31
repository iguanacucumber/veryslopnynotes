import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeacherMessage } from "../../web/src/bridge/types";
import { TeacherView, type TeacherViewProps } from "../../web/src/features/teacher/TeacherScreen";
import {
  appendTeacherAnswer,
  buildTeacherTurn,
  classifyTeacherFailure,
  historySources,
  parseTeacherMessage,
  parseTeacherThread,
  parseTeacherTurnResult,
  rejectTeacherAnswer,
  studentMessage,
  teacherActionLabel,
  teacherHistory,
  teacherThreadPayload,
  teacherWriteQueue,
  turnSources,
} from "../../web/src/features/teacher/teacher";

useParisTz();

const ROOT = join(import.meta.dir, "..", "..");

const SOURCE = {
  type: "course",
  label: "Cours : chapitre 4",
  chars: 120,
  truncated: false,
};

function teacher(over: Partial<TeacherMessage> = {}): TeacherMessage {
  return {
    role: "teacher",
    text: "Repère d'abord l'angle droit, puis nomme les côtés.",
    sources: ["Cours : chapitre 4"],
    unsourced: false,
    context: [SOURCE],
    summaryChars: 0,
    ...over,
  };
}

function renderView(over: Partial<TeacherViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(TeacherView, {
      subjects: ["MATHEMATIQUES"],
      subject: "MATHEMATIQUES",
      mode: "explain",
      messages: [],
      draft: "",
      loading: false,
      error: null,
      refusal: null,
      focusTick: 0,
      tab: "chat",
      onTabChange: () => {},
      busy: false,
      threadLoaded: true,
      onSubjectChange: () => {},
      onModeChange: () => {},
      onDraftChange: () => {},
      onSend: () => {},
      onRetry: () => {},
      onReject: () => {},
      onNewDiscussion: () => {},
      onDelete: () => {},
      onAction: () => {},
      ...over,
    }),
  );
}

describe("professeur IA — modèle local (#633)", () => {
  test("une réponse sans citation est marquée non sourcée", () => {
    const withSource = parseTeacherMessage(teacher());
    expect(withSource?.unsourced).toBe(false);
    const without = parseTeacherMessage(teacher({ sources: [] }));
    expect(without?.unsourced).toBe(true);
  });

  test("un tour invalide ou vide est ignoré, jamais une bulle vide", () => {
    for (const raw of [null, {}, { role: "teacher", text: "  " }, { role: "student", text: "" }]) {
      expect(parseTeacherMessage(raw)).toBeNull();
    }
  });

  test("le fil local est borné à 40 tours", () => {
    const messages = Array.from({ length: 50 }, (_, index) => teacher({ text: `réponse-${index}` }));
    const thread = parseTeacherThread({ subject: "MATHEMATIQUES", messages });
    expect(thread.messages).toHaveLength(40);
    expect(thread.messages[39]?.text).toBe("réponse-49");
  });

  test("le payload d'un tour borne la question et envoie le fil borné", () => {
    const messages = Array.from({ length: 9 }, (_, index) => teacher({ text: `tour-${index}` }));
    const payload = buildTeacherTurn("MATHEMATIQUES", "  Ma question  ", "explain", messages);
    expect(payload?.message).toBe("Ma question");
    // #706 : le natif garde les 6 récents et résume les anciens ; couper ici
    // rendait le résumé local inatteignable.
    expect(payload?.history).toHaveLength(9);
    expect(payload?.proceedAnyway).toBe(false);
    expect(payload?.history.map((item) => item.text)).toEqual([
      "tour-0",
      "tour-1",
      "tour-2",
      "tour-3",
      "tour-4",
      "tour-5",
      "tour-6",
      "tour-7",
      "tour-8",
    ]);
    expect(buildTeacherTurn("", "question", "explain", [])).toBeNull();
    expect(buildTeacherTurn("MATHEMATIQUES", "   ", "explain", [])).toBeNull();
    expect(buildTeacherTurn("MATHEMATIQUES", "q".repeat(2500), "explain", [])?.message).toHaveLength(2000);
    // Le geste explicite traverse le pont jusqu'au natif.
    expect(buildTeacherTurn("MATHEMATIQUES", "question", "explain", [], true)?.proceedAnyway).toBe(true);
  });

  test("l'historique garde sources et unsourced des tours professeur (#706)", () => {
    const sourced = teacher({ text: "réponse sourcée" });
    const unsourced = teacher({ text: "réponse libre", sources: [], unsourced: true });
    const history = teacherHistory([studentMessage("question")!, sourced, unsourced]);
    expect(history).toHaveLength(3);
    expect(history[1]).toEqual({
      role: "teacher",
      text: "réponse sourcée",
      sources: ["Cours : chapitre 4"],
      unsourced: false,
    });
    expect(history[2]).toEqual({
      role: "teacher",
      text: "réponse libre",
      sources: [],
      unsourced: true,
    });
  });

  test("l'historique envoyé porte le fil borné à 40 tours, pas 6", () => {
    const messages = Array.from({ length: 46 }, (_, index) =>
      index % 2 === 0 ? studentMessage(`question-${index}`)! : teacher({ text: `réponse-${index}` }),
    );
    const history = teacherHistory(messages);
    expect(history).toHaveLength(40);
    expect(history[history.length - 1]?.text).toBe("réponse-45");
    expect(teacherThreadPayload("MATHEMATIQUES", messages).messages).toHaveLength(40);
  });

  test("une réponse ok sans texte devient une erreur, jamais un tour vide", () => {
    const result = parseTeacherTurnResult({ ok: true, answer: "   ", sources: [] });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("n’a pas répondu");
  });

  test("les sources citées et le contexte sont bornés", () => {
    const result = parseTeacherTurnResult({
      ok: true,
      answer: "Voici une piste.",
      sources: ["Cours : chapitre 4", "Cours : chapitre 4", "x".repeat(300)],
      context: [SOURCE, { type: "inconnu", label: "", chars: -1, truncated: false }],
      contextChars: 999999,
      historyCount: 999,
      summaryChars: 99999,
    });
    expect(result.sources).toEqual(["Cours : chapitre 4", "x".repeat(200)]);
    expect(result.context).toHaveLength(1);
    expect(result.historyCount).toBe(6);
    expect(result.summaryChars).toBe(1000);
  });

  test("rejeter une réponse ne touche que le tour du professeur", () => {
    const messages = [studentMessage("Question")!, teacher()];
    expect(rejectTeacherAnswer(messages, 1)).toHaveLength(1);
    expect(rejectTeacherAnswer(messages, 0)).toHaveLength(2);
    expect(rejectTeacherAnswer(messages, 9)).toHaveLength(2);
  });

  test("les sources du tour et l'historique sont séparés pour « Ce qui est envoyé »", () => {
    const message = teacher({
      context: [
        SOURCE,
        { type: "history", label: "Historique : 1 — eleve", chars: 40, truncated: false },
      ],
    });
    expect(turnSources(message).map((source) => source.type)).toEqual(["course"]);
    expect(historySources(message).map((source) => source.type)).toEqual(["history"]);
  });

  test("classe les erreurs du pont avec un message et un geste", () => {
    expect(classifyTeacherFailure({ ok: false, code: "key", message: "clé" }).kind).toBe("key");
    expect(classifyTeacherFailure({ ok: false, code: "quota", message: "429" }).kind).toBe("quota");
    expect(classifyTeacherFailure({ ok: false, code: "timeout", message: "" }).kind).toBe("timeout");
    expect(classifyTeacherFailure({ ok: false, code: "empty", message: "" }).kind).toBe("empty");
    expect(classifyTeacherFailure({ ok: false, refused: true, message: "Aucune source" }).kind).toBe("refused");
    expect(classifyTeacherFailure({ ok: false, message: "boom" }).kind).toBe("unavailable");
  });

  test("rejeter pendant le vol : la réponse ne ressuscite pas le tour rejeté (#751)", () => {
    const rejected = teacher({ text: "réponse non sourcée", sources: [], unsourced: true });
    // L'envoi a capturé ce fil AVANT la réponse ; l'élève rejette le tour non
    // sourcé pendant que le professeur rédige.
    const inFlight = [studentMessage("Question 1")!, rejected, studentMessage("Question 2")!];
    const current = rejectTeacherAnswer(inFlight, 1);
    const after = appendTeacherAnswer(current, teacher({ text: "Nouvelle réponse" }));
    expect(after.map((message) => message.text)).not.toContain("réponse non sourcée");
    expect(after[after.length - 1]?.text).toBe("Nouvelle réponse");
    // L'instantané d'avant le rejet, lui, l'aurait ramené à l'écran et sur le disque.
    expect(appendTeacherAnswer(inFlight, teacher({ text: "Nouvelle réponse" })).map((m) => m.text)).toContain(
      "réponse non sourcée",
    );
  });

  test("les écritures du fil passent l'une après l'autre (#751)", async () => {
    const write = teacherWriteQueue();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = write(async () => {
      log.push("enregistrement:début");
      await gate;
      log.push("enregistrement:fin");
    });
    const remove = write(async () => {
      log.push("suppression");
    });
    await Promise.resolve();
    // La suppression n'a pas doublé l'enregistrement encore en cours.
    expect(log).toEqual(["enregistrement:début"]);
    release();
    await save;
    await remove;
    expect(log).toEqual(["enregistrement:début", "enregistrement:fin", "suppression"]);
  });

  test("une écriture en échec n'arrête pas la file (erreurs non fatales)", async () => {
    const write = teacherWriteQueue();
    await expect(
      write(async () => {
        throw new Error("disque plein");
      }),
    ).rejects.toThrow("disque plein");
    await expect(write(async () => "ok")).resolves.toBe("ok");
  });
});

describe("écran Prof — rendu (#633)", () => {
  test("chargement : un statut explicite, jamais une bulle vide", () => {
    const html = renderView({ loading: true });
    expect(html).toContain("Le professeur réfléchit");
    expect(html).toContain("spinner");
    expect(html).toContain("role=\"status\"");
  });

  test("réponse : texte, sources citées et « Ce qui est envoyé »", () => {
    const html = renderView({ messages: [studentMessage("Ma question")!, teacher()] });
    expect(html).toContain("Ma question");
    expect(html).toContain("Repère d&#x27;abord l&#x27;angle droit");
    expect(html).toContain("Cours : chapitre 4");
    expect(html).toContain("Sources :");
    expect(html).toContain("Ce qui est envoyé");
    expect(html).toContain("120 caractères");
    expect(html).toContain("Historique :");
    expect(html).not.toContain("non sourcée");
  });

  test("réponse non sourcée : badge + rejet possible", () => {
    const html = renderView({ messages: [studentMessage("Ma question")!, teacher({ sources: [], unsourced: true })] });
    expect(html).toContain("non sourcée");
    expect(html).toContain("Rejeter la réponse");
  });

  test("erreur : message + réessayer", () => {
    const html = renderView({ error: { kind: "timeout", message: "Le professeur a mis trop de temps." } });
    expect(html).toContain("Le professeur a mis trop de temps.");
    expect(html).toContain("Réessayer");
    expect(html).toContain("role=\"alert\"");
  });

  test("refus du corpus : message + action stable", () => {
    const html = renderView({
      refusal: { message: "Aucune source exploitable : ajoute un cours au cahier.", actions: ["add_course"] },
    });
    expect(html).toContain("Aucune source exploitable");
    expect(html).toContain("Ajouter un cours au cahier");
    // La continuation explicite est le libellé EXACT demandé.
    expect(teacherActionLabel("proceed_anyway")).toBe("Procéder quand même");
  });

  test("focus : le dernier tour du professeur est une cible programmatique", () => {
    const html = renderView({ messages: [studentMessage("Ma question")!, teacher()] });
    expect(html).toMatch(/tabindex="-1"[^>]*class="teacher-bubble teacher-bubble--teacher"/);
  });

  test("les actions de discussion et l'onglet Exercices sont présents", () => {
    const html = renderView();
    expect(html).toContain("Nouvelle discussion");
    expect(html).toContain("Supprimer");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Exercices");
    const exercises = renderView({ tab: "exercises" });
    expect(exercises).toContain("Les exercices arrivent bientôt");
    // La coquille ne fabrique pas un faux écran de discussion.
    expect(exercises).not.toContain("Matière du cours");
    // Branché au pont (#632), l'onglet rend le panneau réel.
    const wired = renderView({ tab: "exercises", exercisesPanel: createElement("p", null, "Liste d’exercices réelle") });
    expect(wired).toContain("Liste d’exercices réelle");
    expect(wired).toContain('id="teacher-panel-exercises"');
    expect(wired).not.toContain("Les exercices arrivent bientôt");
  });

  test("le sélecteur de matière et les deux modes sont accessibles", () => {
    const html = renderView();
    expect(html).toContain("Matière du cours");
    expect(html).toContain("Explique-moi");
    expect(html).toContain("Corrige-moi");
  });
});

describe("écran Prof — câblage (#633)", () => {
  const WEB = join(ROOT, "web", "src");
  const route = readFileSync(join(WEB, "features", "teacher", "TeacherRoute.tsx"), "utf8");
  const view = readFileSync(join(WEB, "features", "teacher", "TeacherScreen.tsx"), "utf8");

  test("l'envoi passe par le pont, jamais un réseau direct", () => {
    expect(route).toContain("bridge.teacherTurn(params)");
    expect(route).toContain("bridge.teacherThread()");
    expect(route).toContain("bridge.saveTeacherThread(");
    expect(route).toContain("bridge.deleteTeacherThread()");
    expect(route).not.toMatch(/\bfetch\(|WebSocket|EventSource/);
  });

  test("après une réponse, le focus va au dernier tour du professeur", () => {
    expect(view).toContain("answerRef.current.focus({ preventScroll: true })");
    expect(view).toContain("focusTick");
    expect(view).toContain("tabIndex={message.role === \"teacher\" ? -1 : undefined}");
  });

  test("la réponse est rendue par le markdown sûr, jamais du HTML brut", () => {
    expect(view).toContain("<MarkdownBody text={message.text} />");
    const files = ["TeacherScreen.tsx", "TeacherRoute.tsx", "teacher.ts"];
    for (const file of files) {
      const source = readFileSync(join(WEB, "features", "teacher", file), "utf8");
      expect(source).not.toContain("dangerouslySetInnerHTML");
      expect(source).not.toMatch(/\bfetch\(|WebSocket|EventSource/);
    }
  });

  test("le fil est chargé et supprimé par le pont, avec une confirmation", () => {
    expect(route).toContain("<Dialog");
    expect(route).toContain("Supprimer la discussion ?");
    expect(route).toContain("clearThread");
  });
});
