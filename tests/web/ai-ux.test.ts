import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { llmSaveError } from "../../web/src/features/settings/model";
import { cardActionFlags } from "../../web/src/features/tasks/actions";

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
    const keyCard = source("features/settings/AssistantCards.tsx");
    expect(keyCard).toContain("llmSaveError(response)");
    expect(keyCard).not.toContain('setLlmError("Clé refusée : vérifie');
    // La clé part chez le fournisseur : l'écran ne peut pas dire l'inverse.
    expect(keyCard).not.toContain("ne quitte jamais cet appareil");
    expect(keyCard).toContain("directement au");
  });
});

describe("IA — aide devoirs", () => {
  const tasks = source("features/tasks/TasksScreen.tsx");
  const chat = source("features/tasks/HomeworkChat.tsx");

  test("fermer l'aide ignore la réponse en vol (pas de réouverture tardive)", () => {
    const close = between(tasks, "function closeHelp()", "async function generateSheet");
    expect(close).toContain("helpSeq.current += 1");
    expect(close).toContain("setHelp(null)");
  });

  test("un seul assistant en vol : les boutons croisés sont fermés (#597, #749)", () => {
    // Pendant une photo, « Aide devoirs » ne lance pas un 2e appel LLM ;
    // pendant l'aide texte, « Photo de l'énoncé » n'ouvre pas la caméra.
    // Chaque panneau reste fermable : le bouton actif garde son « Fermer ».
    expect(tasks).toContain("const assistantBusy = helpFlights > 0 || revisionBusy;");
    expect(tasks).toContain("assistantBusy={assistantBusy}");
    expect(tasks).toContain("disabled={textOff}");
    expect(tasks).toContain("disabled={photoOff}");
    expect(tasks).toContain("disabled={sheetOff}");
  });

  test("fermer le panneau pendant le vol ne rouvre pas les cartes (#751)", () => {
    // Le bug : `help` retombait à null, donc `assistantBusy` aussi, et un 2e
    // appel payé partait pendant que le premier tournait encore.
    expect(tasks).toContain("const [helpFlights, setHelpFlights] = useState(0);");
    expect(tasks).not.toContain("const assistantBusy = help?.loading === true");
    // Chaque vol se compte AVANT l'appel et se règle dans `finally` : réponse,
    // erreur, annulation et rejet du pont retombent tous.
    const ask = between(tasks, "async function askHelp", "async function askPhoto");
    expect(ask).toContain("setHelpFlights((count) => count + 1)");
    expect(ask).toContain("setHelpFlights((count) => Math.max(0, count - 1))");
    const photo = between(tasks, "async function askPhoto", "function closeHelp");
    expect(photo).toContain("setHelpFlights((count) => count + 1)");
    expect(photo).toContain("setHelpFlights((count) => Math.max(0, count - 1))");
  });

  test("une demande en vol ferme TOUTES les cartes, pas seulement la sienne (#749)", () => {
    // Le bug : `help` est nul pour les autres cartes, donc leur bouton restait
    // actif et lançait un 2e appel LLM payé dont la 1re réponse était jetée.
    const other = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: true,
      hasPanel: false,
      helpLoading: false,
      helpPhoto: false,
      assistantBusy: true,
    });
    expect(other).toEqual({ textOff: true, photoOff: true, sheetOff: true });
    // La carte en vol garde son bouton « Fermer » : la demande reste annulable.
    const loading = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: true,
      hasPanel: true,
      helpLoading: true,
      helpPhoto: false,
      assistantBusy: true,
    });
    expect(loading).toEqual({ textOff: false, photoOff: true, sheetOff: true });
    // Une photo en vol ferme « Aide devoirs » (un 2e appel partirait) ;
    // « Photo de l’énoncé » reste le bouton « Fermer ».
    const loadingPhoto = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: true,
      hasPanel: true,
      helpLoading: true,
      helpPhoto: true,
      assistantBusy: true,
    });
    expect(loadingPhoto).toEqual({ textOff: true, photoOff: false, sheetOff: true });
    // Réponse reçue : le panneau reste ouvert, les cartes se rouvrent.
    const answered = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: true,
      hasPanel: true,
      helpLoading: false,
      helpPhoto: false,
      assistantBusy: false,
    });
    expect(answered).toEqual({ textOff: false, photoOff: false, sheetOff: false });
    // Panneau fermé PENDANT le vol : `help` est nul, mais l'appel payé tourne
    // encore — toutes les cartes restent fermées (#751).
    const closedWhileFlying = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: true,
      hasPanel: false,
      helpLoading: false,
      helpPhoto: false,
      assistantBusy: true,
    });
    expect(closedWhileFlying).toEqual({ textOff: true, photoOff: true, sheetOff: true });
    // Vol réglé (erreur, annulation, pont rejeté) : plus rien n'est bloqué.
    const idle = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: true,
      hasPanel: false,
      helpLoading: false,
      helpPhoto: false,
      assistantBusy: false,
    });
    expect(idle).toEqual({ textOff: false, photoOff: false, sheetOff: false });
    // Sans cours ni manuel, l'aide texte reste ouverte : le pont refuse sans
    // appel payant puis propose « Procéder quand même ». La fiche, elle, n'a
    // pas de continuation non sourcée et reste fermée.
    const noMaterial = cardActionFlags({
      assistantDisabled: false,
      hasMaterial: false,
      hasPanel: false,
      helpLoading: false,
      helpPhoto: false,
      assistantBusy: false,
    });
    expect(noMaterial).toEqual({ textOff: false, photoOff: false, sheetOff: true });
  });

  test("le choix photo est un dialogue unique, annulable sans appel (#610)", () => {
    expect(tasks).toContain("<Dialog");
    expect(tasks).toContain("Prendre une photo");
    expect(tasks).toContain("Choisir des images");
    expect(tasks).toContain("Annuler");
    expect(tasks).toContain("Jusqu’à 3 photos depuis la galerie");
    expect(tasks).toContain('aria-haspopup="dialog"');
    const cancel = between(tasks, "function closePhotoChooser()", "function choosePhoto");
    expect(cancel).toContain("setPhotoChooser(null)");
    expect(cancel).not.toContain("askPhoto");
    const choose = between(tasks, "function choosePhoto", "async function generateSheet");
    expect(choose).toContain("askPhoto(assignment, source)");
  });

  test("rouvrir l'aide devoirs relit le fil gardé, sans nouvel appel", () => {
    expect(tasks).toContain("threadsRef.current.get(assignment.id)");
    expect(tasks).toContain("const kept = storedThread(help)");
    expect(tasks).toContain("onHelp={() => openHelp(assignment)}");
  });

  test("régénérer remplace la réponse, sans doubler badge ni sources", () => {
    expect(chat).toContain("Régénérer");
    expect(chat).toContain("{!state.loading && last.answer ? (");
    const turn = between(chat, "function AssistantTurn", "export function HomeworkChat");
    expect(turn).not.toContain("hw-unsourced__badge");
    expect(chat).not.toContain("aiContextTypeFr(source.type)");
    expect(chat).not.toContain("Contexte : {last.context.length}");
  });

  test("le chat est un dialogue modal qui rend le focus (#610)", () => {
    const dialog = source("ui/Dialog.tsx");
    expect(tasks).toContain("<HomeworkChat");
    expect(chat).toContain("<Dialog");
    expect(chat).toContain('className="dialog--chat"');
    expect(dialog).toContain("restoreRef.current?.focus()");
    expect(dialog).toContain('aria-label="Fermer"');
    expect(chat).toContain("aria-busy={state.loading}");
    expect(chat).toContain("L’assistant travaille");
    expect(chat).toContain('className="spinner"');
  });

  test("un refus mène au cahier, jamais au corps brut (#610)", () => {
    expect(chat).toContain("Ajouter un cours au cahier");
    expect(tasks).toContain('onAddCourse={() => navigate("/course-notes")}');
    const turn = between(chat, "function AssistantTurn", "export function HomeworkChat");
    expect(turn).toContain("{turn.refusal}");
    expect(turn).toContain('action === "add_course"');
    expect(chat).not.toContain("result.body");
    expect(tasks).not.toContain("result.body");
  });

  test("la réponse passe par le markdown sûr, sans divulguer l'envoi (#610)", () => {
    expect(chat).not.toContain("Ce qui est envoyé");
    expect(chat).toContain("<MarkdownBody text={turn.answer} />");
    expect(chat).not.toContain("dangerouslySetInnerHTML");
    expect(chat).not.toContain("innerHTML");
  });

  test("pendant la vérification, l'écran ne dit pas déjà « désactivé »", () => {
    expect(tasks).toContain("const assistantChecking = llm.configured === null");
    expect(tasks).toContain("{assistantChecking ? (");
    expect(tasks).toContain("Assistant devoirs");
  });

  test("un devoir peut générer sa fiche par le pont existant, semaine affichée incluse (#369, #596)", () => {
    expect(tasks).toContain("bridge.generateRevision(assignment.id, week)");
    expect(tasks).toContain('navigate("/revision-sheets")');
    expect(tasks).toContain("Fiche de révision");
  });
});

describe("IA — fiches de révision", () => {
  const sheets = source("features/revisions/RevisionSheets.tsx");

  test("l'état vide mène aux devoirs au lieu de promettre une génération automatique", () => {
    expect(sheets).not.toContain("générée automatiquement");
    expect(sheets).toContain('navigate("/tasks")');
    expect(sheets).toContain("PageHeading");
  });
});
