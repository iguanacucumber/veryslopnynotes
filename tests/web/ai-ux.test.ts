import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { llmSaveError } from "../../web/src/features/settings/model";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("IA — refus d'enregistrement de la clé", () => {
  test("le message natif précis fait foi (clé courte, caractère interdit…)", () => {
    expect(llmSaveError({ ok: false, message: "Caractère interdit dans la clé." })).toBe(
      "Caractère interdit dans la clé.",
    );
    expect(llmSaveError({ ok: false, message: "Clé LLM trop longue." })).toBe("Clé LLM trop longue.");
  });

  test("un refus sans message garde un repli compréhensible", () => {
    expect(llmSaveError({ ok: false })).toContain("Clé refusée");
    expect(llmSaveError({ ok: false, message: "   " })).toContain("Clé refusée");
    expect(llmSaveError({ ok: true })).toBe("");
  });

  test("l'écran Réglages affiche ce message au lieu d'un diagnostic générique", () => {
    const settings = source("features/settings/SettingsScreen.tsx");
    expect(settings).toContain("llmSaveError(response)");
    expect(settings).not.toContain('setLlmError("Clé refusée : vérifie');
    // La clé part chez le fournisseur : l'écran ne peut pas dire l'inverse.
    expect(settings).not.toContain("ne quitte jamais cet appareil");
    expect(settings).toContain("directement au");
  });
});

describe("IA — aide devoirs", () => {
  const tasks = source("features/tasks/TasksScreen.tsx");

  test("fermer l'aide ignore la réponse en vol (pas de réouverture tardive)", () => {
    const close = between(tasks, "function closeHelp()", "async function generateSheet");
    expect(close).toContain("helpSeq.current += 1");
    expect(close).toContain("setHelp(null)");
  });

  test("un seul assistant en vol : les boutons croisés sont fermés (#597)", () => {
    // Pendant une photo, « Aide devoirs » ne lance pas un 2e appel LLM ;
    // pendant l'aide texte, « Photo de l'énoncé » n'ouvre pas la caméra.
    // Chaque panneau reste fermable : le bouton actif garde son « Fermer ».
    expect(tasks).toContain("const helpLoading = help?.loading === true;");
    expect(tasks).toContain(
      "const textOffWhilePhoto = textOff || (helpLoading && help?.photo === true);",
    );
    expect(tasks).toContain(
      "const photoOffWhileText = photoOff || (helpLoading && help?.photo !== true);",
    );
    expect(tasks).toContain("disabled={textOffWhilePhoto}");
    expect(tasks).toContain("disabled={photoOffWhileText}");
  });

  test("pendant la vérification, l'écran ne dit pas déjà « désactivé »", () => {
    expect(tasks).toContain("const assistantChecking = llm.configured === null");
    expect(tasks).toContain("{assistantChecking ? (");
    expect(tasks).toContain("Assistant devoirs");
  });

  test("un devoir peut générer sa fiche par le pont existant, semaine affichée incluse (#369, #596)", () => {
    expect(tasks).toContain("bridge.generateRevision(assignment.id, week)");
    expect(tasks).toContain('navigate("/fiches")');
    expect(tasks).toContain("Fiche de révision");
  });
});

describe("IA — fiches de révision", () => {
  const fiches = source("features/revisions/RevisionSheets.tsx");

  test("l'état vide mène aux devoirs au lieu de promettre une génération automatique", () => {
    expect(fiches).not.toContain("générée automatiquement");
    expect(fiches).toContain('navigate("/tasks")');
    expect(fiches).toContain("PageHeading");
  });
});
