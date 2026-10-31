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
 * Le pont est éclaté par domaine : les tests lisent l'ENSEMBLE, jamais une copie
 * ni un agrégat généré.
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

export function readBridgeSource(): string {
  return BRIDGE_FILES.map((file) => readFileSync(join(APP, file), "utf8")).join("\n");
}
