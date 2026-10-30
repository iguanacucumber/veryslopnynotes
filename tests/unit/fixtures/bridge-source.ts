import { readFileSync } from "node:fs";
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
 * Tous les fichiers du pont, dans l'ordre de l'ancien fichier unique.
 *
 * `VsnBridge.kt` garde le transport, le dispatch et l'état partagé ; chaque
 * domaine vit dans son fichier. Les tests lisent l'ENSEMBLE, jamais une copie
 * ni un agrégat généré : une règle déplacée reste vue au même endroit logique.
 */
const BRIDGE_FILES = [
  "VsnBridge.kt",
  "VsnBridgeResources.kt",
  "VsnBridgeSettings.kt",
  "VsnBridgeLessons.kt",
  "VsnBridgeHomeworkAi.kt",
  "VsnBridgeTeacher.kt",
  "VsnBridgeRevision.kt",
  "VsnBridgeProfile.kt",
] as const;

/** Source concaténée du pont natif (ordre stable, une ligne vide entre fichiers). */
export function readBridgeSource(): string {
  return BRIDGE_FILES.map((file) => readFileSync(join(APP, file), "utf8")).join("\n");
}
