import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// #361 : les payloads Pronote sont écrits EN CLAIR dans `filesDir/offline/`
// (notes, absences, sanctions, messages). Sans protection, la sauvegarde
// automatique (Drive) les emporte et les restaure sur un autre appareil —
// `AccountStore.logout()` ne peut pas retirer cette copie.
//
// Ce test lit le MANIFESTE RÉEL et les XML de règles RÉELS (jamais une copie)
// : il échoue dès qu'on retire la protection.

const ROOT = join(import.meta.dir, "..", "..");
const MANIFEST = join(ROOT, "android/app/src/main/AndroidManifest.xml");
const DEBUG_MANIFEST = join(ROOT, "android/app/src/debug/AndroidManifest.xml");
const RES_XML = join(ROOT, "android/app/src/main/res/xml");

/** Attributs `android:` de l'élément `<application>` d'un manifeste. */
function appAttrs(xml: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const tag = /<application\b([^>]*)>/.exec(xml)?.[1] ?? "";
  for (const m of tag.matchAll(/android:([A-Za-z]+)="([^"]*)"/g)) attrs.set(m[1]!, m[2]!);
  return attrs;
}

/** Contenu du XML de règles référencé par le manifeste (null si absent). */
function rulesFile(attr: string): string | null {
  const ref = appAttrs(readFileSync(MANIFEST, "utf8")).get(attr);
  const name = ref ? /^@xml\/([\w]+)$/.exec(ref)?.[1] : null;
  if (!name) return null;
  const path = join(RES_XML, `${name}.xml`);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Domaines `<exclude>` d'une section de règles (racine entière si pas de section). */
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

/** Fichiers Kotlin du module Android (scan de l'infrastructure de sauvegarde). */
function kotlinFiles(dir: string, out: string[] = []): string[] {
  try {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) kotlinFiles(p, out);
      else if (p.endsWith(".kt")) out.push(p);
    }
  } catch {
    /* module absent */
  }
  return out;
}

describe("sauvegarde automatique des données scolaires (#361)", () => {
  test("le manifeste bloque la sauvegarde de filesDir/", () => {
    const attrs = appAttrs(readFileSync(MANIFEST, "utf8"));
    // Voie 1 : l'app refuse toute participation à la sauvegarde.
    const blocksBackup = attrs.get("allowBackup") === "false";
    // Voie 2 : des règles d'exclusion qui couvrent `files/`.
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
    // `<device-transfer>` qui exclut `files/`, sinon les données en clair
    // suivent vers l'autre téléphone.
    const dataExtraction = rulesFile("dataExtractionRules");
    const domains = dataExtraction
      ? excludedDomains(dataExtraction, "device-transfer")
      : new Set<string>();
    expect({ transfertFerme: coversFiles(domains) }).toEqual({ transfertFerme: true });
  });

  test("le variant DEBUG ne réactive pas la sauvegarde", () => {
    // Le manifeste debug est FUSIONNÉ avec le main : un `allowBackup="true"`
    // ici rouvrirait la porte sur l'APK de dev (le release, lui, n'a pas
    // ce fichier).
    if (!existsSync(DEBUG_MANIFEST)) return;
    const attrs = appAttrs(readFileSync(DEBUG_MANIFEST, "utf8"));
    expect(attrs.get("allowBackup") ?? "false").toBe("false");
  });

  test("l'app n'utilise pas l'infrastructure de sauvegarde", () => {
    // Aucune sauvegarde maison : ni BackupAgent, ni BackupManager, ni
    // permission BACKUP. Donc `allowBackup="false"` + les règles ne cassent
    // aucune fonctionnalité (le FileProvider sert le cache, jamais sauvegardé ;
    // la session chiffrée se relit sur l'appareil, sans passer par le cloud).
    const manifest = readFileSync(MANIFEST, "utf8");
    expect(manifest).not.toMatch(/android:backupAgent/);
    expect(manifest).not.toMatch(/android\.permission\.BACKUP/);
    const offenders = kotlinFiles(join(ROOT, "android")).filter((f) =>
      /BackupManager|BackupAgent|BackupService/.test(readFileSync(f, "utf8")),
    );
    expect({ offenders }).toEqual({ offenders: [] });
  });
});
