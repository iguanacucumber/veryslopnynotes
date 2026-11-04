import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DELETE_ALL_ARTIFACTS, failedArtifactLabels } from "../../web/src/features/settings/deleteAll";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

/** Inventaire Kotlin : tout store PURGED, plus les deux stores utilisateur. */
function kotlinDeleteAllIds(): string[] {
  const purge = readFileSync(
    join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data/AccountPurge.kt"),
    "utf8",
  );
  const entries = [...purge.matchAll(/^\s+([A-Z_]+)\("([^"]+)", AccountStorePolicy\.(\w+)\)/gm)];
  return entries
    .filter(
      ([, name, , policy]) =>
        policy === "PURGED" || name === "LLM_KEY" || name === "AI_CONSENT" || name === "SERVER_URL",
    )
    .map(([, , id]) => id!);
}

describe("réglages — suppression totale (#853)", () => {
  test("la confirmation liste CHAQUE store que la purge emporte", () => {
    const listed = DELETE_ALL_ARTIFACTS.map((artifact) => artifact.id);
    expect(new Set(listed)).toEqual(new Set(kotlinDeleteAllIds()));
    expect(listed.length).toBe(kotlinDeleteAllIds().length);
    for (const artifact of DELETE_ALL_ARTIFACTS) {
      expect(artifact.label.trim().length).toBeGreaterThan(0);
      expect(artifact.detail.trim().length).toBeGreaterThan(0);
    }
  });

  test("les artefacts annoncés couvrent la demande de l'issue", () => {
    const text = DELETE_ALL_ARTIFACTS.map((artifact) => `${artifact.label} ${artifact.detail}`).join(" ");
    for (const word of [
      "Session",
      "Cache",
      "Cahier",
      "Pièces jointes",
      "Photos",
      "Manuel",
      "Comptes",
      "WebView",
      "lecture",
      "Clé",
      "Consentement",
      "Serveur",
    ]) {
      expect(text).toContain(word);
    }
  });

  test("un store en échec est nommé, jamais un succès mensonger", () => {
    expect(failedArtifactLabels(["cache", "llm_key"])).toEqual([
      "Cache hors-ligne",
      "Clé de l’assistant",
    ]);
    // Un id inconnu reste lisible plutôt que de disparaître.
    expect(failedArtifactLabels(["futur_store"])).toEqual(["futur_store"]);
  });

  test("l'écran déclenche la purge orchestrée et ferme la session seulement si ok", () => {
    const settings = source("features/settings/SettingsScreen.tsx");
    expect(settings).toContain('id="reglages-donnees"');
    expect(settings).toContain("<DeleteAllCard");

    const card = source("features/settings/DeleteAllCard.tsx");
    expect(card).toContain('role="alertdialog"');
    expect(card).toContain("DELETE_ALL_ARTIFACTS.map");
    expect(card).toContain("bridge.deleteAllData()");
    expect(card).toContain("if (!result.ok)");
    expect(card).toContain("failedArtifactLabels");
    // La fermeture vient APRÈS le verdict : un échec partiel reste affiché.
    expect(card.indexOf("if (!result.ok)")).toBeLessThan(card.indexOf("closeSession();"));
  });
});
