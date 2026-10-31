// Les écritures HORS CacheStore (fiches de révision, préférences matière)
// respectent la purge de déconnexion : une écriture en vol ne ressuscite pas
// le répertoire purgé. VRAI Kotlin compilé par le harnais.
// Une déconnexion entre écriture de fiche et d'index refuse l'index (I10).
// Outillage absent = SKIP BRUYANT, jamais un faux vert.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";
import { readBridgeSource } from "./fixtures/bridge-source";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const ARTIFACTS = join(DATA, "OfflineArtifacts.kt");
const PREFS = join(DATA, "SubjectPrefs.kt");
const CORE = join(ROOT, "android", "core", "src", "main", "java", "fr", "veryslopnynotes", "core");
const REVISION = join(CORE, "RevisionSheet.kt");
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
    // `mkdirs()` doit être DANS la garde, sinon il ressuscite le dossier purgé.
    const artifacts = readFileSync(ARTIFACTS, "utf8");
    expect(artifacts).toContain("SessionEpoch.writeIfCurrent(epoch)");
    const iGuard = artifacts.indexOf("SessionEpoch.writeIfCurrent(epoch)");
    const iMkdir = artifacts.indexOf("it.mkdirs()");
    expect(iMkdir).toBeGreaterThan(-1);
    expect(iMkdir).toBeGreaterThan(iGuard);
    // Les fiches de révision : même store, même garde.
    expect(artifacts).toContain("class FileRevisionStore");
    expect(artifacts).toContain("OfflineArtifacts.writeBytes(fileFor(key), value, epoch)");
  });

  test("câblage : la fiche et les préférences portent l'époque de l'opération", () => {
    // L'écriture d'une fiche porte l'époque et RENVOIE si elle est refusée.
    const core = readFileSync(REVISION, "utf8");
    expect(core).toContain("fun set(key: String, value: ByteArray, epoch: Long): Boolean");
    expect(core).toContain("fun saveRevisionSheet(store: RevisionKv, sheet: RevisionSheet, epoch: Long): Boolean");
    // Le pont capture l'époque à l'ARRIVÉE : une écriture demandée avant la purge peut partir après.
    const bridge = readBridgeSource();
    const iCapture = bridge.indexOf("val epoch = SessionEpoch.current()");
    // Le MARQUEUR de dispatch reste générique : le nom de la file peut changer.
    const iDispatch = bridge.indexOf(".execute {");
    expect(iCapture).toBeGreaterThan(-1);
    expect(iDispatch).toBeGreaterThan(-1);
    expect(iCapture).toBeLessThan(iDispatch);
    expect(bridge).toContain("saveSubject(p, epoch)");
    // Les valeurs envoyées au dépôt sont les valeurs VALIDÉES, pas la saisie brute.
    expect(bridge).toMatch(/prefsRepo\.upsert\([^)]*epoch\)/);
    expect(bridge).toContain("generateRevision(p, epoch)");
    // Plus aucune écriture nue hors garde.
    expect(bridge).not.toContain("FileRevisionKv");
    // Un refus fait ÉCHOUER l'enregistrement : jamais « ok » sans écriture (I10).
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

    // Le répertoire purgé n'a pas été ressuscité.
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

    expect((await ask({ op: "files", sid })).files).toEqual([]);
  });

  test.skipIf(skip)("hors déconnexion : les préférences et les fiches s'écrivent normalement", async () => {
    const store = await ask({ op: "newStore" });
    const sid = store.sid as number;
    const epoch = (await ask({ op: "epoch" })).epoch as number;

    const prefs = await ask({ op: "writePrefs", sid, epoch, content: '[{"subject":"Maths"}]' });
    expect(prefs.written).toBe(true);
    expect((await ask({ op: "files", sid })).files).toEqual(["subject_prefs.json"]);
    expect((await ask({ op: "raw", sid, name: "subject_prefs.json" })).content).toBe('[{"subject":"Maths"}]');

    // Les noms sont assainis : les `:` du préfixe deviennent des `_`.
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

    // La fiche est écrite, puis la déconnexion : l'index et le journal sont REFUSÉS.
    const write = await ask({
      op: "writeSheetDisconnect",
      sid,
      epoch,
      body: "Derivees de fonctions",
    });
    // L'index refusé, donc la fiche n'est pas enregistrée : le pont répond `ok:false`.
    expect(write.written).toBe(false);
    // La purge a emporté la fiche déjà écrite.
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
