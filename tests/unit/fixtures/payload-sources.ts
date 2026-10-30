// Les payloads d'écran vivent un fichier par domaine (`*Payloads.kt`) : les
// scans de source lisent l'ENSEMBLE, jamais un fichier supposé unique.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATA = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "android",
  "data",
  "src",
  "main",
  "java",
  "fr",
  "veryslopnynotes",
  "data",
);

/** Fichiers `*Payloads.kt`, triés (parcours déterministe). */
export function payloadFiles(): string[] {
  return readdirSync(DATA)
    .filter((f) => f.endsWith("Payloads.kt"))
    .sort();
}

/** Le contenu de TOUS les payloads, concaténé : les scans voient l'ensemble. */
export function payloadsSource(): string {
  return payloadFiles()
    .map((f) => readFileSync(join(DATA, f), "utf8"))
    .join("\n");
}
