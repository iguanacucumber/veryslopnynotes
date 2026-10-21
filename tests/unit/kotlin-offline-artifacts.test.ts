// #404 : les écritures HORS CacheStore respectent la purge de déconnexion.
//
// VRAI Kotlin compilé : `OfflineArtifacts` (writes gardés par l'époque),
// `FileRevisionStore` (fiches de révision), `CacheScope` (la purge) et le
// `core` des fiches sont compilés par le harnais puis pilotés par
// `OfflineArtifactsMain` — ce n'est pas un miroir TS, c'est le code de
// production exécuté.
//
// Le défaut que ce test traque : `filesDir/offline/` n'était PAS purgé que
// par le `CacheStore`. Les fiches de révision (`revisions/`) et les
// préférences matière (`subject_prefs.json`) y écrivaient à côté, sans la
// garde d'époque : une écriture EN VOL (fiche générée pendant la
// déconnexion, préférence enregistrée) recréait le répertoire purgé et y
// laissait de la donnée du compte déconnecté.
//
// Les critères :
//   1. une écriture de fiche ou de préférences pendant une déconnexion ne
//      laisse AUCUN fichier sur le disque (le répertoire n'est pas ressuscité) ;
//   2. hors déconnexion, les deux écritures se font normalement ;
//   3. une écriture qui précède la purge est effacée par la purge (l'ordre
//      des deux est total, comme pour le cache en #364) ;
//   4. #528 : une déconnexion qui survient ENTRE l'écriture de la fiche et
//      celle de l'index REFUSE l'index : l'enregistrement ÉCHOUE (aucun « ok »
//      sans avoir écrit, I10).
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const ARTIFACTS = join(DATA, "OfflineArtifacts.kt");
const PREFS = join(DATA, "SubjectPrefs.kt");
const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const REVISION = join(CORE, "RevisionSheet.kt");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const BRIDGE = join(APP, "VsnBridge.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "OfflineArtifactsMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  // Les dossiers temporaires du pilote sont supprimés (le processus est tué
  // juste après, le hook de fermeture n'aurait pas tourné).
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

describe("écritures hors CacheStore et purge de déconnexion (#404)", () => {
  test("câblage : toute écriture dans offline/ passe par la garde d'époque", () => {
    // Les préférences matière : l'écriture passe par le store gardé.
    const prefs = readFileSync(PREFS, "utf8");
    expect(prefs).toContain("OfflineArtifacts.writeText(");
    // `mkdirs()` seul ressusciterait le dossier purgé : il doit être DANS la
    // garde (le store écrit sous `writeIfCurrent`).
    const artifacts = readFileSync(ARTIFACTS, "utf8");
    expect(artifacts).toContain("SessionEpoch.writeIfCurrent(epoch)");
    // Le dossier parent n'est créé qu'à l'intérieur de la garde.
    const iGuard = artifacts.indexOf("SessionEpoch.writeIfCurrent(epoch)");
    const iMkdir = artifacts.indexOf("it.mkdirs()");
    expect(iMkdir).toBeGreaterThan(-1);
    expect(iMkdir).toBeGreaterThan(iGuard);
    // Les fiches de révision : même store, même garde.
    expect(artifacts).toContain("class FileRevisionStore");
    expect(artifacts).toContain("OfflineArtifacts.writeBytes(fileFor(key), value, epoch)");
  });

  test("câblage : la fiche et les préférences portent l'époque de l'opération", () => {
    // Le `core` : l'écriture d'une fiche porte l'époque (capturée au début
    // de l'opération) et RENVOIE si elle est refusée.
    const core = readFileSync(REVISION, "utf8");
    expect(core).toContain("fun set(key: String, value: ByteArray, epoch: Long): Boolean");
    expect(core).toContain("fun saveRevisionSheet(store: RevisionKv, sheet: RevisionSheet, epoch: Long): Boolean");
    // Le pont : l'époque est capturée à l'ARRIVÉE de l'appel (le travail part
    // sur un fil : une écriture demandée avant la purge peut être exécutée
    // après).
    const bridge = readFileSync(BRIDGE, "utf8");
    const iCapture = bridge.indexOf("val epoch = SessionEpoch.current()");
    // Le MARQUEUR de dispatch reste générique (`.execute {`) : le nom de la file
    // peut changer (#393 : un fil par appel, le LLM à part), l'ordre, non.
    const iDispatch = bridge.indexOf(".execute {");
    expect(iCapture).toBeGreaterThan(-1);
    expect(iDispatch).toBeGreaterThan(-1);
    expect(iCapture).toBeLessThan(iDispatch);
    // Les deux écritures recoivent l'époque.
    expect(bridge).toContain("saveSubject(p, epoch)");
    // #395 : les valeurs envoyées au dépôt sont les valeurs VALIDÉES (le pont
    // les lit par `SubjectPrefRules`), pas la saisie brute.
    expect(bridge).toMatch(/prefsRepo\.upsert\([^)]*epoch\)/);
    expect(bridge).toContain("generateRevision(p, epoch)");
    // Plus aucune écriture nue hors garde.
    expect(bridge).not.toContain("FileRevisionKv");
    // #528 : l'index et le journal ne sont PLUS écrits « en best effort » : un
    // refus fait ÉCHOUER l'enregistrement (le pont ne répond JAMAIS « ok »
    // sans avoir écrit, I10).
    for (const key of ["INDEX_KEY", "INDEX_JOURNAL_KEY"]) {
      expect(core).toMatch(new RegExp(`if \\(!store\\.set\\(${key}[^)]*\\)\\)[\\s\\S]{0,80}return false`));
    }
  });

  test.skipIf(skip)("écriture de préférences pendant un logout : aucun fichier sur le disque", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    // L'opération commence : l'époque est capturée.
    const begin = await ask({ op: "epoch" });
    expect(typeof begin.epoch).toBe("number");

    // ... la déconnexion passe (purge + invalidation) ...
    const after = await ask({ op: "logout", sid });
    expect(after.epoch).toBeGreaterThan(begin.epoch);

    // ... et l'écriture en vol se termine : elle doit être REFUSÉE.
    const write = await ask({ op: "writePrefs", sid, epoch: begin.epoch, content: '[{"subject":"Maths"}]' });
    expect(write.written).toBe(false);

    // Le disque est vide : plus aucune donnée du compte déconnecté, et le
    // répertoire purgé n'a pas été ressuscité.
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("écriture de fiche pendant un logout : aucun fichier sur le disque", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    const begin = await ask({ op: "epoch" });

    const after = await ask({ op: "logout", sid });
    expect(after.epoch).toBeGreaterThan(begin.epoch);

    // La fiche est générée (contenu scolaire) pendant la déconnexion.
    const write = await ask({
      op: "writeSheet",
      sid,
      epoch: begin.epoch,
      body: "Derivees de fonctions",
    });
    expect(write.written).toBe(false);

    // Aucun fichier : ni la fiche, ni l'index, ni le journal.
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("hors déconnexion : les préférences et les fiches s'écrivent normalement", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    const epoch = (await ask({ op: "epoch" })).epoch as number;

    // Les préférences s'écrivent.
    const prefs = await ask({ op: "writePrefs", sid, epoch, content: '[{"subject":"Maths"}]' });
    expect(prefs.written).toBe(true);
    expect((await ask({ op: "files", sid })).files).toEqual(["subject_prefs.json"]);
    expect((await ask({ op: "raw", sid, name: "subject_prefs.json" })).content).toBe('[{"subject":"Maths"}]');

    // La fiche s'écrit (avec son index et son journal). Les noms sont
    // assainis (les `:` du préfixe de clé deviennent des `_`).
    const sheet = await ask({ op: "writeSheet", sid, epoch, body: "Derivees de fonctions" });
    expect(sheet.written).toBe(true);
    const files = (await ask({ op: "files", sid })).files as string[];
    expect(files).toContain("revisions/revision_sheet_fiche-devoir-1.bin");
    expect(files).toContain("revisions/revision_index.bin");
    expect(files).toContain("revisions/revision_index_journal.bin");
  });

  test.skipIf(skip)("déconnexion entre la fiche et l'index : l'enregistrement ÉCHOUE (#528)", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    const epoch = (await ask({ op: "epoch" })).epoch as number;

    // La fiche est écrite, puis la déconnexion survient (l'époque bascule et
    // le dossier est purgé) : l'index et le journal sont REFUSÉS.
    const write = await ask({
      op: "writeSheetDisconnect",
      sid,
      epoch,
      body: "Derivees de fonctions",
    });
    // AUCUN « ok » : l'index a été refusé, donc la fiche n'est pas enregistrée
    // (elle ne serait pas listable) — le pont doit répondre `ok:false`.
    expect(write.written).toBe(false);
    // Et rien ne traîne : la purge a emporté la fiche déjà écrite.
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("une écriture qui précède la purge est effacée par la purge", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    const epoch = (await ask({ op: "epoch" })).epoch as number;

    // L'écriture passe (elle précède la purge).
    expect((await ask({ op: "writePrefs", sid, epoch })).written).toBe(true);
    expect((await ask({ op: "writeSheet", sid, epoch })).written).toBe(true);
    expect(((await ask({ op: "files", sid })).files as string[]).length).toBeGreaterThan(0);

    // ... puis la déconnexion purge : plus rien sur le disque.
    await ask({ op: "logout", sid });
    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });
});
