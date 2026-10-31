// La table est LUE dans `core/EnumFr.kt`, jamais recopiée : un jeton du contrat
// sans libellé fait échouer `android-echappatoires.test.ts`, pas une version de l'app.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
export const ENUM_FR_KT = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core/EnumFr.kt");

/** Les paires `"jeton" to "Libellé",` du `mapOf` Kotlin. */
export function kotlinEnumTable(): Record<string, string> {
  const source = readFileSync(ENUM_FR_KT, "utf8");
  const start = source.indexOf("ENUM_FR: Map<String, String> = mapOf(");
  if (start < 0) throw new Error(`miroir : table ENUM_FR absente de ${ENUM_FR_KT}`);
  const pairs = [...source.slice(start).matchAll(/"([a-z_]+)" to "([^"]+)"/g)];
  if (pairs.length === 0) throw new Error(`miroir : table ENUM_FR vide dans ${ENUM_FR_KT}`);
  return Object.fromEntries(pairs.map((m) => [m[1]!, m[2]!]));
}

/** Miroir de `enumFr` : jamais `null`, jamais le jeton brut. */
export function enumFr(token: string | null | undefined, fallback = "Inconnu"): string {
  const key = (token ?? "").trim();
  if (key === "") return fallback;
  return kotlinEnumTable()[key] ?? fallback;
}

/** Un libellé français ne doit pas être un jeton anglais recopié. */
export const isFrenchLabel = (label: string): boolean => /[a-zà-ÿ]/i.test(label);