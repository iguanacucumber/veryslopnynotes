import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const APP = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "android",
  "app",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "app",
);

/**
 * Le pont est éclaté par domaine : les tests lisent l'ENSEMBLE, jamais une copie
 * ni un agrégat généré.
 *
 * La liste ATTENDUE ne pilote PAS la lecture : `BRIDGE_FILES` est dérivé du
 * disque, puis comparé. Un `VsnBridge*.kt` ajouté ou renommé sans mettre la
 * constante à jour échoue ICI, avant de sortir des scans I5/I6/I10.
 */
const ATTENDUS = [
  "VsnBridge.kt",
  "VsnBridgeResources.kt",
  "VsnBridgeSettings.kt",
  "VsnBridgeLessons.kt",
  "VsnBridgeDataExport.kt",
  "VsnBridgeDiagnostics.kt",
  "VsnBridgeHomeworkAi.kt",
  "VsnBridgeTeacher.kt",
  "VsnBridgeRevision.kt",
  "VsnBridgeProfile.kt",
  "VsnBridgeTimeouts.kt",
];

export const BRIDGE_FILES: string[] = readdirSync(APP)
  .filter((file) => /^VsnBridge.*\.kt$/.test(file))
  // Ordre de la constante, pas alphabétique : des tests découpent un bloc qui
  // traverse deux fichiers voisins (`teacherDelete` puis `revisionFailure`).
  .sort((a, b) => ATTENDUS.indexOf(a) - ATTENDUS.indexOf(b));

const attendus = [...ATTENDUS].sort();
if ([...BRIDGE_FILES].sort().join("\n") !== attendus.join("\n")) {
  throw new Error(
    "le pont Kotlin et la liste des tests divergent :\n" +
      `  sur le disque : ${[...BRIDGE_FILES].sort().join(", ")}\n` +
      `  attendu       : ${attendus.join(", ")}\n` +
      "Inscrire le fichier dans ATTENDUS (tests/unit/fixtures/bridge-source.ts) : " +
      "sinon il échappe aux scans du pont (I5/I6/I10).",
  );
}

export function readBridgeSource(): string {
  return BRIDGE_FILES.map((file) => readFileSync(join(APP, file), "utf8")).join("\n");
}
