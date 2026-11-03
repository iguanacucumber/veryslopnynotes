import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCall } from "../../web/src/bridge/mock";
import { assignmentHasAssistantMaterial } from "../../web/src/features/tasks/assignments";
import { manualCanSave, manualPromptDue, manualSaveNotice } from "../../web/src/features/settings/model";
import { readBridgeSource } from "../unit/fixtures/bridge-source";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("manuel — invitation UNE seule fois", () => {
  const prompt = source("features/settings/ManualPrompt.tsx");

  test("l'invitation attend l'assistant ET un serveur configuré", () => {
    const base = {
      llmConfigured: true,
      serverHost: "scraper.exemple",
      manualConfigured: false,
      manualUrl: "",
      manualPromptSeen: false,
    };
    expect(manualPromptDue(base)).toBe(true);
    // Sans serveur, l'adresse ne pourrait pas être récupérée : aucune relance.
    expect(manualPromptDue({ ...base, serverHost: "" })).toBe(false);
    expect(manualPromptDue({ ...base, serverHost: "   " })).toBe(false);
    expect(manualPromptDue({ ...base, llmConfigured: false })).toBe(false);
    expect(manualPromptDue({ ...base, manualConfigured: true })).toBe(false);
    expect(manualPromptDue({ ...base, manualUrl: "https://manuel.exemple.fr" })).toBe(false);
    expect(manualPromptDue({ ...base, manualPromptSeen: true })).toBe(false);
    expect(prompt).toContain("manualPromptDue(snapshot)");
  });

  test("« Plus tard » persiste le refus, l'adresse passe par le pont natif", () => {
    expect(prompt).toContain("bridge.dismissManualPrompt()");
    expect(prompt).toContain("bridge.saveManualUrl(value)");
    // Aucun stockage dans la WebView : le natif seul garde l'adresse.
    expect(prompt).not.toContain("localStorage");
  });

  test("l'adresse part VIDE et la section Avancé garde le champ", () => {
    expect(source("features/home/HomeScreen.tsx")).toContain("<ManualPrompt />");
    const prompt = source("features/settings/ManualPrompt.tsx");
    expect(prompt).toContain('useState("")');
    expect(prompt).not.toContain("DEFAULT_MANUAL_URL");
    const settings = source("features/settings/ManualCard.tsx");
    expect(settings).toContain("bridge.saveManualUrl(value)");
    expect(settings).toContain("bridge.saveManualUrl(\"\")");
    expect(settings).toContain("MAX_MANUAL_URL_CHARS");
    expect(settings).toContain('useState("")');
    expect(settings).not.toContain("DEFAULT_MANUAL_URL");
  });

  test("aucun catalogue d'éditeur n'est prérempli dans la WebView", () => {
    // #961 : le défaut historique ne doit pas revenir par un import ou une copie.
    const hits = [...new Glob("**/*.{ts,tsx}").scanSync(WEB)].filter((file) =>
      readFileSync(join(WEB, file), "utf8").toLowerCase().includes("lelivrescolaire"),
    );
    expect(hits).toEqual([]);
  });
});

describe("manuel — attestation avant enregistrement", () => {
  test("une adresse vide ou une attestation absente bloque l'enregistrement", () => {
    expect(manualCanSave("", true)).toBe(false);
    expect(manualCanSave("   ", true)).toBe(false);
    expect(manualCanSave("https://manuel.exemple.fr/chapitre", false)).toBe(false);
    expect(manualCanSave("https://manuel.exemple.fr/chapitre", true)).toBe(true);
  });

  test("les deux écrans demandent l'attestation et la copie ne pousse plus de défaut", () => {
    for (const file of ["features/settings/ManualCard.tsx", "features/settings/ManualPrompt.tsx"]) {
      const text = source(file);
      expect(text).toContain('type="checkbox"');
      expect(text).toContain("MANUAL_RIGHTS_ATTESTATION");
      expect(text).toContain("manualCanSave(");
      expect(text).not.toContain("Garde l’adresse du catalogue");
      expect(text).not.toContain("adresse par défaut");
    }
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
    expect(bridge).toContain("manualDocsFor(assignment.subject, assignment.manualPages())");
    // Une page non résolue reste manquante : jamais servir la page 1 sous « p 192 ».
    expect(bridge).toContain("doc.page == page");
    expect(bridge).toContain("doc.page != page");
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

  test("une adresse de catalogue saisie active le choix automatique par classe/matière", async () => {
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
