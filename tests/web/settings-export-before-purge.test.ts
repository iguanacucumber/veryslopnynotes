// #858 — l'export est offert AVANT que la purge ne rende la perte définitive.
// Les trois sorties destructrices (déconnexion, bascule de compte, suppression
// totale) partagent la même offre ; continuer sans exporter reste possible.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DELETE_ALL_ARTIFACTS } from "../../web/src/features/settings/deleteAll";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

describe("export avant purge (#858)", () => {
  test("l'inventaire de la purge nomme les données exportables", () => {
    const ids = DELETE_ALL_ARTIFACTS.map((artifact) => artifact.id);
    for (const id of ["course_notes", "teacher_chat", "exports"]) {
      expect(ids).toContain(id);
    }
    const text = DELETE_ALL_ARTIFACTS.map((artifact) => `${artifact.label} ${artifact.detail}`).join(" ");
    for (const label of ["Cahier de cours", "Conversations professeur", "Fiches de révision"]) {
      expect(text).toContain(label);
    }
  });

  test("les trois sorties destructrices offrent l'export", () => {
    for (const path of [
      "features/profile/ProfileScreen.tsx",
      "features/settings/DeleteAllCard.tsx",
      "features/pairing/PairingScreen.tsx",
    ]) {
      const screen = source(path);
      expect(screen).toContain("<ExportBeforePurge state={exportState}");
      expect(screen).toContain("useExportBeforePurge");
    }
    // La bascule n'offre l'export que dans le parcours qui REMPLACE la session.
    const pairing = source("features/pairing/PairingScreen.tsx");
    expect(pairing.indexOf("replacing ?")).toBeGreaterThan(-1);
    expect(pairing.indexOf("<ExportBeforePurge")).toBeGreaterThan(pairing.indexOf("replacing ?"));
  });

  test("la copie explique la perte et nomme notes, fiches et professeur", () => {
    const prompt = source("features/settings/ExportBeforePurge.tsx");
    const copy = prompt.replace(/\s+/g, " ");
    for (const word of ["notes", "cahier de cours", "fiches", "révision", "professeur"]) {
      expect(copy.toLowerCase()).toContain(word);
    }
    expect(copy).toContain("définitivement supprimés");
    expect(copy).toContain("Sans export, ces données sont perdues");
    // L'export est bien un clic, et son échec est annoncé à l'écran.
    expect(prompt).toContain("bridge.exportData");
    expect(prompt).toContain("onClick={() => void state.exportNow()}");
    expect(prompt).toContain('role="alert"');
    expect(prompt).toContain("Export prêt");
  });

  test("la purge attend la fin de l'export et les échecs restent visibles", () => {
    const deleteAll = source("features/settings/DeleteAllCard.tsx");
    expect(deleteAll).toContain("if (exportState.exporting) return;");
    expect(deleteAll).toContain("disabled={busy || exportState.exporting}");
    expect(deleteAll).toContain("<ExportBeforePurge state={exportState}");

    const profile = source("features/profile/ProfileScreen.tsx");
    expect(profile).toContain("if (exportState.exporting) return;");
    expect(profile).toContain("disabled={loggingOut || exportState.exporting}");
    expect(profile).toContain("<ExportBeforePurge state={exportState}");

    const pairing = source("features/pairing/PairingScreen.tsx");
    expect(pairing).toContain("if (exportState.exporting) return;");
    expect(pairing).toContain("|| exportState.exporting}");

    const exportCard = source("features/settings/DataExportCard.tsx");
    expect(exportCard).toContain("fiches de révision");
    expect(exportCard).toContain('role="alert"');
  });

  test("le fichier exporté porte l'inventaire complet des données exportables", () => {
    const model = readFileSync(
      join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data/DataExport.kt"),
      "utf8",
    );
    for (const section of ["notes", "revisionSheets", "teacherChat"]) {
      expect(model).toContain(`ExportSection("${section}"`);
      expect(model).toContain(`"${section}" to `);
    }
    const bridge = readFileSync(
      join(ROOT, "android/app/src/main/java/fr/veryslopnynotes/app/VsnBridgeDataExport.kt"),
      "utf8",
    );
    expect(bridge).toContain("listRevisionSheets");
    expect(bridge).toContain("revisionSheets = revisionSheets");
    // L'export ne peut pas précéder la purge s'il n'est pas généré avant elle :
    // le pont écrit le fichier dans le cache d'exports, puis le partage.
    expect(bridge.indexOf("buildDataExport")).toBeLessThan(bridge.indexOf("shareFile(file"));
  });
});
