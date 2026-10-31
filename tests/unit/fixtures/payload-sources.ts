// Un fichier `*Payloads.kt` par domaine : les scans lisent l'ENSEMBLE, jamais un seul.
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

/** Trié : parcours déterministe. */
export function payloadFiles(): string[] {
  return readdirSync(DATA)
    .filter((f) => f.endsWith("Payloads.kt"))
    .sort();
}

export function payloadsSource(): string {
  return payloadFiles()
    .map((f) => readFileSync(join(DATA, f), "utf8"))
    .join("\n");
}
