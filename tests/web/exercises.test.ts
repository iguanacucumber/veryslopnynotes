// #632 : l'onglet Exercices rend des énoncés VERBATIM, propose les trois
// niveaux d'aide et ne demande jamais la correction complète tout seul.
import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExerciseItem, TeacherMessage } from "../../web/src/bridge/types";
import {
  ExercisesView,
  helpAnswerApplies,
  type ExerciseHelpState,
  type ExercisesViewProps,
} from "../../web/src/features/teacher/ExercisesScreen";

useParisTz();

const ROUTE = join(
  import.meta.dir,
  "..",
  "..",
  "web",
  "src",
  "features",
  "teacher",
  "ExercisesRoute.tsx",
);

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

function exercise(over: Partial<ExerciseItem> = {}): ExerciseItem {
  return {
    number: "12",
    statement: "Calculer la somme des termes d'une suite arithmétique de raison 3.",
    page: 84,
    difficulty: "facile",
    source: "Manuel : Mathématiques 1re",
    ...over,
  };
}

const IDLE_HELP: ExerciseHelpState = {
  loading: false,
  mode: null,
  message: null,
  error: null,
  refusal: null,
  answer: "",
};

function answer(over: Partial<TeacherMessage> = {}): TeacherMessage {
  return {
    role: "teacher",
    text: "Commence par écrire la formule de la somme.",
    sources: ["Manuel : Mathématiques 1re"],
    unsourced: false,
    context: [{ type: "manual", label: "Manuel : Mathématiques 1re", chars: 1200, truncated: false }],
    ...over,
  };
}

function renderView(over: Partial<ExercisesViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ExercisesView, {
      subjects: ["MATHEMATIQUES"],
      subject: "MATHEMATIQUES",
      hint: "",
      proposal: {
        loading: false,
        error: "",
        data: {
          ok: true,
          exercises: [exercise()],
          manual: true,
          manualReady: true,
          manualTitle: "Mathématiques 1re",
          manualPage: 84,
        },
      },
      selected: exercise(),
      help: IDLE_HELP,
      onSubjectChange: () => {},
      onHintChange: () => {},
      onPropose: () => {},
      onSelect: () => {},
      onHelp: () => {},
      onAnswerChange: () => {},
      onPhoto: () => {},
      onRetry: () => {},
      onAction: () => {},
      ...over,
    } satisfies ExercisesViewProps),
  );
}

describe("exercices — liste et choix (#632)", () => {
  test("l'énoncé est VERBATIM, avec page, difficulté et source", () => {
    const html = renderView();
    expect(html).toContain("Calculer la somme des termes");
    expect(html).toContain("Exercice 12");
    expect(html).toContain("p. 84");
    expect(html).toContain("facile");
    expect(html).toContain("Manuel : Mathématiques 1re");
    expect(html).toContain('aria-pressed="true"');
  });

  test("un champ page/chapitre FILTRE, sans promettre un autre manuel", () => {
    const html = renderView({ hint: "84" });
    expect(html).toContain("Page ou chapitre");
    expect(html).toContain("Aucun exercice n’est inventé");
  });

  test("sans source, l'écran le dit et propose une action", () => {
    const html = renderView({
      proposal: {
        loading: false,
        error: "",
        data: {
          ok: true,
          exercises: [],
          manual: false,
          manualReady: false,
          message: "Aucun exercice numéroté lisible dans le manuel ou le cahier de cette matière.",
          actions: ["enable_manual", "add_course"],
        },
      },
      selected: null,
    });
    expect(html).toContain("Aucun exercice numéroté lisible");
    expect(html).toContain("Activer le manuel");
    expect(html).toContain("Ajouter un cours au cahier");
    expect(html).not.toContain("exercise-detail");
  });

  test("une erreur de proposition propose de réessayer", () => {
    const html = renderView({
      proposal: { loading: false, error: "Téléphone injoignable : réessaie.", data: null },
      selected: null,
    });
    expect(html).toContain("Téléphone injoignable");
    expect(html).toContain("Réessayer");
  });
});

describe("exercices — aide progressive (#632)", () => {
  test("les trois niveaux sont EXPLICITES, la correction n'est pas le défaut", () => {
    const html = renderView();
    expect(html).toContain("Indice");
    expect(html).toContain("Méthode");
    expect(html).toContain("Correction complète");
    // Aucun clic : rien n'est demandé, rien n'est affiché.
    expect(html).toContain("Un seul indice, sans la solution.");
    expect(html).not.toContain("exercise-answer");
  });

  test("la photo de la réponse est une entrée possible", () => {
    const html = renderView();
    expect(html).toContain("Photographier ma réponse");
    expect(html).toContain("Depuis la galerie");
    expect(html).toContain("textarea");
  });

  test("une aide source cite ses libellés sans détail d'envoi", () => {
    const html = renderView({
      help: { ...IDLE_HELP, mode: "hint", message: answer() },
    });
    expect(html).toContain("Commence par écrire la formule");
    expect(html).toContain("Sources :");
    expect(html).toContain("Manuel : Mathématiques 1re");
    expect(html).not.toContain("Ce qui est envoyé");
    expect(html).not.toContain("non sourcée");
  });

  test("une aide sans citation est marquée non sourcée", () => {
    const html = renderView({
      help: { ...IDLE_HELP, mode: "method", message: answer({ sources: [], unsourced: true }) },
    });
    expect(html).toContain("non sourcée");
  });

  test("un refus porte ses actions contextuelles", () => {
    const html = renderView({
      help: {
        ...IDLE_HELP,
        mode: "correction",
        refusal: { message: "Aucune source pour cet exercice.", actions: ["add_course"] },
      },
    });
    expect(html).toContain("Aucune source pour cet exercice.");
    expect(html).toContain("Ajouter un cours au cahier");
  });

  test("une erreur d'aide propose de réessayer sans bulle vide", () => {
    const html = renderView({
      help: { ...IDLE_HELP, mode: "hint", error: { kind: "quota", message: "Quota atteint." } },
    });
    expect(html).toContain("Quota atteint.");
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("exercise-answer");
  });
});

describe("exercices — aide en vol (#751)", () => {
  test("une réponse tardive d'un AUTRE exercice est jetée", () => {
    const request = { seq: 3, number: "12" };
    // Clic sur l'exercice 13 pendant le vol : séquence ET sélection changent.
    expect(helpAnswerApplies(request, { seq: 4, number: "13" })).toBe(false);
    // Même exercice, mais demande invalidée (fermeture, nouvelle proposition).
    expect(helpAnswerApplies(request, { seq: 4, number: "12" })).toBe(false);
    // Demande toujours courante : la réponse s'affiche.
    expect(helpAnswerApplies(request, { seq: 3, number: "12" })).toBe(true);
  });

  test("le nouvel exercice reste vide : ni correction ni source héritée", () => {
    const html = renderView({ selected: exercise({ number: "13" }), help: IDLE_HELP });
    expect(html).toContain("Exercice 13");
    expect(html).not.toContain("exercise-answer");
  });

  test("sélectionner un exercice invalide la demande en vol", () => {
    const select = between(readFileSync(ROUTE, "utf8"), "function select(", "async function ask(");
    expect(select).toContain("seq.current += 1");
    expect(select).toContain("lastRequest.current = null");
    expect(select).toContain("setHelp(EMPTY_HELP)");
  });
});
