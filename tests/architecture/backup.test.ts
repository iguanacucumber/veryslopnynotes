import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../../agents/runtime/check-architecture";

// Les payloads Pronote sont écrits EN CLAIR dans `filesDir/offline/` (notes,
// absences, sanctions, messages) : la sauvegarde automatique les emporterait sur
// un autre appareil, et `AccountStore.logout()` ne peut pas retirer cette copie.
// Le manifeste et les règles réels sont donc lus ici.

const ROOT = join(import.meta.dir, "..", "..");
const MANIFEST = join(ROOT, "android/app/src/main/AndroidManifest.xml");
const DEBUG_MANIFEST = join(ROOT, "android/app/src/debug/AndroidManifest.xml");
const RES_XML = join(ROOT, "android/app/src/main/res/xml");

function appAttrs(xml: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const tag = /<application\b([^>]*)>/.exec(xml)?.[1] ?? "";
  for (const m of tag.matchAll(/android:([A-Za-z]+)="([^"]*)"/g)) attrs.set(m[1]!, m[2]!);
  return attrs;
}

function rulesFile(attr: string): string | null {
  const ref = appAttrs(readFileSync(MANIFEST, "utf8")).get(attr);
  const name = ref ? /^@xml\/([\w]+)$/.exec(ref)?.[1] : null;
  if (!name) return null;
  const path = join(RES_XML, `${name}.xml`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Domaines `<exclude>` : racine entière si `section` est absente. */
function excludedDomains(xml: string, section?: "cloud-backup" | "device-transfer"): Set<string> {
  const body = section
    ? new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`).exec(xml)?.[1] ?? ""
    : xml;
  const out = new Set<string>();
  for (const tag of body.match(/<exclude\b[^>]*>/g) ?? []) {
    const d = /domain="([^"]+)"/.exec(tag)?.[1];
    if (d) out.add(d);
  }
  return out;
}

/** `file` = `getFilesDir()` (les payloads Pronote y vivent), `root` = tout le privé. */
function coversFiles(domains: Set<string>): boolean {
  return domains.has("file") || domains.has("root");
}

/** Parcours partagé (`listFiles`) : une copie maison avalait le répertoire sur
 *  une entrée illisible (faux vert) et descendait dans les artefacts générés. */
function kotlinFiles(dir: string): string[] {
  return listFiles(dir).filter((f) => f.endsWith(".kt"));
}

describe("sauvegarde automatique des données scolaires (#361)", () => {
  test("le manifeste bloque la sauvegarde de filesDir/", () => {
    const attrs = appAttrs(readFileSync(MANIFEST, "utf8"));
    const blocksBackup = attrs.get("allowBackup") === "false";
    const dataExtraction = rulesFile("dataExtractionRules");
    const fullBackup = rulesFile("fullBackupContent");
    const excludesFiles =
      (dataExtraction !== null && coversFiles(excludedDomains(dataExtraction, "cloud-backup"))) ||
      (fullBackup !== null && coversFiles(excludedDomains(fullBackup)));
    expect({ sauvegardeBloquee: blocksBackup || excludesFiles }).toEqual({ sauvegardeBloquee: true });
  });

  test("le transfert appareil-à-appareil est fermé aussi", () => {
    // `allowBackup="false"` ne coupe PAS le transfert appareil-à-appareil sur
    // API 31+ (certains fabricants l'ignorent) : il faut une section
    // `<device-transfer>` qui exclut `files/`.
    const dataExtraction = rulesFile("dataExtractionRules");
    const domains = dataExtraction
      ? excludedDomains(dataExtraction, "device-transfer")
      : new Set<string>();
    expect({ transfertFerme: coversFiles(domains) }).toEqual({ transfertFerme: true });
  });

  test("le variant DEBUG ne réactive pas la sauvegarde", () => {
    // Le manifeste debug est FUSIONNÉ avec le main : un `allowBackup="true"` ici
    // rouvrirait la porte sur l'APK de dev.
    if (!existsSync(DEBUG_MANIFEST)) return;
    const attrs = appAttrs(readFileSync(DEBUG_MANIFEST, "utf8"));
    expect(attrs.get("allowBackup") ?? "false").toBe("false");
  });

  test("l'app n'utilise pas l'infrastructure de sauvegarde", () => {
    // Aucune sauvegarde maison : `allowBackup="false"` + les règles ne cassent
    // donc aucune fonctionnalité (le FileProvider sert le cache, jamais
    // sauvegardé ; la session chiffrée se relit sur l'appareil).
    const manifest = readFileSync(MANIFEST, "utf8");
    expect(manifest).not.toMatch(/android:backupAgent/);
    expect(manifest).not.toMatch(/android\.permission\.BACKUP/);
    const offenders = kotlinFiles(join(ROOT, "android")).filter((f) =>
      /BackupManager|BackupAgent|BackupService/.test(readFileSync(f, "utf8")),
    );
    expect({ offenders }).toEqual({ offenders: [] });
  });
});
