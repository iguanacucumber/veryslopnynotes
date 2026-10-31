import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import { assignmentHasAssistantMaterial } from "../../web/src/features/tasks/assignments";
import { manualSaveNotice } from "../../web/src/features/settings/model";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("manuel — invitation UNE seule fois", () => {
  const prompt = source("features/settings/ManualPrompt.tsx");

  test("l'invitation n'apparaît que si l'assistant est utile, et jamais deux fois", () => {
    expect(prompt).toContain("snapshot.llmConfigured === true");
    expect(prompt).toContain("snapshot.manualConfigured !== true");
    expect(prompt).toContain('(snapshot.manualUrl ?? "") === ""');
    expect(prompt).toContain("snapshot.manualPromptSeen !== true");
  });

  test("« Plus tard » persiste le refus, l'adresse passe par le pont natif", () => {
    expect(prompt).toContain("bridge.dismissManualPrompt()");
    expect(prompt).toContain("bridge.saveManualUrl(value)");
    // Aucun stockage dans la WebView : le natif seul garde l'adresse.
    expect(prompt).not.toContain("localStorage");
  });

  test("l'invitation part du catalogue et Réglages garde le champ", () => {
    expect(source("features/home/HomeScreen.tsx")).toContain("<ManualPrompt />");
    const prompt = source("features/settings/ManualPrompt.tsx");
    expect(prompt).toContain("useState(DEFAULT_MANUAL_URL)");
    const settings = source("features/settings/ManualCard.tsx");
    expect(settings).toContain("bridge.saveManualUrl(value)");
    expect(settings).toContain("bridge.saveManualUrl(\"\")");
    expect(settings).toContain("MAX_MANUAL_URL_CHARS");
    expect(settings).toContain("DEFAULT_MANUAL_URL");
  });
});

describe("manuel — source de l'assistant", () => {
  test("un manuel récupéré suffit à activer l'aide, même sans consigne", () => {
    const empty = { description: "", lessonContent: null };
    expect(assignmentHasAssistantMaterial(empty, false)).toBe(false);
    expect(assignmentHasAssistantMaterial(empty, true)).toBe(true);
    // #586 : un cours du cahier pour la matière suffit aussi.
    expect(assignmentHasAssistantMaterial(empty, false, true)).toBe(true);
  });

  test("l'écran Tâches tient compte du manuel sans divulguer l'envoi", () => {
    const tasks = source("features/tasks/TasksScreen.tsx");
    const chat = source("features/tasks/HomeworkChat.tsx");
    expect(tasks).toContain("assignmentHasAssistantMaterial(assignment, manualReady, lessonReady)");
    expect(chat).not.toContain("Ce qui est envoyé");
    // Le natif ajoute l'extrait aux DEUX pipelines IA.
    const bridge = readBridgeSource();
    // #628 : le manuel brut entre dans l'assembleur unique (coupe signalée),
    // au lieu d'une source déjà tronquée à 2 000 caractères.
    expect(bridge).toContain("AiContext.manual(doc.title, doc.excerpt)");
    expect(bridge).toContain("manualDocFor(assignment.subject)");
  });
});

describe("manuel — phrases d'enregistrement", () => {
  test("le message natif fait foi et la gravité suit le scraper", () => {
    expect(manualSaveNotice({ ok: true, auto: true, level: "Terminale", specialties: ["NSI"] })).toEqual({
      notice: "Manuel automatique activé (Terminale · NSI).",
      kind: "info",
    });
    expect(manualSaveNotice({ ok: true, auto: true }).notice).toContain("l’ouvrage suivra");
    expect(manualSaveNotice({ ok: true, ready: true }).kind).toBe("info");
    expect(manualSaveNotice({ ok: true })).toEqual({
      notice: "Adresse enregistrée, mais le manuel n'a pas pu être récupéré.",
      kind: "error",
    });
    expect(manualSaveNotice({ ok: true, message: "Adresse incomplète." }).notice).toBe("Adresse incomplète.");
  });
});

describe("manuel — pont factice", () => {
  test("enregistrer une adresse la garde et marque l'invitation vue", async () => {
    const saved = (await mockCall("settings.saveManualUrl", {
      url: "https://manuel.exemple.fr/chapitre",
    })) as { ok: boolean; ready?: boolean };
    expect(saved.ok).toBe(true);
    expect(saved.ready).toBe(true);
    const snapshot = (await mockCall("settings.get", {})) as {
      manualUrl: string;
      manualReady: boolean;
      manualPromptSeen: boolean;
    };
    expect(snapshot.manualUrl).toBe("https://manuel.exemple.fr/chapitre");
    expect(snapshot.manualReady).toBe(true);
    expect(snapshot.manualPromptSeen).toBe(true);

    const cleared = (await mockCall("settings.saveManualUrl", { url: "" })) as {
      ok: boolean;
      ready?: boolean;
      auto?: boolean;
    };
    expect(cleared).toEqual({ ok: true, ready: false, auto: false });
    const after = (await mockCall("settings.get", {})) as {
      manualUrl: string;
      manualReady: boolean;
      manualConfigured: boolean;
    };
    expect(after.manualUrl).toBe("");
    expect(after.manualReady).toBe(false);
    expect(after.manualConfigured).toBe(false);
  });

  test("le catalogue par défaut active le choix automatique par classe/matière", async () => {
    const saved = (await mockCall("settings.saveManualUrl", {
      url: "https://www.lelivrescolaire.fr/manuels",
    })) as { ok: boolean; auto?: boolean; ready?: boolean; level?: string; specialties?: string[] };
    expect(saved.ok).toBe(true);
    expect(saved.auto).toBe(true);
    expect(saved.ready).toBe(false);
    expect(saved.level).toBe("Terminale");
    expect(saved.specialties).toEqual(["Mathématiques", "NSI"]);
    const snapshot = (await mockCall("settings.get", {})) as {
      manualAuto: boolean;
      manualConfigured: boolean;
      manualLevel: string;
      manualSpecialties: string[];
    };
    expect(snapshot.manualAuto).toBe(true);
    expect(snapshot.manualConfigured).toBe(true);
    expect(snapshot.manualLevel).toBe("Terminale");
    expect(snapshot.manualSpecialties).toEqual(["Mathématiques", "NSI"]);
  });

  test("une adresse sans schéma est refusée sans rien écrire", async () => {
    const refused = (await mockCall("settings.saveManualUrl", { url: "manuel.exemple.fr" })) as {
      ok: boolean;
      message?: string;
    };
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("Adresse incomplète");
  });
});
