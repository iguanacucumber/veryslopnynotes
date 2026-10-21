// #540 : les pièces jointes téléchargées ne doivent ni se CHEVAUCHER ni
// s'ACCUMULER.
//
// Le fichier était nommé d'après le seul LIBELLÉ (`consigne.pdf`) : deux
// pièces distinctes du même devoir visaient le MÊME chemin, donc la seconde
// écrasait la première et le viewer ouvrait le mauvais document. Rien ne
// supprimait ces fichiers non plus (jusqu'à 10 Mo par pièce).
//
// Ce test ne Miroite pas la logique : il COMPILE la vraie source de production
// (`android/data/.../DownloadedFiles.kt` + `LocalDataStore.kt`, sans dépendance
// Android) et la pilote via `agents/runtime/kotlin-parity/DownloadedFilesMain.kt`.
// Les assertions portent donc sur le code EXÉCUTÉ.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit). Le
// pin statique du bas, lui, tourne TOUJOURS : il prouve que le CÂBLAGE de la
// purge est en place même sans la chaîne d'outils Kotlin.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const APP = join(ROOT, "android", "app", "src", "main", "java", "fr", "veryslopnynotes", "app");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "DownloadedFilesMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

afterAll(async () => {
  if (!link) return;
  try {
    await link.ask({ op: "cleanup" });
  } catch {
    // le pilote est déjà mort : rien à nettoyer.
  }
});

async function ask(op: unknown): Promise<any> {
  return JSON.parse(await link!.ask(op));
}

/** Un compte de test : l'IDENTITÉ suffit, aucun secret. */
const compteA = { endpoint: "https://etab.exemple/pronote", username: "eleve.a" };
const compteB = { endpoint: "https://etab.exemple/pronote", username: "eleve.b" };

/** Ouvre un poste de test (cache + cache des téléchargements). */
async function newStore(): Promise<number> {
  return (await ask({ op: "newStore" })).sid as number;
}

/** Écrit une pièce jointe et renvoie le pilote de la réponse. */
async function write(
  sid: number,
  id: string,
  label: string,
  content: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  return ask({ op: "write", sid, homework: "devoir-1", id, label, content, ...extra });
}

/** Les fichiers du cache des téléchargements, chemins relatifs. */
async function files(sid: number): Promise<string[]> {
  return (await ask({ op: "files", sid })).files as string[];
}

describe("les pièces jointes téléchargées ne se chevauchent pas (#540)", () => {
  test.skipIf(skip)("deux pièces du MÊME devoir et du MÊME libellé : deux fichiers distincts", async () => {
    const sid = await newStore();
    // Le cas de l'issue : deux pièces jointes distinctes, libellées pareil.
    const a = await write(sid, "101", "consigne.pdf", "contenu A");
    const b = await write(sid, "102", "consigne.pdf", "contenu B");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Les DEUX fichiers existent : la seconde n'a pas écrasé la première.
    expect(a.name).not.toBe(b.name);
    expect(await files(sid)).toEqual([
      `attachments/devoir-1/${a.name}`,
      `attachments/devoir-1/${b.name}`,
    ]);
    // Et chacun garde SON contenu (le viewer n'ouvrira pas le mauvais).
    expect((await ask({ op: "content", sid, name: `attachments/devoir-1/${a.name}` })).content).toBe("contenu A");
    expect((await ask({ op: "content", sid, name: `attachments/devoir-1/${b.name}` })).content).toBe("contenu B");
  });

  test.skipIf(skip)("le nom du fichier porte l'IDENTIFIANT de la pièce", async () => {
    const sid = await newStore();
    const a = await write(sid, "101", "consigne.pdf", "A");
    const b = await write(sid, "102", "consigne.pdf", "B");
    expect(a.name).toContain("101");
    expect(b.name).toContain("102");
    // L'extension survit (le lecteur tiers s'en sert en repli du type MIME).
    expect(a.name.endsWith(".pdf")).toBe(true);
  });

  test.skipIf(skip)("la MÊME pièce retéléchargée réutilise le MÊME fichier", async () => {
    const sid = await newStore();
    const a = await write(sid, "101", "consigne.pdf", "A");
    const again = await write(sid, "101", "consigne.pdf", "A2");
    expect(again.name).toBe(a.name);
    // Pas de doublon : le cache ne grossit pas à chaque ouverture.
    expect((await files(sid)).length).toBe(1);
    expect((await ask({ op: "content", sid, name: `attachments/devoir-1/${a.name}` })).content).toBe("A2");
  });

  test.skipIf(skip)("un libellé hostile ne sort ni séparateur ni chemin", async () => {
    const sid = await newStore();
    const hostile = await write(sid, "101", "../../evasion/../..pdf", "A");
    expect(hostile.ok).toBe(true);
    // Le fichier reste SOUS le dossier du devoir (I1 : aucun chemin hors cache).
    for (const path of await files(sid)) {
      expect(path.startsWith("attachments/devoir-1/")).toBe(true);
      expect(path).not.toContain("..");
    }
  });
});

describe("les pièces jointes téléchargées ne s'accumulent pas (#540)", () => {
  test.skipIf(skip)("le cache des téléchargements est BORNÉ", async () => {
    const sid = await newStore();
    // Bien plus que la borne : le cache ne doit pas grossir sans limite.
    for (let i = 0; i < 40; i++) {
      await write(sid, String(1000 + i), `piece-${i}.pdf`, `contenu ${i}`);
    }
    const kept = await files(sid);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(24);
  });

  test.skipIf(skip)("la purge de déconnexion efface les pièces jointes téléchargées", async () => {
    const sid = await newStore();
    await write(sid, "101", "consigne.pdf", "A");
    expect((await files(sid)).length).toBe(1);
    // La VRAIE purge de déconnexion (le chemin du cache, pas un appel direct).
    await ask({ op: "logout", sid });
    expect(await files(sid)).toEqual([]);
  });

  test.skipIf(skip)("le changement de compte efface les pièces jointes téléchargées", async () => {
    const sid = await newStore();
    await write(sid, "101", "consigne.pdf", "A");
    // Changement de compte : le cache du compte précédent part (avec ses PJ).
    const paired = await ask({ op: "pair", sid, previous: compteA, current: compteB });
    expect(paired.purged).toBe(true);
    expect(await files(sid)).toEqual([]);
  });

  test.skipIf(skip)("une pièce téléchargée PENDANT une déconnexion n'est pas écrite", async () => {
    const sid = await newStore();
    // L'époque est capturée AVANT le téléchargement…
    const epoch = (await ask({ op: "epoch" })).epoch as number;
    // …la déconnexion arrive pendant le téléchargement…
    await ask({ op: "logout", sid });
    // …donc l'écriture est REFUSÉE : le cache purgé ne ressuscite pas.
    const refused = await write(sid, "101", "consigne.pdf", "A", { epoch });
    expect(refused.ok).toBe(false);
    expect(await files(sid)).toEqual([]);
  });
});

describe("câblage de la purge des téléchargements (#540)", () => {
  const bridge = readFileSync(join(APP, "VsnBridge.kt"), "utf8");
  const attachments = readFileSync(join(APP, "Attachments.kt"), "utf8");
  const worker = readFileSync(join(DATA, "PeriodicSyncWorker.kt"), "utf8");
  const store = readFileSync(join(DATA, "LocalDataStore.kt"), "utf8");

  test("l'app et le job de fond passent le store qui purge les téléchargements", () => {
    // Sans ça, la purge de compte laisserait les pièces jointes du compte
    // parti dans le cache (et le compte suivant les ouvrirait).
    expect(bridge).toContain("LocalDataStore(FileCacheStore(File(ctx.filesDir, \"offline\")), ctx.cacheDir)");
    expect(worker).toContain(
      "LocalDataStore(FileCacheStore(File(applicationContext.filesDir, \"offline\")), applicationContext.cacheDir)",
    );
    // La purge des téléchargements est dans le MÊME `clearAll` que celle du
    // cache : un seul chemin de purge, donc pas de chemin qui l'oublie.
    expect(store).toContain("override fun clearAll()");
    expect(store).toContain("DownloadedFiles.purge(cacheRoot)");
  });

  test("le nom du fichier est calculé par la source partagée, avec l'identifiant", () => {
    // Le libellé seul ne suffit pas : deux pièces distinctes le partagent.
    expect(attachments).toContain("att.id");
    expect(attachments).toContain("DownloadedFiles.write(");
    // L'écriture est gardée par l'époque (une déconnexion pendant le
    // téléchargement n'écrit rien).
    expect(attachments).toContain("epoch: Long");
  });
});
