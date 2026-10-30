import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import { BRIDGE_TIMEOUTS } from "../../web/src/bridge/types";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web", "src");

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

describe("devoirs — photo d'énoncé (#588)", () => {
  test("le pont factice rend un corrigé, jamais une image", async () => {
    const result = await mockCall<{ ok: boolean; answer?: string; steps?: string[]; sources?: string[] }>(
      "llm.solvePhoto",
      {
        assignmentId: "a1",
        weekStart: "2026-10-19",
        source: "camera",
      },
    );
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("Photo lue");
    expect(result.steps?.length).toBeGreaterThan(0);
    expect(result.sources).toContain("Photo de l'énoncé");
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  test("la photo inclut le cadrage : aucun timeout JS, comme le scan QR", () => {
    expect(BRIDGE_TIMEOUTS["llm.solvePhoto"]).toBe(0);
    // La constante native existe : le fil du pont ne pend pas pour toujours.
    const bridge = readBridgeSource();
    expect(bridge).toContain("AWAIT_PHOTO_MS = 180_000L");
    expect(bridge).toContain('"llm.solvePhoto" -> solveHomeworkPhoto(p, epoch)');
  });

  test("l'écran propose la photo même sans consigne ni manuel", () => {
    const tasks = source("features/tasks/TasksScreen.tsx");
    expect(tasks).toContain("bridge.solveHomeworkPhoto");
    expect(tasks).toContain("Photo de l’énoncé");
    expect(tasks).toContain("Prendre une photo");
    expect(tasks).toContain("Choisir une image");
    // Plus de pastille « Galerie » concurrente : un seul bouton photo.
    expect(tasks).not.toContain("Galerie");
    expect(tasks).toContain("const photoOff = assistantDisabled || revisionBusy");
    expect(tasks).toContain("Photographie l’énoncé ci-dessus");
    expect(tasks).toContain("La photo est supprimée après lecture");
    // Le texte reste bloqué sans source ; la photo a sa propre condition.
    expect(tasks).toContain("const textOff = assistantDisabled || !hasMaterial");
  });

  test("un seul bouton photo ouvre le dialogue de source (#610)", () => {
    const tasks = source("features/tasks/TasksScreen.tsx");
    const icons = source("ui/icons.tsx");
    expect(icons).toContain("export const IconImage");
    expect(tasks).toContain("<Dialog");
    expect(tasks).toContain("open={photoChooser !== null}");
    expect(tasks).toContain("onClose={closePhotoChooser}");
    expect(tasks).toContain("La photo part directement au fournisseur");
    expect(tasks).toContain("askPhoto(assignment, source)");
    // Un seul dialogue pour la semaine, rendu APRÈS la liste des cartes.
    expect(tasks.indexOf("<Dialog")).toBeGreaterThan(tasks.lastIndexOf('className="list"'));
    // Annuler ne touche ni au panneau ni à la demande en vol.
    const cancel = between(tasks, "function closePhotoChooser()", "function choosePhoto");
    expect(cancel).toContain("setPhotoChooser(null)");
    expect(cancel).not.toContain("askPhoto");
  });

  test("le natif réutilise les MÊMES sources que l'aide texte", () => {
    const bridge = readBridgeSource();
    // #628 : texte ET photo passent par le même assembleur, avec le même
    // corpus (seul `allowEmpty` distingue la photo). #631 : la semaine et
    // l'époque passent aussi, pour télécharger/écrire les pièces jointes dans
    // le cache du compte.
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.HOMEWORK, week, epoch)");
    expect(bridge).toContain("aiContextFor(assignment, AiContextEntry.PHOTO, week, epoch)");
    expect(bridge).toContain("HomeworkAi.generateHomeworkFromPhoto(");
    expect(bridge).toContain("PhotoPrep.prepare(shot.file)");
    // Aucun enregistrement automatique du corrigé.
    expect(bridge).not.toContain("saveRevisionSheet(store, assembleRevisionSheet");
  });
});
